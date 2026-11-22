// Talks to OxaPay, the payment gateway that takes deposits.
// Docs: https://docs.oxapay.com (white-label payment API and webhooks).
// Needs two values in .env:
//   OXAPAY_MERCHANT_API_KEY – your merchant key (also used to sign the webhooks we receive)
//   PUBLIC_API_URL          – this API's public address; OxaPay calls back to <PUBLIC_API_URL>/api/webhooks/oxapay.
//                             OxaPay cannot reach localhost, so for local tests this stays unset and you
//                             send the webhook yourself (see scripts in the docs).
import crypto from 'node:crypto';
import { HttpError } from '../utils/http.js';

const OXAPAY_API_BASE_URL = 'https://api.oxapay.com/v1';
export const OXAPAY_WEBHOOK_PATH = '/api/webhooks/oxapay'; // full public address (PUBLIC_API_URL + this)

export function isOxapayConfigured() {
  return Boolean(process.env.OXAPAY_MERCHANT_API_KEY && process.env.PUBLIC_API_URL);
}

// Creates a payment with its own deposit address and expiry time. Returns OxaPay's "data" object
// (track_id, address, pay_amount, pay_currency, network, qr_code, expired_at).
export async function createDepositPayment({ payCurrency, network, amountUsd, orderId, lifetimeMinutes, description }) {
  const requestBody = {
    pay_currency: payCurrency,
    network,
    amount: amountUsd,
    currency: 'USD', // "amount" is in US dollars; OxaPay works out how much crypto that is
    lifetime: lifetimeMinutes,
    callback_url: process.env.PUBLIC_API_URL + OXAPAY_WEBHOOK_PATH,
    order_id: orderId,
    description,
  };

  let response;
  try {
    response = await fetch(`${OXAPAY_API_BASE_URL}/payment/white-label`, {
      method: 'POST',
      headers: {
        merchant_api_key: process.env.OXAPAY_MERCHANT_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
  } catch (error) {
    throw new HttpError(502, 'Payment gateway is not reachable right now. Please try again.');
  }

  const json = await response.json().catch(() => null);
  if (!response.ok || !json || !json.data) {
    const reason = json?.error?.message || json?.message || `HTTP ${response.status}`;
    throw new HttpError(502, `Payment gateway error: ${reason}`);
  }
  return json.data;
}

// OxaPay signs each webhook: HMAC-SHA512 (hex) of the raw request body, keyed with our merchant key,
// sent in the "HMAC" header. We recompute it and compare. Anything that doesn't match is not from OxaPay.
export function isValidOxapaySignature(rawBody, signatureHeader) {
  const merchantKey = process.env.OXAPAY_MERCHANT_API_KEY;
  if (!merchantKey || !signatureHeader) return false;

  const expected = Buffer.from(crypto.createHmac('sha512', merchantKey).update(rawBody).digest('hex'));
  const received = Buffer.from(String(signatureHeader).trim());
  if (expected.length !== received.length) return false;
  return crypto.timingSafeEqual(expected, received);
}
