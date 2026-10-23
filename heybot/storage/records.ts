import { HeybotEvent, InvalidWebhookError, isRecord } from '../types';
import { HeybotEventProcessor } from '../processor';

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** JSON-safe queue representation; dates and BIGINTs are converted by the consumer. */
export interface MessageEventRecord {
  wamid: string;
  eventName: string;
  /** Queue field retained for compatibility; persisted to the SQL code column. */
  statusCode: number;
  category: string | null;
  content: JsonObject;
  eventAt: string;
  inbound?: InboundMessage;
}

export interface InboundMessage {
  bsuid?: string;
  phone?: string;
  username?: string;
  name?: string;
  messageType: string;
  content: JsonObject;
}

function optionalString(value: unknown, name: string, maxLength: number): string | undefined {
  return value == null ? undefined : requiredString(value, name, maxLength);
}

function inboundMessage(event: HeybotEvent): InboundMessage {
  const data = event.data;
  const candidates = Array.isArray(event.value.contacts) ? event.value.contacts.filter(isRecord) : [];
  const contact = candidates.find(item =>
    (typeof data.from_user_id === 'string' && item.user_id === data.from_user_id) ||
    (typeof data.from === 'string' && item.wa_id === data.from));
  const bsuid = optionalString(data.from_user_id ?? contact?.user_id, 'sender user ID', 128);
  const phone = optionalString(data.from ?? contact?.wa_id, 'sender phone', 20);
  if (phone !== undefined && (!/^\d+$/.test(phone) || BigInt(phone) > BigInt('18446744073709551615'))) {
    throw new InvalidWebhookError('Invalid sender phone');
  }
  if (!bsuid && !phone) throw new InvalidWebhookError('Missing sender identity');
  const profile = isRecord(contact?.profile) ? contact.profile : {};
  return {
    bsuid, phone: phone === undefined ? undefined : BigInt(phone).toString(),
    username: optionalString(data.from_username ?? contact?.username ?? profile.username, 'sender username', 35),
    name: optionalString(profile.name, 'sender name', 255),
    messageType: requiredString(data.type, 'message type', 30),
    content: JSON.parse(JSON.stringify(data)) as JsonObject,
  };
}

/** Pending queue records from earlier deployments contain only the original envelope. */
export function getInboundMessage(record: MessageEventRecord): InboundMessage | null {
  if (record.eventName !== 'received') return null;
  if (record.inbound) return record.inbound;
  if (record.content.object === 'whatsapp_business_account') {
    const event = new HeybotEventProcessor().parse(record.content).find(item =>
      item.kind === 'message' && item.data.id === record.wamid &&
      new Date(Number(item.data.timestamp) * 1000).toISOString() === record.eventAt);
    if (!event) throw new InvalidWebhookError('Incoming event is missing from its envelope');
    return inboundMessage(event);
  }
  return inboundMessage({ kind: 'message', accountId: '', field: 'messages', value: {}, data: record.content });
}

function requiredString(value: unknown, name: string, maxLength?: number): string {
  if (typeof value !== 'string' || !value || (maxLength !== undefined && value.length > maxLength)) {
    throw new InvalidWebhookError(`Invalid ${name}`);
  }
  return value;
}

export function toMessageEventRecord(event: HeybotEvent): MessageEventRecord | null {
  if (event.kind !== 'message' && event.kind !== 'delivery') return null;
  const data = event.data;
  const wamid = requiredString(data.id, 'message ID', 131);
  const timestamp = requiredString(data.timestamp, 'timestamp');
  const seconds = Number(timestamp);
  const date = new Date(seconds * 1000);
  if (!/^\d+$/.test(timestamp) || !Number.isSafeInteger(seconds) || !Number.isFinite(date.getTime()) || date.getUTCFullYear() > 9999) {
    throw new InvalidWebhookError('Invalid timestamp');
  }
  // Store the original envelope unchanged. Direct strategy callers without an
  // envelope retain the original event item instead of a synthetic summary.
  const content = JSON.parse(JSON.stringify(event.payload ?? data)) as JsonObject;
  const base = { wamid, eventAt: date.toISOString(), content };

  if (event.kind === 'message') {
    return { ...base, eventName: 'received', statusCode: 200, category: 'service', inbound: inboundMessage(event) };
  }

  const status = requiredString(data.status, 'delivery status', 36);
  const pricing = data.pricing;
  if (pricing != null && !isRecord(pricing)) throw new InvalidWebhookError('Invalid pricing');
  // Pricing can be omitted on successful statuses too (including v24+).
  const category = pricing?.category ?? null;
  if (category !== null) requiredString(category, 'pricing category', 32);

  let statusCode = 200;
  if (status === 'failed') {
    if (!Array.isArray(data.errors) || !isRecord(data.errors[0]) || !Number.isSafeInteger(data.errors[0].code)) {
      throw new InvalidWebhookError('Failed delivery must include an integer error code');
    }
    statusCode = data.errors[0].code as number;
  }
  return { ...base, eventName: status, statusCode, category: category as string | null };
}

/** Map the entire batch before enqueuing so invalid records cause no partial sends. */
export function toMessageEventRecords(events: readonly HeybotEvent[]): MessageEventRecord[] {
  return events.map(toMessageEventRecord).filter((record): record is MessageEventRecord => record !== null);
}
