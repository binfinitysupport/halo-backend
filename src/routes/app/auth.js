// User account routes (register, login, logout) for the B-Infinity app.
// Mounted at /api/app/auth in index.js. Register and login are public; logout needs a user token.
// Admin login is a different route: POST /api/auth/login (see routes/auth.js).
import { Router } from 'express';
import crypto from 'node:crypto';
import { query } from '../../db.js';
import { asyncHandler, HttpError } from '../../utils/http.js';
import { createSignedToken } from '../../auth/signed-token.js';
import { hashPassword, passwordMatches } from '../../auth/passwords.js';
import { createLoginLimiter } from '../../auth/login-limiter.js';
import { requireUser } from '../../middleware/require-user.js';
import {
  LOGIN_PASSWORD_MIN_LENGTH,
  FUND_PASSWORD_MIN_DIGITS,
} from '../../rules/business-rules.js';
import { toProfileResponse } from './format.js';

const router = Router();

const USER_TOKEN_LIFETIME_MINUTES = 24 * 60;
// Characters used for invite codes (no 0/O or 1/I, so they are easy to read out loud).
const INVITE_CODE_CHARACTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const INVITE_CODE_LENGTH = 6;
const UNIQUE_VIOLATION = '23505'; // Postgres error: a unique index already has this value
const MAX_ID_ATTEMPTS = 5;

const loginLimiter = createLoginLimiter();

// Makes a login token for a user. The token carries the user's session_version so a logout can revoke it.
function issueUserToken(userRow) {
  return createSignedToken(
    { role: 'user', userId: userRow.id, sessionVersion: userRow.session_version },
    USER_TOKEN_LIFETIME_MINUTES
  );
}

// Random 7-digit account number (the number other users type in when they transfer money).
const randomAccountUuid = () => String(1000000 + crypto.randomInt(8999999));

const randomInviteCode = () =>
  Array.from({ length: INVITE_CODE_LENGTH }, () =>
    INVITE_CODE_CHARACTERS[crypto.randomInt(INVITE_CODE_CHARACTERS.length)]
  ).join('');

// Checks the sign-up form. Throws a 400 with a plain message for the first problem found.
function readRegisterForm(body) {
  const phoneDigits = String(body.phone || '').replace(/\D/g, '');
  const countryIso = String(body.countryIso || 'us').trim().toLowerCase();
  const email = String(body.email || '').trim();
  const password = String(body.password || '');
  const fundPassword = String(body.fundPassword || '');
  const inviteCode = String(body.inviteCode || '').trim().toUpperCase();

  if (phoneDigits.length < 6) throw new HttpError(400, 'Enter a valid phone number');
  if (!/^[a-z]{2}$/.test(countryIso)) throw new HttpError(400, 'Choose your country');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email');
  if (password.length < LOGIN_PASSWORD_MIN_LENGTH) {
    throw new HttpError(400, `Login password must be at least ${LOGIN_PASSWORD_MIN_LENGTH} characters`);
  }
  if (!new RegExp(`^\\d{${FUND_PASSWORD_MIN_DIGITS},}$`).test(fundPassword)) {
    throw new HttpError(400, `Fund password must be at least ${FUND_PASSWORD_MIN_DIGITS} digits`);
  }
  return { phoneDigits, countryIso, email, password, fundPassword, inviteCode };
}

// POST /api/app/auth/register
// body { phone, countryIso, email, password, fundPassword, inviteCode? }
// The invite code is optional. If one is given it must belong to an existing user; no default referrer is used.
// → 201 { token, expiresAt, user }
router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const form = readRegisterForm(req.body || {});

    const duplicate = await query(
      'SELECT 1 FROM users WHERE (country_iso = $1 AND phone = $2) OR lower(email) = lower($3) LIMIT 1',
      [form.countryIso, form.phoneDigits, form.email]
    );
    if (duplicate.rows.length > 0) {
      throw new HttpError(400, 'This phone number or email is already registered');
    }

    let referrerId = null;
    if (form.inviteCode) {
      const referrer = await query('SELECT id FROM users WHERE invite_code = $1', [form.inviteCode]);
      if (!referrer.rows[0]) throw new HttpError(400, 'Invite code not found');
      referrerId = referrer.rows[0].id;
    }

    const passwordHash = await hashPassword(form.password);
    const fundPasswordHash = await hashPassword(form.fundPassword);
    const name = form.email.split('@')[0];

    // The account number and invite code are random, so retry in the rare case one is already taken.
    let createdRow = null;
    for (let attempt = 1; attempt <= MAX_ID_ATTEMPTS && !createdRow; attempt++) {
      try {
        const { rows } = await query(
          `INSERT INTO users (uuid, phone, country_iso, email, name, password_hash, fund_password_hash, invite_code, referrer_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING *`,
          [
            randomAccountUuid(), form.phoneDigits, form.countryIso, form.email, name,
            passwordHash, fundPasswordHash, randomInviteCode(), referrerId,
          ]
        );
        createdRow = rows[0];
      } catch (error) {
        const isIdClash = error.code === UNIQUE_VIOLATION && /uuid|invite_code/.test(error.constraint || '');
        if (!isIdClash) throw error;
      }
    }
    if (!createdRow) throw new HttpError(500, 'Could not create the account. Please try again.');

    const session = issueUserToken(createdRow);
    res.status(201).json({ token: session.token, expiresAt: session.expiresAt, user: toProfileResponse(createdRow) });
  })
);

// POST /api/app/auth/login
// body { email } or { phone, countryIso }, plus { password }
// → { token, expiresAt, user }. Errors: 401 wrong details, 403 frozen account, 429 too many attempts.
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const clientAddress = req.ip;
    const lockMs = loginLimiter.lockedForMs(clientAddress);
    if (lockMs > 0) {
      const minutesLeft = Math.ceil(lockMs / (60 * 1000));
      throw new HttpError(429, `Too many attempts. Try again in ${minutesLeft} min`);
    }

    const body = req.body || {};
    const password = String(body.password || '');
    const email = String(body.email || '').trim();
    const phoneDigits = String(body.phone || '').replace(/\D/g, '');
    const countryIso = String(body.countryIso || 'us').trim().toLowerCase();

    const found = email
      ? await query('SELECT * FROM users WHERE lower(email) = lower($1)', [email])
      : await query('SELECT * FROM users WHERE country_iso = $1 AND phone = $2', [countryIso, phoneDigits]);
    const userRow = found.rows[0];

    if (!userRow || !(await passwordMatches(password, userRow.password_hash))) {
      loginLimiter.recordFailure(clientAddress);
      throw new HttpError(401, 'Incorrect account or password');
    }
    if (userRow.status === 'frozen') {
      throw new HttpError(403, 'This account is frozen. Please contact support.');
    }

    loginLimiter.clear(clientAddress);
    const session = issueUserToken(userRow);
    res.json({ token: session.token, expiresAt: session.expiresAt, user: toProfileResponse(userRow) });
  })
);

// POST /api/app/auth/password  body { currentPassword, newPassword } → { ok: true }
router.post(
  '/password',
  requireUser,
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const newPassword = String(body.newPassword || '');
    if (newPassword.length < LOGIN_PASSWORD_MIN_LENGTH) {
      throw new HttpError(400, `New password must be at least ${LOGIN_PASSWORD_MIN_LENGTH} characters`);
    }
    const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.userId]);
    if (!(await passwordMatches(String(body.currentPassword || ''), rows[0].password_hash))) {
      throw new HttpError(400, 'Current password is incorrect');
    }
    const newHash = await hashPassword(newPassword);
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, req.userId]);
    res.json({ ok: true });
  })
);

// POST /api/app/auth/logout → { ok: true }
// Raising session_version makes every token issued before this moment stop working.
router.post(
  '/logout',
  requireUser,
  asyncHandler(async (req, res) => {
    await query('UPDATE users SET session_version = session_version + 1 WHERE id = $1', [req.userId]);
    res.json({ ok: true });
  })
);

export default router;
