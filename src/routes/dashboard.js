import { Router } from 'express';
import { query, num } from '../db.js';
import { asyncHandler } from '../utils/http.js';
import { DUMMY } from '../dummy/generator.js';

const router = Router();

// Sidebar badge counts.
router.get(
  '/meta',
  asyncHandler(async (req, res) => {
    const { rows } = await query(`
      SELECT
        (SELECT count(*) FROM kyc_requests WHERE status = 'pending')::int AS kyc_pending,
        (SELECT count(*) FROM transactions WHERE type = 'withdrawal' AND status = 'Pending')::int AS withdrawals_pending`);
    res.json({ kycPending: rows[0].kyc_pending, withdrawalsPending: rows[0].withdrawals_pending });
  })
);

// Dashboard KPI cards (raw numbers; formatting happens in the Angular app).
router.get(
  '/dashboard/kpis',
  asyncHandler(async (req, res) => {
    const { rows } = await query(`
      SELECT
        (SELECT count(*) FROM users)::int                                                         AS user_count,
        (SELECT coalesce(sum(active_balance), 0) FROM users)                                      AS user_balances,
        (SELECT coalesce(sum(amount), 0) FROM transactions WHERE type = 'deposit' AND status = 'Credited') AS deposits_credited,
        (SELECT count(*) FROM transactions WHERE type = 'withdrawal' AND status = 'Pending')::int AS pending_count,
        (SELECT coalesce(sum(amount), 0) FROM transactions WHERE type = 'withdrawal' AND status = 'Pending') AS pending_amount,
        (SELECT coalesce(sum(fee), 0) FROM orders)                                                AS fee_revenue,
        (SELECT fee_percent FROM settings WHERE key = 'global')                                   AS fee_percent`);
    const r = rows[0];
    res.json({
      totalUsers: r.user_count + DUMMY.userCountOffset,
      activeToday: DUMMY.activeToday,
      userBalances: num(r.user_balances) + DUMMY.balanceOffset,
      depositsCredited: num(r.deposits_credited),
      pendingWithdrawals: { count: r.pending_count, amount: num(r.pending_amount) },
      feeRevenue: num(r.fee_revenue),
      feePercent: num(r.fee_percent),
    });
  })
);

export default router;
