export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type MessagePayload = {
  type: string;
  messaging_product?: 'whatsapp';
  recipient_type?: 'individual' | 'group';
  [key: string]: JsonValue | undefined;
};
export interface SendOptions {
  /** phone maps to the JSON to field; bsuid maps to recipient. */
  to: 'phone' | 'bsuid';
  value: string;
  signal?: AbortSignal;
}
export interface QueuedMessage {
  hid: string;
  status: 'queued';
  [key: string]: JsonValue;
}
export class HeybotApiError extends Error {
  constructor(message: string, status: number, response: unknown);
  status: number;
  response: unknown;
}
export class Heybot {
  constructor(options?: { apiKey?: string; fetch?: typeof globalThis.fetch });
  message(payload: MessagePayload): { send(options: SendOptions): Promise<QueuedMessage> };
}
