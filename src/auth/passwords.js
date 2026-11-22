// Password hashing for user accounts (login password and fund password).
// A password is never stored as typed. We store a salted scrypt hash in the form
//   "scrypt$<salt in hex>$<hash in hex>"
// so the same password gives a different hash for every account.
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const deriveKey = promisify(crypto.scrypt);
const SALT_BYTES = 16;
const HASH_BYTES = 64;

export async function hashPassword(plainText) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const hash = await deriveKey(String(plainText), salt, HASH_BYTES);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

// True when `plainText` matches a hash made by hashPassword(). Returns false for empty or damaged hashes.
export async function passwordMatches(plainText, storedHash) {
  if (!storedHash) return false;
  const [scheme, saltHex, hashHex] = storedHash.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;

  const expected = Buffer.from(hashHex, 'hex');
  const actual = await deriveKey(String(plainText), Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}
