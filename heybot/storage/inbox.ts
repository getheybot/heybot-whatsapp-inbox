import { and, eq, or, sql } from 'drizzle-orm';
import { db } from '../../lib/db';
import { contacts, conversationMessages, conversations } from '../../lib/schema';
import { InboundMessage, MessageEventRecord } from './records';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function persistInboundMessage(
  transaction: Transaction, record: MessageEventRecord, inbound: InboundMessage, now: Date,
): Promise<void> {
  // Lock both identities in a stable order, including when a later webhook adds a BSUID.
  const identities = [inbound.bsuid && `bsuid:${inbound.bsuid}`, inbound.phone && `phone:${inbound.phone}`]
    .filter((value): value is string => Boolean(value)).sort();
  for (const identity of identities) {
    await transaction.execute(sql`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${`inbox:${identity}`})::bigint)`);
  }
  await transaction.execute(sql`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${`inbox:message:${record.wamid}`})::bigint)`);
  const [duplicate] = await transaction.select({ id: conversationMessages.id }).from(conversationMessages)
    .where(and(eq(conversationMessages.wamid, record.wamid), eq(conversationMessages.direction, 'inbound'))).limit(1);
  if (duplicate) return;

  const matches = await transaction.select({ id: contacts.id }).from(contacts).where(or(
    inbound.bsuid ? eq(contacts.bsuid, inbound.bsuid) : undefined,
    inbound.phone ? eq(contacts.phone, inbound.phone) : undefined,
  )).limit(2);
  if (matches.length > 1) throw new Error('Sender identities match different contacts');
  const eventAt = new Date(record.eventAt);
  const fields = {
    bsuid: inbound.bsuid, phone: inbound.phone, username: inbound.username, name: inbound.name,
    updatedAt: now,
  };
  let contactId = matches[0]?.id;
  if (contactId === undefined) {
    const [created] = await transaction.insert(contacts).values({ ...fields, lastMessageAt: eventAt, createdAt: now })
      .returning({ id: contacts.id });
    contactId = created.id;
  } else {
    await transaction.update(contacts).set({
      ...fields, lastMessageAt: sql`greatest(${contacts.lastMessageAt}, ${eventAt.toISOString()}::timestamp)`,
    }).where(eq(contacts.id, contactId));
  }
  // Different identifiers for an existing contact must also serialize conversation creation.
  await transaction.execute(sql`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${`inbox:contact:${contactId}`})::bigint)`);
  const [open] = await transaction.select({ id: conversations.id }).from(conversations)
    .where(and(eq(conversations.contactId, contactId), eq(conversations.status, 'open'))).limit(1);
  let conversationId = open?.id;
  if (conversationId === undefined) {
    const [created] = await transaction.insert(conversations).values({
      contactId, status: 'open', unread: 1, lastMessageAt: eventAt, createdAt: now, updatedAt: now,
    }).returning({ id: conversations.id });
    conversationId = created.id;
  } else {
    await transaction.update(conversations).set({
      unread: sql`${conversations.unread} + 1`,
      lastMessageAt: sql`greatest(${conversations.lastMessageAt}, ${eventAt.toISOString()}::timestamp)`, updatedAt: now,
    }).where(eq(conversations.id, conversationId));
  }
  await transaction.insert(conversationMessages).values({
    wamid: record.wamid, conversationId, direction: 'inbound', messageType: inbound.messageType,
    deliveryStatus: 'received', content: inbound.content, eventAt, createdAt: now, updatedAt: now,
  });
}
