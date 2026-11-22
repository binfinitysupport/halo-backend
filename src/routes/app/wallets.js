// Wallet routes for the user app: balances, billing history (bills) and transfers.
// Mounted under /api/app (behind requireUser in index.js).
// Money rules come from rules/business-rules.js and are described in the Technical Document, section 6.3.
import { Router } from 'express';
import { query } from '../../db.js';
import { asyncHandler, HttpError } from '../../utils/http.js';
import { passwordMatches } from '../../auth/passwords.js';
import { toWalletsResponse } from './format.js';
import {
  TRANSFER_MIN_TO_USER_USDT,
  TRANSFER_MIN_BETWEEN_WALLETS_USDT,
  USER_UUID_PATTERN,
  roundMoney,
} from '../../rules/business-rules.js';

const router = Router();

// Each bill filter in the app maps to the ledger "kinds" it includes.
// "Strategy Income" and "Team commission" are not part of the product rules we have built, so they show nothing.
const BILL_KINDS_BY_FILTER = {
  All: null,
  Recharge: ['recharge'],
  Withdrawal: ['withdrawal', 'withdrawal_refund'],
  Transfer: ['transfer_in', 'transfer_out', 'wallet_transfer_in', 'wallet_transfer_out'],
  'Strategy Income': [],
  'Team commission': [],
};

// Makes sure the amount is a positive number with at most 2 decimals.
function readPositiveAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, 'Enter an amount');
  if (roundMoney(amount) !== amount) throw new HttpError(400, 'Use at most 2 decimal places');
  return amount;
}

// GET /api/app/wallets → { flexible, active }
router.get(
  '/wallets',
  asyncHandler(async (req, res) => {
    const { rows } = await query('SELECT flex_balance, active_balance FROM users WHERE id = $1', [req.userId]);
    res.json(toWalletsResponse(rows[0]));
  })
);

// GET /api/app/bills?type=All|Recharge|Withdrawal|Transfer → the 100 newest entries
// Each entry: { id, wallet, kind, amount (+ in, - out), note, reference, createdAt }.
// Admin balance adjustments are included under "All" so the user sees every change to their money.
router.get(
  '/bills',
  asyncHandler(async (req, res) => {
    const filter = String(req.query.type || 'All');
    if (!(filter in BILL_KINDS_BY_FILTER)) throw new HttpError(400, 'Unknown bill filter');
    const kinds = BILL_KINDS_BY_FILTER[filter];

    // A withdrawal line shows the status of its request (Pending, Paid or Rejected).
    const { rows } = await query(
      `SELECT bills.id, bills.wallet, bills.kind, bills.amount, bills.reference, bills.note, bills.created_at,
              CASE WHEN bills.kind = 'withdrawal_refund' THEN 'Refunded'
                   ELSE COALESCE(request.status, 'Completed') END AS status
       FROM (
         SELECT id, wallet, kind, amount, reference, note, created_at
         FROM wallet_entries WHERE user_id = $1
         UNION ALL
         SELECT id, wallet, 'admin_adjustment' AS kind, amount, '' AS reference, note, created_at
         FROM balance_adjustments WHERE user_id = $1
       ) bills
       LEFT JOIN transactions request ON request.tx_id = bills.reference AND request.type = 'withdrawal'
       WHERE ($2::text[] IS NULL OR bills.kind = ANY($2::text[]))
       ORDER BY bills.created_at DESC
       LIMIT 100`,
      [req.userId, kinds]
    );

    res.json(rows.map((row) => ({
      id: row.id,
      wallet: row.wallet,
      kind: row.kind,
      amount: Number(row.amount),
      reference: row.reference,
      note: row.note,
      status: row.status,
      createdAt: row.created_at,
    })));
  })
);

// POST /api/app/transfers
// body { mode: 'user' | 'wallet', recipientUuid?, amount, fundPassword }
//   mode 'user'   – send from my Flexible wallet to another user's Flexible wallet (minimum 70 USDT)
//   mode 'wallet' – move from my Flexible wallet to my Active strategy wallet (minimum 10 USDT)
// → { ok: true }
router.post(
  '/transfers',
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const mode = body.mode;
    const amount = readPositiveAmount(body.amount);
    if (mode !== 'user' && mode !== 'wallet') throw new HttpError(400, 'Choose a transfer type');

    const senderResult = await query('SELECT fund_password_hash, uuid FROM users WHERE id = $1', [req.userId]);
    const sender = senderResult.rows[0];
    if (!(await passwordMatches(String(body.fundPassword || ''), sender.fund_password_hash))) {
      throw new HttpError(400, 'Incorrect fund password');
    }

    if (mode === 'wallet') {
      if (amount < TRANSFER_MIN_BETWEEN_WALLETS_USDT) {
        throw new HttpError(400, `Minimum transfer between your wallets is ${TRANSFER_MIN_BETWEEN_WALLETS_USDT} USDT`);
      }
      // One statement: move the money only if the Flexible balance covers it, and write both ledger lines.
      const { rows } = await query(
        `WITH moved AS (
           UPDATE users
           SET flex_balance = flex_balance - $2, active_balance = active_balance + $2
           WHERE id = $1 AND flex_balance >= $2
           RETURNING id
         ), entries AS (
           INSERT INTO wallet_entries (user_id, wallet, kind, amount, note)
           SELECT id, 'flexible', 'wallet_transfer_out', -$2, 'Moved to Active strategy wallet' FROM moved
           UNION ALL
           SELECT id, 'active', 'wallet_transfer_in', $2, 'Moved from Flexible wallet' FROM moved
         )
         SELECT COUNT(*)::int AS moved FROM moved`,
        [req.userId, amount]
      );
      if (rows[0].moved === 0) throw new HttpError(400, 'Insufficient Flexible balance');
      return res.json({ ok: true });
    }

    // mode === 'user'
    const recipientUuid = String(body.recipientUuid || '').trim();
    if (!USER_UUID_PATTERN.test(recipientUuid)) throw new HttpError(400, 'Enter a valid 7-digit UUID');
    if (recipientUuid === sender.uuid) throw new HttpError(400, 'You cannot transfer to your own account');
    if (amount < TRANSFER_MIN_TO_USER_USDT) {
      throw new HttpError(400, `Minimum transfer to another user is ${TRANSFER_MIN_TO_USER_USDT} USDT`);
    }

    // One statement: the sender is debited only if the recipient exists and the balance covers the amount,
    // and both sides get a ledger line. The recipient is credited to their Flexible wallet (assumption to confirm).
    const { rows } = await query(
      `WITH recipient AS (
         SELECT id FROM users WHERE uuid = $3 AND id <> $1
       ), sender AS (
         UPDATE users SET flex_balance = flex_balance - $2
         WHERE id = $1 AND flex_balance >= $2 AND EXISTS (SELECT 1 FROM recipient)
         RETURNING id
       ), receiver AS (
         UPDATE users SET flex_balance = flex_balance + $2
         WHERE id IN (SELECT id FROM recipient) AND EXISTS (SELECT 1 FROM sender)
         RETURNING id
       ), entries AS (
         INSERT INTO wallet_entries (user_id, wallet, kind, amount, reference, note)
         SELECT id, 'flexible', 'transfer_out', -$2, $3, 'Sent to user ' || $3 FROM sender
         UNION ALL
         SELECT id, 'flexible', 'transfer_in', $2, $4, 'Received from user ' || $4 FROM receiver
       )
       SELECT (SELECT COUNT(*) FROM sender)::int AS sent, (SELECT COUNT(*) FROM recipient)::int AS found`,
      [req.userId, amount, recipientUuid, sender.uuid]
    );
    if (rows[0].found === 0) throw new HttpError(400, 'Recipient not found');
    if (rows[0].sent === 0) throw new HttpError(400, 'Insufficient Flexible balance');
    res.json({ ok: true });
  })
);

export default router;
