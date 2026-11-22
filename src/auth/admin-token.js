// Admin login checks and admin session tokens.
// - routes/auth.js uses areValidAdminCredentials() and createAdminToken() when the admin logs in.
// - middleware/require-admin.js uses isValidAdminToken() on every admin request.
// The admin email and password come from .env (ADMIN_EMAIL, ADMIN_PASSWORD); nothing is stored in the database.
import crypto from 'node:crypto';
import { createSignedToken, readSignedToken } from './signed-token.js';

const ADMIN_TOKEN_LIFETIME_MINUTES = 8 * 60;

// Makes a token for a successful admin login. Returns { token, expiresAt }.
export function createAdminToken() {
  return createSignedToken({ role: 'admin' }, ADMIN_TOKEN_LIFETIME_MINUTES);
}

// True only for an unexpired token that we signed with role "admin".
export function isValidAdminToken(token) {
  const data = readSignedToken(token);
  return data !== null && data.role === 'admin';
}

// Compares two texts in constant time. Both are hashed first because timingSafeEqual needs equal lengths.
function isSameText(firstText, secondText) {
  const firstHash = crypto.createHash('sha256').update(String(firstText)).digest();
  const secondHash = crypto.createHash('sha256').update(String(secondText)).digest();
  return crypto.timingSafeEqual(firstHash, secondHash);
}

// True when the email and password match ADMIN_EMAIL / ADMIN_PASSWORD from .env.
// The email ignores upper/lower case and surrounding spaces; the password must match exactly.
export function areValidAdminCredentials(email, password) {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) return false; // admin login is off until both are set

  const emailMatches = isSameText(String(email).trim().toLowerCase(), adminEmail.trim().toLowerCase());
  const passwordMatches = isSameText(password, adminPassword);
  return emailMatches && passwordMatches;
}
