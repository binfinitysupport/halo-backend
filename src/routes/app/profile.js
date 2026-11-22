// Profile route for the logged-in user. Mounted under /api/app (behind requireUser in index.js).
import { Router } from 'express';
import { query } from '../../db.js';
import { asyncHandler, HttpError } from '../../utils/http.js';
import { toProfileResponse, toWalletsResponse } from './format.js';

const router = Router();

// GET /api/app/me → { user, wallets }
router.get(
  '/me',
  asyncHandler(async (req, res) => {
    const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.userId]);
    if (!rows[0]) throw new HttpError(404, 'Account not found');
    res.json({ user: toProfileResponse(rows[0]), wallets: toWalletsResponse(rows[0]) });
  })
);

export default router;
