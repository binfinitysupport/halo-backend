// Gatekeeper for the user app's private API (/api/app/...). The browser sends the token it got from
// POST /api/app/auth/login or /register in this header:
//   Authorization: Bearer <token>
// The request stops here with 401 if the token is missing, forged, expired, or was revoked by a logout.
import { readSignedToken } from '../auth/signed-token.js';
import { query } from '../db.js';
import { asyncHandler } from '../utils/http.js';

const BEARER_PREFIX = 'Bearer ';

export const requireUser = asyncHandler(async (req, res, next) => {
  const authorizationHeader = req.get('authorization') || '';
  const token = authorizationHeader.startsWith(BEARER_PREFIX) ? authorizationHeader.slice(BEARER_PREFIX.length) : '';

  const session = readSignedToken(token);
  if (!session || session.role !== 'user') {
    return res.status(401).json({ message: 'Please log in' });
  }

  // A logout raises the user's session_version, so older tokens no longer match.
  const { rows } = await query('SELECT id, session_version FROM users WHERE id = $1', [session.userId]);
  if (!rows[0] || rows[0].session_version !== session.sessionVersion) {
    return res.status(401).json({ message: 'Please log in' });
  }

  req.userId = rows[0].id; // routes read the logged-in user from here
  next();
});
