const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { drizzle } = require('drizzle-orm/node-postgres');

function load(filename, modules = {}) {
  const output = ts.transpileModule(fs.readFileSync(require.resolve(filename), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  new Function('require', 'exports', output)(name => modules[name] ?? require(name), exports);
  return exports;
}

(async () => {
  // Exercise real Drizzle query compilation with no database connection.
  const queries = [];
  const db = drizzle({ query: async (query, params) => {
    const text = typeof query === 'string' ? query : query.text;
    queries.push({ text, params: params ?? query.values });
    if (text.includes('from contacts c')) return { rows: [{
      contact_id: '2', name: null, phone: '5215550002', id: '9', direction: 'inbound', message_type: 'audio',
      delivery_status: 'received', content: { audio: { voice: true } }, message_at: new Date('2026-10-23T11:00:00Z'), unread: '3',
    }] };
    if (text.includes('from contacts where')) return { rows: [{ id: '1', name: 'Ana', phone: '5215550001' }] };
    if (text.includes('select status')) return { rows: [{ status: 'close' }] };
    return { rows: [
      { id: '8', direction: 'outbound', message_type: 'text', delivery_status: 'read', content: { text: { body: 'newest' } }, message_at: new Date('2026-10-23T10:00:00Z') },
      { id: '7', direction: 'inbound', message_type: 'text', delivery_status: 'received', content: { text: { body: 'oldest' } }, message_at: new Date('2026-10-22T09:00:00Z') },
      { id: '6', direction: 'inbound', message_type: 'image', delivery_status: 'received', content: {}, message_at: new Date('2026-10-22T08:00:00Z') },
    ].slice(0, params.at(-1)) };
  } });
  const messagePreview = load('./message-preview.ts');
  const conversationQueries = load('./conversation-queries.ts', { './db': { db }, './message-preview': messagePreview });

  const [chat] = await conversationQueries.listConversations(100);
  assert.deepEqual(chat, {
    id: '2', name: null, phone: '5215550002', unread: 3,
    lastMessage: { id: '9', direction: 'inbound', deliveryStatus: 'received', at: '2026-10-23T11:00:00.000Z', preview: { media: 'audio', label: 'Voice message' } },
  });
  const listed = queries[0];
  assert.match(listed.text, /order by c.last_message_at desc nulls last, c.id desc nulls last\s+limit \$1/);
  assert.match(listed.text, /order by last.id desc limit 1/);
  assert.match(listed.text, /cv.status = 'open'/);
  assert.doesNotMatch(listed.text, /distinct on/);
  assert.deepEqual(listed.params, [100]);

  // Two of three rows fit: the extra row means an earlier page exists.
  queries.length = 0;
  const thread = await conversationQueries.listContactMessages(BigInt(1), 2);
  assert.deepEqual(thread.contact, { id: '1', name: 'Ana', phone: '5215550001' });
  assert.equal(thread.status, 'close');
  assert.deepEqual(thread.messages.map(message => message.preview.text), ['oldest', 'newest']);
  assert.equal(thread.messages[0].at, '2026-10-22T09:00:00.000Z');
  assert.equal('content' in thread.messages[0], false);
  assert.equal(thread.nextCursor, '7');
  const page = queries.find(query => query.text.includes('from conversation_messages m'));
  assert.doesNotMatch(page.text, /m.id </);
  assert.deepEqual(page.params, [BigInt(1), 3]);
  assert.match(queries.find(query => query.text.includes('select status')).text, /order by id desc limit 1/);

  queries.length = 0;
  const earlier = await conversationQueries.listContactMessages(BigInt(1), 50, BigInt(7));
  assert.equal(earlier.nextCursor, null);
  const earlierPage = queries.find(query => query.text.includes('from conversation_messages m'));
  assert.match(earlierPage.text, /and m.id < \$2/);
  assert.deepEqual(earlierPage.params, [BigInt(1), BigInt(7), 51]);

  const { parseId } = conversationQueries;
  assert.equal(parseId('12'), BigInt(12));
  for (const id of [undefined, null, '', 'abc', '0', '-1', '1.5', '999999999999999999999999999']) assert.equal(parseId(id), undefined);

  const { contactInitials, contactLabel, describeMessage } = messagePreview;
  assert.equal(contactInitials('Ana María López'), 'AL');
  assert.equal(contactInitials('  émile '), 'É');
  assert.equal(contactInitials('🙂 Moy'), 'M');
  assert.equal(contactInitials(null), '');
  assert.equal(contactLabel({ name: 'Ana', phone: '5215550001' }), 'Ana');
  assert.equal(contactLabel({ name: null, phone: '5215550001' }), '+5215550001');
  assert.equal(contactLabel({ name: ' ', phone: null }), 'Unknown contact');
  assert.deepEqual(describeMessage('text', { text: { body: 'Hi' } }), { text: 'Hi' });
  assert.deepEqual(describeMessage('image', { image: { caption: 'Look' } }), { media: 'image', label: 'Photo', text: 'Look' });
  assert.deepEqual(describeMessage('video', {}), { media: 'video', label: 'Video', text: undefined });
  assert.deepEqual(describeMessage('audio', { audio: { voice: true } }), { media: 'audio', label: 'Voice message' });
  assert.deepEqual(describeMessage('document', { document: { filename: 'a.pdf' } }), { media: 'document', label: 'a.pdf', text: undefined });
  assert.equal(describeMessage('sticker', null).media, 'sticker');
  assert.equal(describeMessage('interactive', { interactive: { button_reply: { title: 'Yes' } } }).text, 'Yes');
  assert.equal(describeMessage('reaction', { reaction: { emoji: '❤️' } }).label, 'Reacted ❤️');
  assert.equal(describeMessage('unsupported', { errors: [] }).label, 'Unsupported message');
  assert.equal(describeMessage('order', {}).label, 'order message');

  const { listDate } = load('../app/dashboard/chat-time.tsx');
  const now = new Date(2026, 9, 23, 15, 30);
  const today = new Date(2026, 9, 23, 0, 5);
  assert.equal(listDate(today, now), today.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }));
  assert.equal(listDate(new Date(2026, 9, 22, 23, 59), now), 'Yesterday');
  assert.equal(listDate(new Date(2026, 9, 31, 8), new Date(2026, 10, 1, 8)), 'Yesterday');
  const older = new Date(2026, 9, 5, 12);
  assert.equal(listDate(older, now), older.toLocaleDateString(undefined, { day: 'numeric', month: 'numeric', year: 'numeric' }));
  console.log('Conversation tests passed: inbox list and message page queries, cursors, bigint IDs, message previews, initials, and list dates.');
})().catch(error => { console.error(error); process.exitCode = 1; });
