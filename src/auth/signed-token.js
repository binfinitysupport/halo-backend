// Signed tokens: a small piece of data plus a signature that only this server can make.
// Format: "<payload>.<signature>" where payload = base64url(JSON) and signature = base64url(HMAC-SHA256(payload)).
// If anyone changes the payload (for example to extend "expiresAt"), the signature no longer matches.
import crypto from 'node:crypto';

const MILLISECONDS_PER_MINUTE = 60 * 1000;
const TEMPORARY_SECRET_BYTES = 32;

// AUTH_SECRET signs every token. Without it a random secret is used, which means all tokens
// become invalid when the server restarts (fine for local development, not for production).
const signingSecret = process.env.AUTH_SECRET || crypto.randomBytes(TEMPORARY_SECRET_BYTES).toString('hex');
if (!process.env.AUTH_SECRET) {
  console.warn('AUTH_SECRET is not set: using a temporary secret (sessions end when the server restarts).');
}

const toBase64Url = (text) => Buffer.from(text).toString('base64url');
const fromBase64Url = (text) => Buffer.from(text, 'base64url').toString('utf8');
const signPayload = (payloadPart) =>
  crypto.createHmac('sha256', signingSecret).update(payloadPart).digest('base64url');

// Makes a token that holds `data` and expires after `lifetimeMinutes`. Returns { token, expiresAt }.
export function createSignedToken(data, lifetimeMinutes) {
  const expiresAt = Date.now() + lifetimeMinutes * MILLISECONDS_PER_MINUTE;
  const payloadPart = toBase64Url(JSON.stringify({ ...data, expiresAt }));
  return { token: `${payloadPart}.${signPayload(payloadPart)}`, expiresAt };
}

// Returns the data stored in a valid, unexpired token, or null if the token is missing, forged or expired.
export function readSignedToken(token) {
  if (typeof token !== 'string') return null;
  const [payloadPart, signaturePart] = token.split('.');
  if (!payloadPart || !signaturePart) return null;

  // timingSafeEqual compares in constant time, so the signature can't be guessed one character at a time.
  const expectedSignature = Buffer.from(signPayload(payloadPart));
  const givenSignature = Buffer.from(signaturePart);
  if (expectedSignature.length !== givenSignature.length) return null;
  if (!crypto.timingSafeEqual(expectedSignature, givenSignature)) return null;

  try {
    const data = JSON.parse(fromBase64Url(payloadPart));
    const isExpired = !(Number(data.expiresAt) > Date.now());
    return isExpired ? null : data;
  } catch {
    return null; // the payload was not valid JSON
  }
}
