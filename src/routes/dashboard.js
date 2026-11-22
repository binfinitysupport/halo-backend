// Routes for the admin Dashboard page and the sidebar badges.
// Mounted at /api in index.js, so the paths below become /api/meta and /api/dashboard/kpis.
// Every route here needs an admin token (see middleware/require-admin.js).
import { Router } from 'express';
import { query, num } from '../db.js';
import { asyncHandler } from '../utils/http.js';
import { DUMMY } from '../dummy/generator.js';

const router = Router();

// GET /api/meta → the red badge numbers in the sidebar: { kycPending, withdrawalsPending }
router.get(
  '/meta',
  asyncHandler(async (req, res) => {
    // Two counts in one query (one trip to the database): pending KYC requests and pending withdrawals.
    const { rows } = await query(`
      SELECT
        (SELECT count(*) FROM kyc_requests WHERE status = 'pending')::int AS kyc_pending,
        (SELECT count(*) FROM transactions WHERE type = 'withdrawal' AND status = 'Pending')::int AS withdrawals_pending`);

    const counts = rows[0];
    res.json({
      kycPending: counts.kyc_pending,
      withdrawalsPending: counts.withdrawals_pending,
    });
  })
);

// GET /api/dashboard/kpis → the numbers on the dashboard cards.
// Raw numbers only; the Angular app formats them (thousands separators, "USDT", etc.).
router.get(
  '/dashboard/kpis',
  asyncHandler(async (req, res) => {
    // All the totals in one query. Each line is a small sub-query; coalesce(…, 0) turns "no rows" into 0.
    const { rows } = await query(`
      SELECT
        (SELECT count(*) FROM users)::int                                                         AS user_count,
        (SELECT coalesce(sum(active_balance), 0) FROM users)                                      AS user_balances,
        (SELECT coalesce(sum(amount), 0) FROM transactions WHERE type = 'deposit' AND status = 'Credited') AS deposits_credited,
        (SELECT count(*) FROM transactions WHERE type = 'withdrawal' AND status = 'Pending')::int AS pending_count,
        (SELECT coalesce(sum(amount), 0) FROM transactions WHERE type = 'withdrawal' AND status = 'Pending') AS pending_amount,
        (SELECT coalesce(sum(fee), 0) FROM orders)                                                AS fee_revenue,
        (SELECT fee_percent FROM settings WHERE key = 'global')                                   AS fee_percent`);

    const totals = rows[0];
    // DUMMY.* values are demo offsets so the dashboard looks populated; remove them once real data exists.
    res.json({
      totalUsers: totals.user_count + DUMMY.userCountOffset,
      activeToday: DUMMY.activeToday,
      userBalances: num(totals.user_balances) + DUMMY.balanceOffset,
      depositsCredited: num(totals.deposits_credited),
      pendingWithdrawals: {
        count: totals.pending_count,
        amount: num(totals.pending_amount),
      },
      feeRevenue: num(totals.fee_revenue),
      feePercent: num(totals.fee_percent),
    });
  })
);

export default router;
