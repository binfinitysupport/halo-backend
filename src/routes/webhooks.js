// Callbacks from the payment gateway (OxaPay). Mounted at /api/webhooks in index.js, BEFORE the normal
// JSON parser, because the signature has to be checked against the exact bytes OxaPay sent.
// This route is public: OxaPay can't log in, so the signature is its only proof.
import { Router } from 'express';
import express from 'express';
import { query } from '../db.js';
import { isValidOxapaySignature } from '../services/oxapay.js';

const router = Router();
const MAX_CALLBACK_BYTES = 1024 * 1024;

// POST /api/webhooks/oxapay (raw body, signed in the "HMAC" header)
// "paid"    → the deposit is credited to the user's Active strategy wallet, once.
// "expired" → the deposit address ran out of time before any payment arrived.
// Any other status is acknowledged and ignored. We always answer "ok" to valid callbacks;
// OxaPay retries any other answer.
router.post(
  '/oxapay',
  express.raw({ type: '*/*', limit: MAX_CALLBACK_BYTES }),
  async (req, res) => {
    const rawBody = req.body;
    if (!isValidOxapaySignature(rawBody, req.get('HMAC'))) {
      return res.status(400).send('Invalid signature');
    }

    let callback;
    try {
      callback = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return res.status(400).send('Invalid JSON');
    }

    const trackId = String(callback.track_id || '');
    const status = String(callback.status || '').toLowerCase();
    if (!trackId) return res.status(400).send('Missing track_id');

    try {
      if (status === 'paid') {
        // The amount credited is the amount we recorded when the deposit was created, never the callback's.
        // The "AND status = 'Pending'" part makes a repeated callback do nothing the second time.
        // The blockchain transaction hash comes with the callback (txs[0].tx_hash); it is stored for the user to see.
        const txHash = String(callback.txs?.[0]?.tx_hash || '');
        await query(
          `WITH credited AS (
             UPDATE transactions SET status = 'Credited', tx_hash = $2
             WHERE tx_id = $1 AND type = 'deposit' AND status = 'Pending'
             RETURNING user_id, amount
           ), balances AS (
             UPDATE users u SET active_balance = u.active_balance + credited.amount
             FROM credited WHERE u.id = credited.user_id
             RETURNING u.id, credited.amount
           )
           INSERT INTO wallet_entries (user_id, wallet, kind, amount, reference, note)
           SELECT id, 'active', 'recharge', amount, $1, 'Deposit credited' FROM balances`,
          [trackId, txHash]
        );
      } else if (status === 'expired') {
        await query(
          "UPDATE transactions SET status = 'Expired' WHERE tx_id = $1 AND type = 'deposit' AND status = 'Pending'",
          [trackId]
        );
      }
      return res.status(200).send('ok');
    } catch (error) {
      console.error('OxaPay webhook failed:', error.message);
      return res.status(500).send('Server error');
    }
  }
);

export default router;
