import { sql } from 'drizzle-orm';
import { bigint, bigserial, check, index, json, numeric, pgEnum, pgTable, primaryKey, timestamp, varchar } from 'drizzle-orm/pg-core';

export const conversationMode = pgEnum('conversation_mode', ['human', 'agent', 'flow', 'workflow', 'other']);
export const conversationStatus = pgEnum('conversation_status', ['open', 'close']);
export const messageDirection = pgEnum('message_direction', ['inbound', 'outbound']);

export const contacts = pgTable('contacts', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  bsuid: varchar('bsuid', { length: 128 }),
  phone: numeric('phone', { precision: 20, scale: 0 }),
  username: varchar('username', { length: 35 }),
  name: varchar('name', { length: 255 }),
  lastMessageAt: timestamp('last_message_at', { precision: 0, mode: 'date' }),
  createdAt: timestamp('created_at', { precision: 0, mode: 'date' }),
  updatedAt: timestamp('updated_at', { precision: 0, mode: 'date' }),
}, table => [
  check('contacts_phone_unsigned', sql`${table.phone} >= 0 AND ${table.phone} <= 18446744073709551615`),
]);

export const conversations = pgTable('conversations', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  contactId: bigint('contact_id', { mode: 'bigint' }).notNull().references(() => contacts.id),
  mode: conversationMode('mode').default('human').notNull(),
  status: conversationStatus('status').notNull(),
  unread: bigint('unread', { mode: 'number' }).default(0).notNull(),
  lastMessageAt: timestamp('last_message_at', { precision: 0, mode: 'date' }),
  closedAt: timestamp('closed_at', { precision: 0, mode: 'date' }),
  createdAt: timestamp('created_at', { precision: 0, mode: 'date' }),
  updatedAt: timestamp('updated_at', { precision: 0, mode: 'date' }),
}, table => [
  check('conversations_unread_unsigned', sql`${table.unread} >= 0 AND ${table.unread} <= 4294967295`),
]);

export const conversationMessages = pgTable('conversation_messages', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  nanoId: varchar('nano_id', { length: 21 }),
  wamid: varchar('wamid', { length: 255 }).notNull(),
  conversationId: bigint('conversation_id', { mode: 'bigint' }).notNull().references(() => conversations.id),
  direction: messageDirection('direction').notNull(),
  messageType: varchar('message_type', { length: 30 }).notNull(),
  deliveryStatus: varchar('delivery_status', { length: 30 }).notNull(),
  content: json('content').notNull(),
  eventAt: timestamp('event_at', { precision: 0, mode: 'date' }),
  createdAt: timestamp('created_at', { precision: 0, mode: 'date' }),
  updatedAt: timestamp('updated_at', { precision: 0, mode: 'date' }),
}, table => [
  index('conversation_messages_wamid_idx').on(table.wamid),
  index('conversation_messages_nano_id_idx').on(table.nanoId),
]);

export const whatsappEvents = pgTable('whatsapp_events', {
  id: bigserial('id', { mode: 'bigint' }).notNull(),
  wamid: varchar('wamid', { length: 131 }).notNull(),
  eventName: varchar('event_name', { length: 36 }).notNull(),
  code: bigint('code', { mode: 'bigint' }).notNull(),
  category: varchar('category', { length: 32 }),
  content: json('content').$type<Record<string, unknown>>(),
  eventAt: timestamp('event_at', { precision: 0, mode: 'date' }).notNull(),
  createdAt: timestamp('created_at', { precision: 0, mode: 'date' }),
  updatedAt: timestamp('updated_at', { precision: 0, mode: 'date' }),
}, table => [
  primaryKey({ name: 'whatsapp_message_events_pkey', columns: [table.id] }),
  index('whatsapp_events_event_at_idx').on(table.eventAt.desc()),
  index('whatsapp_events_events_wamid_idx').on(table.wamid),
  index('whatsapp_events_events_event_name_idx').on(table.eventName),
]);
