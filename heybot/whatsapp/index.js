'use strict';

const ENDPOINT = 'https://api.heybot.cloud/v1/whatsapp/message';
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

class HeybotApiError extends Error {
  constructor(message, status, response) {
    super(message);
    this.name = 'HeybotApiError';
    this.status = status;
    this.response = response;
  }
}

class Heybot {
  #apiKey;
  #fetch;

  constructor({ apiKey = process.env.HEYBOT_API_KEY, fetch: fetchImpl = globalThis.fetch } = {}) {
    if (typeof apiKey !== 'string' || !apiKey.trim() || /[\r\n]/.test(apiKey)) {
      throw new TypeError('Provide apiKey or set HEYBOT_API_KEY');
    }
    if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required');
    this.#apiKey = apiKey.trim();
    this.#fetch = fetchImpl;
  }

  message(payload) {
    if (!isObject(payload) || typeof payload.type !== 'string' || !payload.type.trim()) {
      throw new TypeError('A message type is required');
    }
    const contents = payload[payload.type];
    if (!isObject(contents) && !(payload.type === 'contacts' && Array.isArray(contents) && contents.length > 0)) {
      throw new TypeError('Include message contents under the message type');
    }
    if ('to' in payload || 'recipient' in payload) throw new TypeError('Specify the destination in send()');
    if (payload.messaging_product !== undefined && payload.messaging_product !== 'whatsapp') {
      throw new TypeError('messaging_product must be whatsapp');
    }
    if (payload.recipient_type !== undefined && !['individual', 'group'].includes(payload.recipient_type)) {
      throw new TypeError('recipient_type must be individual or group');
    }
    // Capture each builder independently; later caller mutations cannot change it.
    const snapshot = JSON.parse(JSON.stringify(payload));
    return Object.freeze({
      send: async ({ to, value, signal } = {}) => {
        if (!['phone', 'bsuid'].includes(to)) throw new TypeError('to must be phone or bsuid');
        if (typeof value !== 'string' || !value.trim()) throw new TypeError('A recipient value is required');
        const body = {
          messaging_product: 'whatsapp', recipient_type: 'individual', ...snapshot,
          [to === 'phone' ? 'to' : 'recipient']: value,
        };
        const response = await this.#fetch(ENDPOINT, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${this.#apiKey}` },
          body: JSON.stringify(body), signal, redirect: 'error',
        });
        const text = await response.text();
        let data;
        try { data = JSON.parse(text); } catch { data = text; }
        if (!response.ok) throw new HeybotApiError(`Heybot request failed (HTTP ${response.status})`, response.status, data);
        if (!isObject(data) || typeof data.hid !== 'string' || !data.hid.trim() || data.status !== 'queued') {
          throw new HeybotApiError('Invalid Heybot queue response', response.status, data);
        }
        return data;
      },
    });
  }
}

exports.Heybot = Heybot;
exports.HeybotApiError = HeybotApiError;
