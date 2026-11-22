// Admin login route. Mounted at /api/auth in index.js, so the path below is POST /api/auth/login.
// This route is PUBLIC (no token needed) – it is how the admin gets a token in the first place.
// Too many wrong passwords from one address lock it out for 15 minutes (see auth/login-limiter.js).
import { Router } from 'express';
import { areValidAdminCredentials, createAdminToken } from '../auth/admin-token.js';
import { createLoginLimiter } from '../auth/login-limiter.js';

const router = Router();
const adminLoginLimiter = createLoginLimiter();

// POST /api/auth/login  body { email, password } → { token, expiresAt }
// Errors: 401 wrong email/password, 429 too many failed attempts.
router.post('/login', (req, res) => {
  const clientAddress = req.ip;

  // 1. Locked out? Tell the user how long to wait.
  const lockMs = adminLoginLimiter.lockedForMs(clientAddress);
  if (lockMs > 0) {
    const minutesLeft = Math.ceil(lockMs / (60 * 1000));
    return res.status(429).json({ message: `Too many attempts. Try again in ${minutesLeft} min` });
  }

  // 2. Check the email and password against ADMIN_EMAIL / ADMIN_PASSWORD in .env.
  const { email = '', password = '' } = req.body || {};
  if (!areValidAdminCredentials(email, password)) {
    adminLoginLimiter.recordFailure(clientAddress);
    return res.status(401).json({ message: 'Incorrect account or password' });
  }

  // 3. Success: clear the failure count and hand out a new token.
  adminLoginLimiter.clear(clientAddress);
  res.json(createAdminToken());
});

export default router;
