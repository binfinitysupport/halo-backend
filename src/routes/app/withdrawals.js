// Withdrawal routes for the user app. Mounted under /api/app (behind requireUser in index.js).
// A request takes the amount out of the user's Flexible wallet straight away and waits for an admin
// to approve it (paid) or reject it (money goes back to the Flexible wallet). See Technical Document 6.3.
import { Router } from 'express';
import crypto from 'node:crypto';
import { query, num } from '../../db.js';
import { asyncHandler, HttpError } from '../../utils/http.js';
import { passwordMatches } from '../../auth/passwords.js';
import {
  WITHDRAWAL_MIN_USDT,
  WITHDRAWAL_MAX_USDT,
  WITHDRAWAL_FEE_RATE,
  WITHDRAWAL_NETWORKS,
  KYC_REQUIRED_FOR_WITHDRAWAL,
  isValidWithdrawalAddress,
  roundMoney,
} from '../../rules/business-rules.js';

const router = Router();
const DEFAULT_MIN_WITHDRAWAL_USDT = WITHDRAWAL_MIN_USDT;

const toWithdrawalResponse = (row) => ({
  requestId: row.tx_id,
  network: row.network,
  address: row.address,
  amount: num(row.amount),
  fee: num(row.fee),
  netAmount: roundMoney(num(row.amount) - num(row.fee)),
  status: row.status,
  createdAt: row.created_at,
});

// POST /api/app/withdrawals
// body { network: 'TRC20' | 'BEP20', address, amount, fundPassword }
// → 201 { requestId, network, address, amount, fee, netAmount, status: "Pending" }
// amount is what leaves the Flexible wallet; the user receives netAmount (amount minus the 6% fee).
router.post(
  '/withdrawals',
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const network = String(body.network || '');
    const address = String(body.address || '').trim();
    const amount = Number(body.amount);

    if (!WITHDRAWAL_NETWORKS.includes(network)) throw new HttpError(400, 'Choose TRC20 or BEP20');
    if (!isValidWithdrawalAddress(network, address)) {
      throw new HttpError(400, `Enter a valid ${network} address`);
    }
    if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, 'Enter an amount');
    if (roundMoney(amount) !== amount) throw new HttpError(400, 'Use at most 2 decimal places');

    const settingsResult = await query("SELECT min_withdrawal FROM settings WHERE key = 'global'");
    const minimum = num(settingsResult.rows[0]?.min_withdrawal) || DEFAULT_MIN_WITHDRAWAL_USDT;
    if (amount < minimum) throw new HttpError(400, `Minimum withdrawal is ${minimum} USDT`);
    if (amount > WITHDRAWAL_MAX_USDT) {
      throw new HttpError(400, `Maximum withdrawal is ${WITHDRAWAL_MAX_USDT.toLocaleString('en-US')} USDT per request`);
    }

    const userResult = await query('SELECT fund_password_hash, kyc_status FROM users WHERE id = $1', [req.userId]);
    const user = userResult.rows[0];
    if (!(await passwordMatches(String(body.fundPassword || ''), user.fund_password_hash))) {
      throw new HttpError(400, 'Incorrect fund password');
    }
    if (KYC_REQUIRED_FOR_WITHDRAWAL && user.kyc_status !== 'verified') {
      throw new HttpError(400, 'Verify your identity before withdrawing');
    }

    const fee = roundMoney(amount * WITHDRAWAL_FEE_RATE);
    const requestId = 'WD' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString('hex').toUpperCase();

    // One statement: hold the money (only if the Flexible balance covers it), create the request and log the hold.
    const { rows } = await query(
      `WITH held AS (
         UPDATE users SET flex_balance = flex_balance - $2
         WHERE id = $1 AND flex_balance >= $2
         RETURNING id
       ), request AS (
         INSERT INTO transactions (tx_id, type, user_id, network, address, amount, fee, status)
         SELECT $3, 'withdrawal', id, $4, $5, $2, $6, 'Pending' FROM held
         RETURNING *
       ), entry AS (
         INSERT INTO wallet_entries (user_id, wallet, kind, amount, reference, note)
         SELECT id, 'flexible', 'withdrawal', -$2, $3, 'Withdrawal requested' FROM held
       )
       SELECT * FROM request`,
      [req.userId, amount, requestId, network, address, fee]
    );
    if (!rows[0]) throw new HttpError(400, 'Insufficient Flexible balance');

    res.status(201).json(toWithdrawalResponse(rows[0]));
  })
);

// GET /api/app/withdrawals → the user's withdrawal requests, newest first
router.get(
  '/withdrawals',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT tx_id, network, address, amount, fee, status, created_at
       FROM transactions WHERE user_id = $1 AND type = 'withdrawal'
       ORDER BY created_at DESC LIMIT 100`,
      [req.userId]
    );
    res.json(rows.map(toWithdrawalResponse));
  })
);

export default router;
