import { Router } from 'express';
import { query } from '../db.js';
import { asyncHandler, HttpError } from '../utils/http.js';

const router = Router();

// GET /api/kyc -> pending requests, newest first
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { rows } = await query(`
      SELECT k.id, k.country, k.document_type, k.document_number, k.submitted_at, u.name, u.phone
      FROM kyc_requests k JOIN users u ON u.id = k.user_id
      WHERE k.status = 'pending' ORDER BY k.submitted_at DESC`);
    res.json(rows.map((k) => ({
      id: k.id,
      name: k.name,
      phone: k.phone,
      country: k.country,
      doc: k.document_type,
      num: k.document_number,
      submittedAt: k.submitted_at,
    })));
  })
);

// POST /api/kyc/:id/decision  { approve: boolean }
router.post(
  '/:id/decision',
  asyncHandler(async (req, res) => {
    const approve = Boolean(req.body.approve);
    // One statement: both updates commit together, in a single round trip.
    const { rows } = await query(
      `WITH k AS (
         UPDATE kyc_requests SET status = $1 WHERE id = $2 AND status = 'pending' RETURNING user_id
       ), u AS (
         UPDATE users SET kyc_status = $3 WHERE id IN (SELECT user_id FROM k)
       )
       SELECT user_id FROM k`,
      [approve ? 'approved' : 'rejected', req.params.id, approve ? 'verified' : 'none']
    ).catch((e) => {
      if (e.code === '22P02') throw new HttpError(400, 'Invalid id');
      throw e;
    });
    if (!rows[0]) throw new HttpError(404, 'Pending KYC request not found');
    res.json({ ok: true });
  })
);

export default router;
