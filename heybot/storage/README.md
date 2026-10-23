# Queued message event storage

`POST /webhook/heybot` validates the signature and payload, runs the strategies,
maps every message/delivery event, and awaits publishing to the
`heybot-message-events` Vercel Queues topic. All records are validated before the
first send. Template and marketing-preference events are processed by the package
but are not stored in the message-event table.

`app/api/queues/heybot-events/route.ts` is the private push consumer configured in
`vercel.json`. It inserts into the existing `whatsapp_events` table using
one shared Drizzle database instance connected to `DATABASE_URL`. Dashboard reads,
queue writes, and the migration runner use the same connection URL. Dates are ISO
strings in queue payloads and become `Date` objects on insert; codes become
`BigInt`. Database errors propagate to trigger queue retries.

Incoming messages additionally update the inbox in that same transaction:

- Match a contact by BSUID (`from_user_id`) or phone (`from`), creating it when
  absent. Match webhook contact profiles by identity to obtain the sender name
  and optional username. Missing fields do not erase existing contact details.
- Reuse an open conversation, or create one with mode `human` and unread count 1.
  Each further distinct incoming message increments unread by 1. Closed
  conversations remain closed; the next message creates a new conversation.
- Keep contact and conversation `last_message_at` at the latest event timestamp,
  even when the queue processes messages out of order.
- Store the original message item as JSON in `conversation_messages`, using
  direction `inbound` and delivery status `received`. The event table continues
  to retain the complete webhook envelope unchanged.

Delivery status events continue to be stored in `whatsapp_events`; they do not
create inbox messages or increment unread. New queue records include normalized
inbound data. Pending records from earlier deployments are read from their
original envelope. Sender identity and message type are validated before enqueue.

## Mapping

- Delivery: `event_name` is each status item's `status`. `code` is 200,
  except `failed`, which uses `errors[0].code`.
- Delivery category comes from `pricing.category`, or is `null` when pricing is
  omitted (which is valid for successful statuses as well as failures). Categories
  support up to 32 characters, including `authentication-international` and
  `referral_conversion`.
- Incoming messages: `event_name = received`, `code = 200`, `category = service`.
- Incoming `unsupported` messages retain their original type and error details
  in the inbox message JSON. Delivery `played` and group status events retain
  their status and complete original envelope in the event table.
- `content` is the complete original parsed webhook envelope, including every
  entry, change, contact, message, status, metadata field, pricing object, error,
  and any additional fields. No masking, filtering, or summary wrapper is applied.
  Each row from a batch retains that same original envelope. Direct mapper callers
  without an envelope retain the original event item.
- `event_at` uses the individual event's Unix timestamp in seconds, converted to UTC.
- `created_at` and `updated_at` use the consumer's insert time.

Persistence uses the `whatsappEvents` Drizzle table defined in `lib/schema.ts`, mapped to `whatsapp_events`.
The queue's existing `statusCode` field maps to the SQL `code` column for
compatibility with pending messages. The removed `billable` column is not written;
any original billing information remains in `content`.

## Retries

Each queue send uses a stable SHA-256 idempotency key derived from WAMID, event
name, timestamp, and status code. The consumer additionally takes a PostgreSQL
transaction advisory lock and checks those fields before inserting, so concurrent
or repeated deliveries do not create duplicate records. Distinct statuses remain
separate rows. Other database writers must use the same protocol for this guarantee.

Inbox writes also lock sender identities and the contact before creating an open
conversation. An additional WAMID lock and duplicate check ensure a repeated
incoming message does not create another inbox message or increase unread, even
when its event timestamp changes. Conflicting identities matching two different
contacts fail the transaction for reconciliation instead of selecting one arbitrarily.
Any inbox write failure rolls back the event insert too, allowing a full queue retry.

## Setup

This application's queue integration runs on Vercel.

1. Import the repository into Vercel as a Next.js project with Node.js 22+.
2. Set `HEYBOT_VERIFY_TOKEN`, `DATABASE_URL`, and the other required environment variables in Vercel.
3. Deploy with the committed `vercel.json`; producer and consumer use `iad1`.
4. Follow the [deployment and Heybot webhook instructions](../../README.md#deploy-on-vercel) to configure the production receiver.

A webhook HTTP 200 acknowledges queue acceptance, not completion of persistence.
Queue failures propagate as server errors so the sender can retry. Malformed
webhooks or records return 400 before sending. A batch containing only the other
supported event categories is acknowledged without queuing message records.

Run tests with `npm run test:heybot`. Storage integration tests mock Vercel Queues
and PostgreSQL transport; they exercise real Drizzle SQL generation without publishing messages or writing to a live database.

The regression fixture `heybot/fixtures/reference-events.json` contains the JSON
examples from `.references/whatsapp-messages.md` and
`.references/whatsapp-messages-status.md`. Tests cover those envelopes, every
documented pricing category, omitted pricing/conversation objects, `played`, group
recipients, and unsupported incoming message errors. Migration
`0004_widen_whatsapp_event_category.sql` widens the existing event category column
without replacing the table or changing stored records; run the normal migration
command before consuming events with longer categories.

References:
- https://vercel.com/docs/queues/quickstart
- https://vercel.com/docs/queues/sdk
