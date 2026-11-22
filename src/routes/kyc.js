// Routes for the admin "KYC review" page (identity checks waiting for approval).
// Mounted at /api/kyc in index.js. Every route here needs an admin token (see middleware/require-admin.js).
import { Router } from 'express';
import { query } from '../db.js';
import { asyncHandler, HttpError, rethrowInvalidIdAs400 } from '../utils/http.js';

const router = Router();

// GET /api/kyc → list of pending KYC requests (newest first), each with the user's name and phone
router.get(
  '/',
  asyncHandler(async (req, res) => {
    // Join each request (k) with its user (u) to get the name and phone number.
    const { rows } = await query(`
      SELECT k.id, k.country, k.document_type, k.document_number, k.submitted_at, u.phone,
             COALESCE(NULLIF(k.full_name, ''), u.name) AS name
      FROM kyc_requests k JOIN users u ON u.id = k.user_id
      WHERE k.status = 'pending' ORDER BY k.submitted_at DESC`);

    const pendingRequests = rows.map((request) => ({
      id: request.id,
      name: request.name,
      phone: request.phone,
      country: request.country,
      doc: request.document_type,
      num: request.document_number,
      submittedAt: request.submitted_at,
    }));
    res.json(pendingRequests);
  })
);

// POST /api/kyc/:id/decision  body { approve: true | false } → { ok: true }
// Approve: request becomes "approved" and the user "verified". Reject: request "rejected", user back to "none".
router.post(
  '/:id/decision',
  asyncHandler(async (req, res) => {
    const isApproved = Boolean(req.body.approve);
    const newRequestStatus = isApproved ? 'approved' : 'rejected';
    const newUserKycStatus = isApproved ? 'verified' : 'none';

    // Updates the request AND the user's KYC status in one statement, so the two can never get out of sync.
    // Step "k": change the request (only if it is still pending) and remember which user it belongs to.
    // Step "u": change that user's kyc_status.
    // The final SELECT returns the user id, or no row if the request wasn't found or was already decided.
    const { rows } = await query(
      `WITH k AS (
         UPDATE kyc_requests SET status = $1 WHERE id = $2 AND status = 'pending' RETURNING user_id
       ), u AS (
         UPDATE users SET kyc_status = $3 WHERE id IN (SELECT user_id FROM k)
       )
       SELECT user_id FROM k`,
      [newRequestStatus, req.params.id, newUserKycStatus]
    ).catch(rethrowInvalidIdAs400);

    if (!rows[0]) {
      throw new HttpError(404, 'Pending KYC request not found');
    }
    res.json({ ok: true });
  })
);

export default router;
