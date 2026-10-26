import { sql } from 'drizzle-orm';
import { db } from './db';
import { describeMessage } from './message-preview';

const maxId = BigInt('9223372036854775807');

/** Positive bigint ID from a URL segment or cursor; undefined when invalid. */
export function parseId(id: string | null | undefined) {
  if (!id || !/^\d+$/.test(id)) return undefined;
  const value = BigInt(id);
  return value > 0 && value <= maxId ? value : undefined;
}

type MessageRow = {
  id: string; direction: string; message_type: string; delivery_status: string; content: unknown; message_at: Date;
};

// Only the preview is sent to the browser, never the stored WhatsApp payload.
function toMessage(row: MessageRow) {
  return {
    id: String(row.id),
    direction: row.direction,
    deliveryStatus: row.delivery_status,
    at: new Date(row.message_at).toISOString(),
    preview: describeMessage(row.message_type, row.content),
  };
}

export type ConversationMessage = ReturnType<typeof toMessage>;

// Timestamps are stored as UTC without a time zone; convert so pg returns the right instant.
const messageAt = sql.raw(`coalesce(m.event_at, m.created_at) at time zone 'UTC'`);

/**
 * One row per contact with conversations, most recent first.
 * Contacts are walked through contacts_last_message_at_id_idx, and only the returned contacts
 * look up their latest message (one index probe per conversation) and open unread count.
 */
export async function listConversations(limit: number) {
  const { rows } = await db.execute<MessageRow & { contact_id: string; name: string | null; phone: string | null; unread: string }>(sql`
    select c.id as contact_id, c.name, c.phone::text as phone, latest.*, coalesce(open_unread.unread, 0) as unread
    from contacts c
    cross join lateral (
      select m.id, m.direction, m.message_type, m.delivery_status, m.content, ${messageAt} as message_at
      from conversations cv
      cross join lateral (
        select * from conversation_messages last where last.conversation_id = cv.id order by last.id desc limit 1
      ) m
      where cv.contact_id = c.id
      order by m.id desc
      limit 1
    ) latest
    left join lateral (
      select sum(cv.unread) as unread from conversations cv where cv.contact_id = c.id and cv.status = 'open'
    ) open_unread on true
    where c.last_message_at is not null
    order by c.last_message_at desc nulls last, c.id desc nulls last
    limit ${limit}`);
  return rows.map(row => ({
    id: String(row.contact_id),
    name: row.name,
    phone: row.phone,
    unread: Number(row.unread),
    lastMessage: toMessage(row),
  }));
}

/**
 * A page of a contact's messages across all of its conversations, newest page first and oldest message
 * first within the page. `before` is the ID of the oldest message already loaded.
 */
export async function listContactMessages(contactId: bigint, limit: number, before?: bigint) {
  const [{ rows: [contact] }, { rows: [conversation] }, { rows }] = await Promise.all([
    db.execute<{ id: string; name: string | null; phone: string | null }>(
      sql`select id, name, phone::text as phone from contacts where id = ${contactId} limit 1`),
    db.execute<{ status: 'open' | 'close' }>(
      sql`select status from conversations where contact_id = ${contactId} order by id desc limit 1`),
    // One extra row tells whether an earlier page exists.
    db.execute<MessageRow>(sql`
      select m.id, m.direction, m.message_type, m.delivery_status, m.content, ${messageAt} as message_at
      from conversation_messages m
      where m.conversation_id in (select id from conversations where contact_id = ${contactId})
      ${before === undefined ? sql`` : sql`and m.id < ${before}`}
      order by m.id desc
      limit ${limit + 1}`),
  ]);
  if (!contact || !conversation) return undefined;
  const page = rows.slice(0, limit);
  return {
    contact: { id: String(contact.id), name: contact.name, phone: contact.phone },
    status: conversation.status,
    messages: page.map(toMessage).reverse(),
    nextCursor: rows.length > limit ? String(page[page.length - 1].id) : null,
  };
}
