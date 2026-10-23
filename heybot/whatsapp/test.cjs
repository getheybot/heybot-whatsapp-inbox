const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Heybot, HeybotApiError } = require('./index.js');

(async () => {
  const calls = [];
  const accepted = { hid: 'HjEY3vAt1hrj5fgHvy9h2', status: 'queued' };
  let response = () => Response.json(accepted, { status: 202 });
  const fetch = async (url, options) => {
    calls.push({ url, ...options, payload: JSON.parse(options.body) });
    return response();
  };
  const heybot = new Heybot({ apiKey: 'test-secret', fetch });
  const originalKey = process.env.HEYBOT_API_KEY;
  try {
    delete process.env.HEYBOT_API_KEY;
    assert.throws(() => new Heybot({ fetch }), /HEYBOT_API_KEY/);
    for (const apiKey of ['', '  ', 'bad\nkey', null, 123]) {
      assert.throws(() => new Heybot({ apiKey, fetch }), TypeError);
    }
    process.env.HEYBOT_API_KEY = 'env-test-key';
    const fromEnv = new Heybot({ fetch });
    await fromEnv.message({ type: 'text', text: { body: 'Environment key' } })
      .send({ to: 'phone', value: '+16505551234' });
    assert.equal(calls.at(-1).headers.Authorization, 'Bearer env-test-key');
  } finally {
    if (originalKey === undefined) delete process.env.HEYBOT_API_KEY;
    else process.env.HEYBOT_API_KEY = originalKey;
  }

  const payload = { type: 'text', text: { body: 'First' }, context: { message_id: 'wamid.reply' } };
  const builder = heybot.message(payload);
  payload.text.body = 'Mutated';
  const second = heybot.message({ type: 'image', image: { id: 'media' } });
  const beforeSend = calls.length;
  assert.deepEqual(await builder.send({ to: 'phone', value: '+1 (650) 555-1234' }), accepted);
  assert.equal(calls.length, beforeSend + 1);
  assert.equal(calls.at(-1).payload.text.body, 'First');
  assert.deepEqual(calls.at(-1).payload.context, { message_id: 'wamid.reply' });
  assert.equal(calls.at(-1).payload.to, '+1 (650) 555-1234');
  assert.equal('recipient' in calls.at(-1).payload, false);
  await second.send({ to: 'bsuid', value: 'MX.customer' });
  assert.equal(calls.at(-1).payload.recipient, 'MX.customer');
  assert.equal('to' in calls.at(-1).payload, false);
  assert.equal(calls.at(-1).payload.type, 'image');

  // Execute every payload documented in the README against the mocked transport.
  const readme = fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8');
  for (const [marker, name] of [['Message payload examples', 'examples'], ['Template payload examples', 'templates']]) {
    const block = readme.split('```js\n// ' + marker + '\n')[1].split('```')[0];
    const examples = new Function(block + `\nreturn ${name};`)();
    for (const example of Object.values(examples)) {
      const snapshot = structuredClone(example);
      assert.deepEqual(await heybot.message(example).send({ to: 'phone', value: '+16505551234' }), accepted);
      assert.deepEqual(example, snapshot);
      assert.deepEqual(calls.at(-1).payload, {
        messaging_product: 'whatsapp', recipient_type: 'individual', ...snapshot, to: '+16505551234',
      });
    }
  }
  await heybot.message({ type: 'text', text: { body: 'Group' }, recipient_type: 'group',
    messaging_account_id: 'account', biz_opaque_callback_data: 'correlation' })
    .send({ to: 'phone', value: 'group-id' });
  assert.equal(calls.at(-1).payload.recipient_type, 'group');
  assert.equal(calls.at(-1).payload.messaging_account_id, 'account');
  assert.equal(calls.at(-1).payload.biz_opaque_callback_data, 'correlation');

  const controller = new AbortController();
  await builder.send({ to: 'bsuid', value: 'MX.customer', signal: controller.signal });
  assert.equal(calls.at(-1).signal, controller.signal);
  for (const call of calls) {
    assert.equal(call.url, 'https://api.heybot.cloud/v1/whatsapp/message');
    assert.equal(call.method, 'POST');
    assert.equal(call.headers.Accept, 'application/json');
    assert.equal(call.headers['Content-Type'], 'application/json');
    assert.equal(call.redirect, 'error');
  }
  assert.equal(calls.at(-1).headers.Authorization, 'Bearer test-secret');
  assert.equal(JSON.stringify(heybot).includes('test-secret'), false);

  const beforeInvalid = calls.length;
  for (const invalid of [null, [], {}, { type: 'text' }, { type: 'text', text: [] },
    { type: 'contacts', contacts: [] }, { type: 'text', text: {}, to: 'another' },
    { type: 'text', text: {}, recipient: 'another' }, { type: 'text', text: {}, messaging_product: 'other' },
    { type: 'text', text: {}, recipient_type: 'other' }]) {
    assert.throws(() => heybot.message(invalid), TypeError);
  }
  const circular = { type: 'text', text: {} };
  circular.text.circular = circular;
  assert.throws(() => heybot.message(circular), TypeError);
  for (const invalid of [undefined, {}, { to: 'other', value: '123' }, { to: 'phone', value: '' },
    { to: 'phone', value: 123 }, { to: 'bsuid', value: '  ' }]) {
    await assert.rejects(() => builder.send(invalid), TypeError);
  }
  assert.equal(calls.length, beforeInvalid);

  for (const [status, body] of [[401, { error: { message: 'Unauthorized' } }], [429, { error: 'Rate limited' }], [500, 'Bad gateway']]) {
    response = () => typeof body === 'string' ? new Response(body, { status }) : Response.json(body, { status });
    const before = calls.length;
    await assert.rejects(() => builder.send({ to: 'phone', value: '123' }), error => {
      assert.ok(error instanceof HeybotApiError);
      assert.equal(error.status, status);
      assert.deepEqual(error.response, body);
      assert.equal(error.message.includes('test-secret'), false);
      return true;
    });
    assert.equal(calls.length, before + 1);
  }
  for (const body of ['not JSON', null, {}, { hid: '', status: 'queued' }, { hid: 'abc', status: 'delivered' }]) {
    response = () => typeof body === 'string' ? new Response(body) : Response.json(body);
    await assert.rejects(() => builder.send({ to: 'phone', value: '123' }), error =>
      error instanceof HeybotApiError && error.message === 'Invalid Heybot queue response');
  }
  for (const error of [new Error('Network unavailable'), new DOMException('Aborted', 'AbortError')]) {
    response = () => { throw error; };
    const before = calls.length;
    await assert.rejects(() => builder.send({ to: 'phone', value: '123' }), caught => caught === error);
    assert.equal(calls.length, before + 1);
  }
  console.log('WhatsApp client tests passed: phone/BSUID routing, authentication, all README payloads, immutable builders, input validation, response handling, cancellation, and no automatic retries.');
})().catch(error => { console.error(error); process.exitCode = 1; });
