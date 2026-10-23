# Heybot WhatsApp sending client

Internal JavaScript package for server-side use with Node.js 22+ and native `fetch`.
It sends every request to `https://api.heybot.cloud/v1/whatsapp/message` with JSON
and Bearer authentication. It has no runtime dependencies and includes TypeScript declarations.

## Usage

Set `HEYBOT_API_KEY` in the server environment (`.env` is loaded by Next.js;
standalone Node scripts must load their environment themselves).

```js
import { Heybot } from '@/heybot/whatsapp';

const heybot = new Heybot(); // Reads HEYBOT_API_KEY.
// Or: new Heybot({ apiKey: 'your-server-side-key' });
const result = await heybot.message({
  type: 'text',
  text: { body: 'Hello!', preview_url: false },
}).send({ to: 'phone', value: '+1 (650) 555-1234' });

console.log(result.hid, result.status); // Nano ID, 'queued'.
```

In CommonJS scripts within this repository:

```js
const { Heybot } = require('./heybot/whatsapp');
```

Use `to: 'bsuid'` to address a business-scoped user ID. The client sends phone
values as `to` and BSUID values as `recipient`, with only one address field present.
Phone formatting is preserved, including `+`, spaces, parentheses, and hyphens.

```js
await heybot.message({
  type: 'template',
  template: { name: 'hello_world', language: { code: 'en_US' } },
}).send({ to: 'bsuid', value: 'MX.nnnnnnnn' });
```

`message(payload)` captures an independent copy; it does not send until `send()`
is called. Extra provider fields such as `context`, `messaging_account_id`, and
`biz_opaque_callback_data` pass through. `messaging_product` defaults to `whatsapp`
and `recipient_type` defaults to `individual`. Do not put `to` or `recipient` in
`payload`; choose the destination in `send()`.

The return value is `{ hid, status: 'queued' }`, indicating provider acceptance.
Delivery results arrive separately through status webhooks. The client does not
write database records. A caller can store `hid` in `conversation_messages.nano_id`.

## Service message examples

Each named value below is a complete payload for `heybot.message(payload)`.
Replace media IDs, Flow IDs, URLs, and other sample values with your own assets.
Media objects may use an uploaded `id` instead of a public HTTPS `link`.
The client validates the common envelope; Heybot/WhatsApp validates type-specific
contents and account eligibility.

```js
// Message payload examples
const examples = {
  text: {
    type: 'text', text: { body: 'Your order is ready.', preview_url: false },
  },
  audio: {
    type: 'audio', audio: { link: 'https://example.com/update.ogg' },
  },
  contacts: {
    type: 'contacts', contacts: [{
      name: { formatted_name: 'Alex Rivera', first_name: 'Alex', last_name: 'Rivera' },
      phones: [{ phone: '+16505551234', type: 'WORK', wa_id: '16505551234' }],
      emails: [{ email: 'alex@example.com', type: 'WORK' }],
    }],
  },
  document: {
    type: 'document', document: {
      link: 'https://example.com/invoice.pdf', filename: 'invoice.pdf', caption: 'Your invoice',
    },
  },
  image: {
    type: 'image', image: { link: 'https://example.com/product.jpg', caption: 'Your product' },
  },
  video: {
    type: 'video', video: { link: 'https://example.com/demo.mp4', caption: 'Product demo' },
  },
  sticker: {
    type: 'sticker', sticker: { id: 'UPLOADED_STICKER_MEDIA_ID' },
  },
  location: {
    type: 'location', location: {
      latitude: 19.4326, longitude: -99.1332, name: 'Pickup point', address: 'Mexico City',
    },
  },
  reaction: {
    type: 'reaction', reaction: { message_id: 'wamid.MESSAGE_TO_REACT_TO', emoji: '👍' },
  },
  replyButtons: {
    type: 'interactive', interactive: {
      type: 'button', body: { text: 'Do you need help?' },
      action: { buttons: [
        { type: 'reply', reply: { id: 'yes', title: 'Yes' } },
        { type: 'reply', reply: { id: 'no', title: 'No' } },
      ] },
    },
  },
  list: {
    type: 'interactive', interactive: {
      type: 'list', body: { text: 'Choose a department.' },
      action: { button: 'Departments', sections: [{ title: 'Support', rows: [
        { id: 'orders', title: 'Orders', description: 'Track or change an order' },
        { id: 'billing', title: 'Billing' },
      ] }] },
    },
  },
  ctaUrl: {
    type: 'interactive', interactive: {
      type: 'cta_url', body: { text: 'View your order.' },
      action: { name: 'cta_url', parameters: { display_text: 'Open order', url: 'https://example.com/orders/123' } },
    },
  },
  locationRequest: {
    type: 'interactive', interactive: {
      type: 'location_request_message', body: { text: 'Where should we deliver?' },
      action: { name: 'send_location' },
    },
  },
  address: {
    type: 'interactive', interactive: {
      type: 'address_message', body: { text: 'Please provide your delivery address.' },
      action: { name: 'address_message', parameters: { country: 'IN' } },
    },
  },
  voiceCall: {
    type: 'interactive', interactive: {
      type: 'voice_call', body: { text: 'Call us on WhatsApp for help.' },
      action: { name: 'voice_call', parameters: { display_text: 'Call support' } },
    },
  },
  flow: {
    type: 'interactive', interactive: {
      type: 'flow', body: { text: 'Book your appointment.' },
      action: { name: 'flow', parameters: {
        flow_message_version: '3', flow_id: 'YOUR_PUBLISHED_FLOW_ID',
        flow_token: 'appointment-123', flow_cta: 'Book', flow_action: 'navigate',
        flow_action_payload: { screen: 'APPOINTMENT' },
      } },
    },
  },
};
```

For example, send an image:

```js
await heybot.message(examples.image).send({ to: 'phone', value: '+16505551234' });
```

Address messages and calling features require the provider/account to support
them. Flow screen names must match your published Flow. The payload examples
follow the message types listed in the [project reference](../../.references/whatsapp-send-message-payload.md).

## Template examples

Use the exact approved template name, language, and component parameters configured
for your business. Marketing, utility, and authentication all use `type: 'template'`;
the template's approved configuration determines the category.

```js
// Template payload examples
const templates = {
  marketing: {
    type: 'template', template: {
      name: 'summer_offer', language: { code: 'en_US' },
      components: [{ type: 'body', parameters: [{ type: 'text', text: 'Alex' }] }],
    },
  },
  utility: {
    type: 'template', template: {
      name: 'order_update', language: { code: 'en_US' },
      components: [{ type: 'body', parameters: [
        { type: 'text', text: 'ORDER-123' }, { type: 'text', text: 'Ready for pickup' },
      ] }],
    },
  },
  authentication: {
    type: 'template', template: {
      name: 'login_code', language: { code: 'en_US' },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: '123456' }] },
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: '123456' }] },
      ],
    },
  },
  mediaAndButton: {
    type: 'template', template: {
      name: 'product_offer', language: { code: 'en_US' },
      components: [
        { type: 'header', parameters: [{ type: 'image', image: { link: 'https://example.com/product.jpg' } }] },
        { type: 'body', parameters: [{ type: 'text', text: 'Alex' }] },
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'order-123' }] },
      ],
    },
  },
};
```

```js
await heybot.message(templates.utility).send({ to: 'bsuid', value: 'MX.nnnnnnnn' });
```

## Replies, groups, and additional fields

```js
await heybot.message({
  ...examples.text,
  context: { message_id: 'wamid.MESSAGE_TO_REPLY_TO' },
  messaging_account_id: 'YOUR_MESSAGING_ACCOUNT_ID',
  biz_opaque_callback_data: 'order-123',
}).send({ to: 'phone', value: '+16505551234' });

await heybot.message({ ...examples.text, recipient_type: 'group' })
  .send({ to: 'phone', value: 'YOUR_GROUP_ID' });
```

For groups, `to: 'phone'` selects the API's `to` field and accepts the group ID.

## Errors and cancellation

```js
import { HeybotApiError } from '@/heybot/whatsapp';

try {
  await heybot.message(examples.text).send({
    to: 'phone', value: '+16505551234', signal: AbortSignal.timeout(10_000),
  });
} catch (error) {
  if (error instanceof HeybotApiError) {
    // HTTP error or an unexpected successful response; inspect only as needed.
    console.error(error.status, error.message);
    // error.response contains the parsed JSON or raw non-JSON response.
  } else {
    // Invalid inputs throw TypeError. Network and abort errors propagate.
    throw error;
  }
}
```

The client sends once per `send()` call and does not retry automatically. A network
failure can occur after provider acceptance, so retry decisions belong to the caller.
You can inject `fetch` into `new Heybot({ apiKey, fetch })` for tests.

Run `node heybot/whatsapp/test.cjs` or `npm run test:heybot`. Tests mock every HTTP
request, including all payload examples in this README; they do not send messages.

References: [local provider contract](../../.references/whatsapp-send-message-payload.md),
[Meta Flow example](https://github.com/WhatsApp/WhatsApp-Flows-Tools/blob/main/articles/creating-surveys/main.py).
