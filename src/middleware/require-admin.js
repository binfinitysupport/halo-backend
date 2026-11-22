// Gatekeeper for the admin API. index.js runs this before every admin route.
// The browser must send the token it got from POST /api/auth/login in this header:
//   Authorization: Bearer <token>
// If the token is missing, changed or expired, the request stops here with 401.
import { isValidAdminToken } from '../auth/admin-token.js';

const BEARER_PREFIX = 'Bearer ';

export function requireAdmin(req, res, next) {
  // Read the token from the header (empty string if the header is missing or in the wrong format).
  const authorizationHeader = req.get('authorization') || '';
  let token = '';
  if (authorizationHeader.startsWith(BEARER_PREFIX)) {
    token = authorizationHeader.slice(BEARER_PREFIX.length);
  }

  if (!isValidAdminToken(token)) {
    return res.status(401).json({ message: 'Please log in as admin' });
  }

  next(); // token is fine: continue to the route
}
