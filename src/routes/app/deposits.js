// Deposit routes for the user app. Mounted under /api/app (behind requireUser in index.js).
// A deposit starts here: we ask OxaPay for an address that expires in 30 minutes. The balance is only
// credited later, when OxaPay calls our webhook (routes/webhooks.js) to say the payment was received.
import { Router } from 'express';
import crypto from 'node:crypto';
import { query, num } from '../../db.js';
import { asyncHandler, HttpError } from '../../utils/http.js';
import { createDepositPayment, isOxapayConfigured } from '../../services/oxapay.js';
import { DEPOSIT_OPTIONS, DEPOSIT_LIFETIME_MINUTES, roundMoney } from '../../rules/business-rules.js';

const router = Router();
const DEFAULT_MIN_DEPOSIT_USDT = 70;

// POST /api/app/deposits  body { option: 'USDT-TRC20' | 'USDT-BEP20' | 'USDC-BEP20' | 'ETH-BEP20', amount }
// → { trackId, label, amount, payAmount, payCurrency, network, address, qrCode, expiresAt }
router.post(
  '/deposits',
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const option = DEPOSIT_OPTIONS.find((candidate) => candidate.id === body.option);
    if (!option) throw new HttpError(400, 'Choose a deposit network');

    // Deposits are priced in US dollars; ETH has no price conversion yet, so it is refused for now.
    if (option.payCurrency === 'ETH') throw new HttpError(400, 'ETH deposits are not available yet');

    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, 'Enter a deposit amount');
    if (roundMoney(amount) !== amount) throw new HttpError(400, 'Use at most 2 decimal places');

    // The minimum is set by an admin in Settings; 70 USDT if nothing is saved.
    const settingsResult = await query("SELECT min_deposit FROM settings WHERE key = 'global'");
    const minDeposit = num(settingsResult.rows[0]?.min_deposit) || DEFAULT_MIN_DEPOSIT_USDT;
    if (amount < minDeposit) throw new HttpError(400, `Minimum deposit is ${minDeposit} USDT`);

    if (!isOxapayConfigured()) {
      throw new HttpError(503, 'Deposits are not available yet (payment gateway is not configured)');
    }

    const orderId = 'DP' + crypto.randomBytes(6).toString('hex').toUpperCase();
    const payment = await createDepositPayment({
      payCurrency: option.payCurrency,
      network: option.network,
      amountUsd: amount,
      orderId,
      lifetimeMinutes: DEPOSIT_LIFETIME_MINUTES,
      description: `Deposit ${option.label}`,
    });

    const expiresAt = new Date(Number(payment.expired_at) * 1000);
    // The track id from OxaPay becomes our transaction reference, so the webhook can find this row.
    await query(
      `INSERT INTO transactions (tx_id, type, user_id, network, address, amount, status, expires_at)
       VALUES ($1, 'deposit', $2, $3, $4, $5, 'Pending', $6)`,
      [String(payment.track_id), req.userId, option.label, payment.address, amount, expiresAt]
    );

    res.status(201).json({
      trackId: String(payment.track_id),
      label: option.label,
      amount,
      payAmount: Number(payment.pay_amount),
      payCurrency: payment.pay_currency,
      network: option.label,
      address: payment.address,
      memo: payment.memo || '',
      qrCode: payment.qr_code,
      expiresAt: expiresAt.getTime(),
    });
  })
);

// GET /api/app/deposits/:trackId → { trackId, amount, network, status, createdAt, expiresAt }
// status: "Pending" (waiting for payment or confirmation), "Credited" (added to Active strategy), "Expired".
router.get(
  '/deposits/:trackId',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT tx_id, amount, network, status, tx_hash, created_at, expires_at
       FROM transactions WHERE tx_id = $1 AND user_id = $2 AND type = 'deposit'`,
      [req.params.trackId, req.userId]
    );
    if (!rows[0]) throw new HttpError(404, 'Deposit not found');
    const row = rows[0];
    res.json({
      trackId: row.tx_id,
      amount: num(row.amount),
      network: row.network,
      status: row.status,
      txHash: row.tx_hash || null,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    });
  })
);

export default router;
