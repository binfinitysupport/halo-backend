// Identity verification (KYC) routes for the user app. Mounted under /api/app (behind requireUser).
// A submission goes into the admin "KYC review" queue (routes/kyc.js); the admin approves or rejects it there.
import { Router } from 'express';
import { query } from '../../db.js';
import { asyncHandler, HttpError } from '../../utils/http.js';
import { KYC_ID_TYPES, KYC_IMAGE_MAX_CHARACTERS } from '../../rules/business-rules.js';

const router = Router();
const MIN_NAME_LENGTH = 2;
const MAX_ID_NUMBER_LENGTH = 40;

// Images are data URLs ("data:image/jpeg;base64,...") so they can travel inside the JSON body.
function readImage(value, label) {
  const image = String(value || '');
  if (!image.startsWith('data:image/')) throw new HttpError(400, `Upload the ${label} photo`);
  if (image.length > KYC_IMAGE_MAX_CHARACTERS) throw new HttpError(400, `The ${label} photo is too large`);
  return image;
}

// GET /api/app/kyc → { status, submittedAt, documentType, nationality }
// status: "none" (not started), "pending" (under review), "verified".
router.get(
  '/kyc',
  asyncHandler(async (req, res) => {
    const userResult = await query('SELECT kyc_status FROM users WHERE id = $1', [req.userId]);
    const latestResult = await query(
      `SELECT country, document_type, submitted_at FROM kyc_requests
       WHERE user_id = $1 ORDER BY submitted_at DESC LIMIT 1`,
      [req.userId]
    );
    const latest = latestResult.rows[0];
    res.json({
      status: userResult.rows[0].kyc_status,
      submittedAt: latest ? latest.submitted_at : null,
      documentType: latest ? latest.document_type : null,
      nationality: latest ? latest.country : null,
    });
  })
);

// POST /api/app/kyc
// body { nationality, fullName, idType, idNumber, frontImage, backImage }
// idType: "ID card" | "Passport" | "Driver's license"
// → 201 { status: "pending", submittedAt }
router.post(
  '/kyc',
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const nationality = String(body.nationality || '').trim();
    const fullName = String(body.fullName || '').trim();
    const idType = String(body.idType || '');
    const idNumber = String(body.idNumber || '').trim();

    if (!nationality) throw new HttpError(400, 'Choose your nationality');
    if (fullName.length < MIN_NAME_LENGTH) throw new HttpError(400, 'Enter your full name');
    if (!KYC_ID_TYPES.includes(idType)) throw new HttpError(400, 'Choose an ID type');
    if (!idNumber || idNumber.length > MAX_ID_NUMBER_LENGTH) throw new HttpError(400, 'Enter your ID number');
    const frontImage = readImage(body.frontImage, 'front');
    const backImage = readImage(body.backImage, 'back');

    const userResult = await query('SELECT kyc_status FROM users WHERE id = $1', [req.userId]);
    if (userResult.rows[0].kyc_status === 'verified') throw new HttpError(400, 'Your identity is already verified');
    if (userResult.rows[0].kyc_status === 'pending') throw new HttpError(400, 'Your documents are already under review');

    // One statement: create the review request and mark the account as pending.
    const { rows } = await query(
      `WITH request AS (
         INSERT INTO kyc_requests (user_id, country, document_type, document_number, full_name, front_image, back_image, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
         RETURNING submitted_at
       ), account AS (
         UPDATE users SET kyc_status = 'pending' WHERE id = $1 RETURNING id
       )
       SELECT submitted_at FROM request`,
      [req.userId, nationality, idType, idNumber, fullName, frontImage, backImage]
    );

    res.status(201).json({ status: 'pending', submittedAt: rows[0].submitted_at });
  })
);

export default router;
