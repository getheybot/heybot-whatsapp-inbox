const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');

function loader(mocks = {}) {
  const cache = new Map();
  function load(file) {
    if (file in mocks) return mocks[file];
    if (file.startsWith('node:')) return require(file);
    file = path.resolve(root, file);
    if (!path.extname(file)) file = fs.existsSync(file + '.ts') ? file + '.ts' : path.join(file, 'index.ts');
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    new Function('require', 'exports', code)(name => {
      if (name in mocks || name.startsWith('node:')) return load(name);
      if (!name.startsWith('.') && !name.startsWith('@/')) return require(name);
      return load(name.startsWith('@/') ? path.join(root, name.slice(2)) : path.resolve(path.dirname(file), name));
    }, exports);
    return exports;
  }
  return load;
}

(async () => {
  const load = loader();
  const { HeybotEventProcessor, InvalidWebhookError } = load('heybot/index.ts');
  const { toMessageEventRecord: map, toMessageEventRecords: mapAll } = load('heybot/storage/records.ts');
  const proxied = require('../fixtures/proxied-message.json');
  // Exact JSON examples copied from the user-provided WhatsApp references.
  const referenceEvents = require('../fixtures/reference-events.json');
  for (const payload of Object.values(referenceEvents).flat()) {
    const mapped = mapAll(new HeybotEventProcessor().parse(payload));
    assert.equal(mapped.length, 1);
    assert.deepEqual(mapped[0].content, payload);
    const value = payload.entry[0].changes[0].value;
    if (value.messages) {
      assert.equal(mapped[0].inbound.phone, '16505551234');
      assert.equal(mapped[0].inbound.name, 'Sheena Nelson');
      assert.equal(mapped[0].inbound.bsuid, undefined);
    } else {
      assert.equal(mapped[0].inbound, undefined);
      assert.equal(mapped[0].category, value.statuses[0].pricing?.category ?? null);
      assert.equal(mapped[0].statusCode, value.statuses[0].errors?.[0].code ?? 200);
    }
  }
  const received = map(new HeybotEventProcessor().parse(proxied)[0]);
  assert.equal(received.eventName, 'received');
  assert.equal(received.category, 'service');
  assert.equal(received.statusCode, 200);
  assert.equal(received.eventAt, new Date(1792392254 * 1000).toISOString());
  assert.deepEqual(received.content, proxied);
  assert.equal(received.content.entry[0].changes[0].value.messages[0].from, '5215512345678');
  assert.equal(received.content.entry[0].changes[0].value.messages[0].from_user_id, 'MX.1111111111111111');
  assert.deepEqual(received.content.entry[0].changes[0].value.contacts, proxied.entry[0].changes[0].value.contacts);
  assert.equal(proxied.entry[0].changes[0].value.messages[0].from, '5215512345678');

  const delivery = (extra = {}) => ({ kind: 'delivery', accountId: 'account', field: 'messages', value: {}, data: {
    id: 'wamid.test', status: 'delivered', timestamp: '1792392254', recipient_user_id: 'MX.1996141787964004', recipient_id: '5217779870543', ...extra,
  } });
  const record = map(delivery({ pricing: { billable: true, category: 'marketing', pricing_model: 'PMP' } }));
  assert.equal(record.eventName, 'delivered');
  assert.equal(record.statusCode, 200);
  assert.equal(record.category, 'marketing');
  assert.deepEqual(record.content.pricing, { billable: true, category: 'marketing', pricing_model: 'PMP' });
  assert.equal(record.content.recipient_user_id, 'MX.1996141787964004');
  assert.equal(record.content.recipient_id, '5217779870543');
  const errors = [{ code: 131047, title: 'Re-engagement required' }];
  const failed = map(delivery({ status: 'failed', errors }));
  assert.equal(failed.statusCode, 131047);
  assert.deepEqual(failed.content.errors, errors);
  assert.equal(failed.category, null);
  assert.equal('pricing' in failed.content, false);
  const emptyRecipient = map(delivery({ recipient_id: undefined, recipient_user_id: undefined }));
  assert.equal('recipient_id' in emptyRecipient.content, false);
  assert.equal('recipient_user_id' in emptyRecipient.content, false);
  for (const status of ['sent', 'delivered', 'read', 'played']) {
    const mapped = map(delivery({ status }));
    assert.equal(mapped.eventName, status);
    assert.equal(mapped.category, null);
    assert.equal(mapped.inbound, undefined);
  }
  for (const category of ['authentication', 'authentication-international', 'group_marketing',
    'group_service', 'group_utility', 'marketing', 'marketing_lite', 'referral_conversion', 'service', 'utility']) {
    assert.equal(map(delivery({ pricing: { category } })).category, category);
  }
  assert.throws(() => map(delivery({ pricing: { category: 'x'.repeat(33) } })), InvalidWebhookError);
  for (const extra of [{ timestamp: 'invalid' }, { timestamp: '1.1' }, { timestamp: '9999999999999999999' }, { id: '' }, { status: 'failed' }, { status: 'failed', errors: [{ code: 'bad' }] }]) {
    assert.throws(() => map(delivery(extra)), InvalidWebhookError);
  }
  assert.deepEqual(mapAll([{ ...delivery(), kind: 'template-status' }]), []);
  assert.deepEqual(JSON.parse(JSON.stringify(record)), record);
  const deliveryPayload = {
    object: 'whatsapp_business_account',
    entry: [{ id: 'account', changes: [{ field: 'messages', value: {
      metadata: { phone_number_id: 'phone' },
      statuses: [delivery().data, delivery({ id: 'wamid.failed', status: 'failed', errors }).data],
      original_extra: { nested: [null, true, 'unchanged'] },
    } }] }],
  };
  const originalDelivery = JSON.parse(JSON.stringify(deliveryPayload));
  const deliveryRecords = mapAll(new HeybotEventProcessor().parse(deliveryPayload));
  assert.equal(deliveryRecords.length, 2);
  for (const item of deliveryRecords) assert.deepEqual(item.content, originalDelivery);
  assert.deepEqual(deliveryPayload, originalDelivery);

  const senderOnly = { kind: 'message', accountId: 'account', field: 'messages', value: {}, data: {
    id: 'wamid.sender-only', timestamp: '1792392254', type: 'image', from_user_id: 'MX.sender', image: { id: 'media' },
  } };
  assert.equal(map(senderOnly).inbound.bsuid, 'MX.sender');
  assert.equal(map(senderOnly).inbound.phone, undefined);
  assert.equal(map({ ...senderOnly, data: { ...senderOnly.data, from_user_id: undefined, from: '5215512345678' } }).inbound.phone, '5215512345678');
  for (const extra of [{ from_user_id: undefined }, { from: 'abc' }, { from: '18446744073709551616' }, { type: '' }]) {
    assert.throws(() => map({ ...senderOnly, data: { ...senderOnly.data, ...extra } }), InvalidWebhookError);
  }
  const multipleContacts = { ...senderOnly, data: { ...senderOnly.data, from: '5215512345678' }, value: { contacts: [
    { wa_id: '999', profile: { name: 'Other sender' } },
    { wa_id: '5215512345678', profile: { name: 'Correct sender' } },
  ] } };
  assert.equal(map(multipleContacts).inbound.name, 'Correct sender');


  const sends = [];
  let rejectSend = false;
  let releaseSend;
  const inserted = [];
  const inboxContacts = [];
  const inboxConversations = [];
  const inboxMessages = [];
  const inboxSql = [];
  let inboxSnapshot;
  let inboxFailure = false;
  let lockCount = 0;
  let dbFailure = false;
  let rollbackCount = 0;
  // Real Drizzle generates and maps the SQL; only the pg transport is mocked.
  const fakeClient = {
    query: async (query, parameters) => {
      const text = typeof query === 'string' ? query : query.text;
      if (text.startsWith('begin')) {
        inboxSnapshot = structuredClone([inserted, inboxContacts, inboxConversations, inboxMessages]);
        return { rows: [] };
      }
      if (text.startsWith('commit')) return { rows: [] };
      if (text.startsWith('rollback')) {
        rollbackCount++;
        [inserted, inboxContacts, inboxConversations, inboxMessages].forEach((items, i) => items.splice(0, items.length, ...inboxSnapshot[i]));
        return { rows: [] };
      }
      if (text.includes('pg_advisory_xact_lock')) { lockCount++; return { rows: [] }; }
      if (!text.includes('"whatsapp_events"')) {
        inboxSql.push(text);
        if (text.startsWith('select') && text.includes('from "conversation_messages"')) {
          const found = inboxMessages.find(item => item.wamid === parameters[0]);
          return { rows: found ? [[String(found.id)]] : [] };
        }
        if (text.startsWith('select') && text.includes('from "contacts"')) {
          const found = inboxContacts.filter(item => parameters.includes(item.bsuid) || parameters.includes(item.phone));
          return { rows: found.map(item => [String(item.id)]) };
        }
        if (text.startsWith('select') && text.includes('from "conversations"')) {
          const found = inboxConversations.find(item => String(item.contactId) === String(parameters[0]) && item.status === 'open');
          return { rows: found ? [[String(found.id)]] : [] };
        }
        if (text.startsWith('insert into "contacts"')) {
          const [, columns, values] = /\((.*?)\) values \((.*?)\)/.exec(text);
          const fields = Object.fromEntries(columns.split(', ').map((name, i) => {
            const placeholder = values.split(', ')[i];
            return [name.replaceAll('"', ''), placeholder === 'default' ? undefined : parameters[Number(placeholder.slice(1)) - 1]];
          }));
          inboxContacts.push({ id: inboxContacts.length + 1, bsuid: fields.bsuid, phone: fields.phone,
            name: fields.name, lastMessageAt: fields.last_message_at });
          return { rows: [[String(inboxContacts.length)]] };
        }
        if (text.startsWith('update "contacts"')) {
          const item = inboxContacts.find(item => String(item.id) === String(parameters.at(-1)));
          const field = /set (.*?) where/.exec(text)[1];
          for (const name of ['bsuid', 'phone', 'username', 'name', 'last_message_at']) {
            const match = new RegExp(`"${name}" = (?:greatest\\([^,]+, )?\\$(\\d+)`).exec(field);
            if (match) {
              const value = parameters[Number(match[1]) - 1];
              if (name === 'last_message_at') item.lastMessageAt = item.lastMessageAt > value ? item.lastMessageAt : value;
              else item[name] = value;
            }
          }
          return { rows: [] };
        }
        if (text.startsWith('insert into "conversations"')) {
          const [contactId, status, unread, lastMessageAt] = parameters;
          inboxConversations.push({ id: inboxConversations.length + 1, contactId, status, unread, lastMessageAt });
          return { rows: [[String(inboxConversations.length)]] };
        }
        if (text.startsWith('update "conversations"')) {
          assert.match(text, /"unread" = "conversations"\."unread" \+ 1/);
          assert.match(text, /greatest/);
          const item = inboxConversations.find(item => String(item.id) === String(parameters.at(-1)));
          item.unread++;
          item.lastMessageAt = item.lastMessageAt > parameters[0] ? item.lastMessageAt : parameters[0];
          return { rows: [] };
        }
        if (text.startsWith('insert into "conversation_messages"')) {
          if (inboxFailure) throw new Error('Inbox write failed');
          const [wamid, conversationId, direction, messageType, deliveryStatus, content, eventAt] = parameters;
          inboxMessages.push({ id: inboxMessages.length + 1, wamid, conversationId, direction, messageType, deliveryStatus, content: JSON.parse(content), eventAt });
          return { rows: [] };
        }
        throw new Error(`Unexpected inbox SQL: ${text}`);
      }
      if (text.startsWith('select')) {
        const [wamid, eventName, eventAt, code] = parameters;
        const found = inserted.find(row => row.wamid === wamid && row.eventName === eventName && +row.eventAt === +new Date(eventAt) && row.code === BigInt(code));
        return { rows: found ? [[String(found.id)]] : [] };
      }
      if (text.startsWith('insert')) {
        if (dbFailure) throw new Error('DB unavailable');
        const [wamid, eventName, code, category, content, eventAt, createdAt, updatedAt] = parameters;
        inserted.push({ id: inserted.length + 1, wamid, eventName, code: BigInt(code), category, content: JSON.parse(content), eventAt: new Date(eventAt), createdAt: new Date(createdAt), updatedAt: new Date(updatedAt) });
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL: ${text}`);
    },
  };
  const mockDb = require('drizzle-orm/node-postgres').drizzle(fakeClient);
  const mockedLoad = loader({
    '@vercel/queue': {
      send: async (...args) => { if (rejectSend) throw new Error('queue unavailable'); sends.push(args); if (releaseSend) await releaseSend; return { messageId: 'test' }; },
      handleCallback: callback => request => callback(request),
    },
    [path.join(root, 'lib/db')]: { db: mockDb, getWriteDatabaseTarget: () => ({ connectionSource: 'DATABASE_URL', connector: 'drizzle-node-postgres', host: 'write.example', port: '5432', deploymentId: 'test' }) },
  });
  const { enqueueMessageEvents, MESSAGE_EVENTS_TOPIC } = mockedLoad('heybot/storage/queue.ts');
  await enqueueMessageEvents([record, failed]);
  assert.equal(sends[0][0], MESSAGE_EVENTS_TOPIC);
  assert.deepEqual(sends[0][1], record);
  await enqueueMessageEvents([record]);
  assert.equal(sends[0][2].idempotencyKey, sends[2][2].idempotencyKey);
  assert.notEqual(sends[0][2].idempotencyKey, sends[1][2].idempotencyKey);
  rejectSend = true;
  await assert.rejects(() => enqueueMessageEvents([record]), /queue unavailable/);
  rejectSend = false;

  const { persistMessageEvent } = mockedLoad('heybot/storage/persist.ts');
  await persistMessageEvent(record);
  await persistMessageEvent(record);
  await persistMessageEvent(failed);
  assert.equal(inserted.length, 2);
  assert.equal(lockCount, 3);
  assert.equal(inserted[0].code, 200n);
  assert.ok(inserted[0].eventAt instanceof Date);
  assert.deepEqual(inserted[0].content, record.content);
  assert.equal('statusCode' in inserted[0], false);
  assert.equal('billable' in inserted[0], false);
  dbFailure = true;
  await assert.rejects(() => persistMessageEvent({ ...record, wamid: 'new' }), error => error.cause?.message === 'DB unavailable');
  assert.equal(rollbackCount, 1);
  dbFailure = false;

  const route = mockedLoad('app/webhook/heybot/route.ts');
  const originalToken = process.env.HEYBOT_VERIFY_TOKEN;
  try {
    const request = (body, signature = 'test-token') => new Request('http://localhost/webhook/heybot', {
      method: 'POST', headers: { 'x-heybot-signature': signature }, body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    delete process.env.HEYBOT_VERIFY_TOKEN;
    assert.equal((await route.POST(request(proxied))).status, 503);
    process.env.HEYBOT_VERIFY_TOKEN = 'test-token';
    assert.equal((await route.POST(request(proxied, 'wrong'))).status, 401);
    assert.equal((await route.POST(request('{'))).status, 400);
    assert.equal((await route.POST(request({}))).status, 400);
    const before = sends.length;
    assert.equal((await route.POST(request(proxied))).status, 200);
    assert.equal(sends.length, before + 1);
    assert.equal(sends.at(-1)[1].eventName, 'received');
    assert.deepEqual(sends.at(-1)[1].content, proxied);
    const mixed = JSON.parse(JSON.stringify(proxied));
    mixed.entry[0].changes[0].value.statuses = [delivery({ timestamp: 'bad' }).data];
    const beforeInvalid = sends.length;
    assert.equal((await route.POST(request(mixed))).status, 400);
    assert.equal(sends.length, beforeInvalid);
    const invalidSender = structuredClone(proxied);
    invalidSender.entry[0].changes[0].value.messages[0].from = 'invalid';
    assert.equal((await route.POST(request(invalidSender))).status, 400);
    assert.equal(sends.length, beforeInvalid);
    rejectSend = true;
    await assert.rejects(() => route.POST(request(proxied)), /queue unavailable/);
    rejectSend = false;
    let release;
    releaseSend = new Promise(resolve => { release = resolve; });
    let completed = false;
    const pending = route.POST(request(proxied)).then(response => { completed = true; return response; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(completed, false);
    release();
    assert.equal((await pending).status, 200);
    assert.equal((await route.GET()).status, 200);
  } finally {
    if (originalToken === undefined) delete process.env.HEYBOT_VERIFY_TOKEN;
    else process.env.HEYBOT_VERIFY_TOKEN = originalToken;
  }
  const consumer = mockedLoad('app/api/queues/heybot-events/route.ts');
  await consumer.POST(received);
  assert.equal(inserted.at(-1).eventName, 'received');
  assert.deepEqual(inserted.at(-1).content, proxied);
  assert.equal(inboxContacts.length, 1);
  assert.equal(inboxContacts[0].bsuid, 'MX.1111111111111111');
  assert.equal(inboxContacts[0].phone, '5215512345678');
  assert.equal(inboxContacts[0].name, 'Dan');
  assert.equal(inboxConversations.length, 1);
  assert.equal(inboxConversations[0].unread, 1);
  assert.equal(inboxMessages[0].direction, 'inbound');
  assert.equal(inboxMessages[0].deliveryStatus, 'received');
  assert.deepEqual(inboxMessages[0].content, proxied.entry[0].changes[0].value.messages[0]);
  await consumer.POST(received);
  assert.equal(inboxMessages.length, 1);
  assert.equal(inboxConversations[0].unread, 1);

  const incoming = (id, timestamp, extra = {}) => {
    const payload = structuredClone(proxied);
    Object.assign(payload.entry[0].changes[0].value.messages[0], { id, timestamp, ...extra });
    return mapAll(new HeybotEventProcessor().parse(payload))[0];
  };
  const second = incoming('wamid.second', '1792392255');
  // Old queue records without normalized inbound fields remain consumable.
  delete second.inbound;
  await consumer.POST(second);
  assert.equal(inboxContacts.length, 1);
  assert.equal(inboxConversations.length, 1);
  assert.equal(inboxConversations[0].unread, 2);
  const latest = second.eventAt;
  await consumer.POST(incoming('wamid.older', '1792392250'));
  assert.equal(inboxConversations[0].unread, 3);
  assert.equal(inboxContacts[0].lastMessageAt, latest);
  assert.equal(inboxConversations[0].lastMessageAt, latest);
  // A repeated WAMID with a changed event timestamp still counts only once.
  await consumer.POST(incoming('wamid.second', '1792392256'));
  assert.equal(inboxMessages.length, 3);
  assert.equal(inboxConversations[0].unread, 3);
  inboxConversations[0].status = 'close';
  await consumer.POST(incoming('wamid.reopen', '1792392257', { from: undefined }));
  assert.equal(inboxContacts.length, 1);
  assert.equal(inboxConversations.length, 2);
  assert.equal(inboxConversations[1].unread, 1);
  assert.equal(inboxContacts[0].phone, '5215512345678');

  const beforeFailure = structuredClone([inserted, inboxContacts, inboxConversations, inboxMessages]);
  inboxFailure = true;
  const retry = incoming('wamid.retry', '1792392258');
  await assert.rejects(() => consumer.POST(retry), error => error.cause?.message === 'Inbox write failed');
  assert.deepEqual([inserted, inboxContacts, inboxConversations, inboxMessages], beforeFailure);
  inboxFailure = false;
  await consumer.POST(retry);
  assert.equal(inboxConversations[1].unread, 2);
  assert.equal(inboxMessages.length, 5);
  assert.equal(inboxSql.filter(sql => sql.startsWith('insert into "contacts"')).length, 1);
  // Status-only envelopes do not contain message bodies and must never create
  // contacts/conversations, increment unread, or fabricate outbound messages.
  const inboxBeforeStatuses = structuredClone([inboxContacts, inboxConversations, inboxMessages]);
  for (const payload of Object.values(referenceEvents).flat()) {
    if (!payload.entry[0].changes[0].value.statuses) continue;
    for (const item of mapAll(new HeybotEventProcessor().parse(payload))) {
      // The reference reuses the same sent ID/timestamp in the v24 example;
      // retries preserve the first event's original envelope.
      const existingEvent = inserted.find(row => row.wamid === item.wamid && row.eventName === item.eventName);
      const before = inserted.length;
      await consumer.POST(item);
      assert.equal(inserted.length, before + (existingEvent ? 0 : 1));
      assert.deepEqual(inserted.find(row => row.wamid === item.wamid && row.eventName === item.eventName).content,
        existingEvent?.content ?? payload);
    }
  }
  const groupPlayed = map(delivery({ id: 'wamid.group-played', status: 'played', recipient_id: 'group-id',
    recipient_type: 'group', recipient_participant_id: '16505551234',
    pricing: { category: 'group_service', type: 'free_group_customer_service', pricing_model: 'PMP' },
  }));
  await consumer.POST(groupPlayed);
  assert.deepEqual(inserted.at(-1).content, groupPlayed.content);
  assert.deepEqual([inboxContacts, inboxConversations, inboxMessages], inboxBeforeStatuses);
  // Error details are part of unsupported incoming message content as documented.
  const unsupported = incoming('wamid.unsupported', '1792392259', {
    type: 'unsupported', text: undefined, errors: [{ code: 131051, title: 'Unsupported message type' }],
  });
  await consumer.POST(unsupported);
  assert.equal(inboxMessages.at(-1).messageType, 'unsupported');
  assert.deepEqual(inboxMessages.at(-1).content.errors, unsupported.inbound.content.errors);
  assert.equal(inboxConversations[1].unread, 3);
  // The longest documented category must survive the entire consumer path.
  const international = map(delivery({ id: 'wamid.international', pricing: { category: 'authentication-international' } }));
  await consumer.POST(international);
  assert.equal(inserted.at(-1).category, 'authentication-international');
  const documentedIncoming = mapAll(new HeybotEventProcessor().parse(referenceEvents['whatsapp-messages'][0]))[0];
  await consumer.POST(documentedIncoming);
  assert.equal(inboxContacts.length, 2);
  assert.equal(inboxContacts[1].phone, '16505551234');
  assert.equal(inboxContacts[1].bsuid, undefined);
  assert.equal(inboxContacts[1].name, 'Sheena Nelson');
  assert.equal(inboxConversations.length, 3);
  assert.equal(inboxConversations[2].unread, 1);
  assert.equal(inboxMessages.at(-1).content.text.body, 'Does it come in another color?');
  console.log('Storage tests passed: mappings, original payload preservation, sender validation, queue retries, inbox creation and reuse, unread deduplication, out-of-order timestamps, rollback, webhook and consumer integration.');
})().catch(error => { console.error(error); process.exitCode = 1; });
