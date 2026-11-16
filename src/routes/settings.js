import { Router } from 'express';
import { query, num } from '../db.js';
import { asyncHandler, HttpError } from '../utils/http.js';

const router = Router();
const TELEGRAM_KEYS = ['official', 'support', 'community'];

const SELECT_SETTINGS = 'SELECT * FROM settings WHERE key = $1';

const present = (s) => ({
  feePercent: num(s.fee_percent),
  trialAmount: num(s.trial_amount),
  minDeposit: num(s.min_deposit),
  minWithdrawal: num(s.min_withdrawal),
  maintenance: { enabled: s.maint_enabled, hours: s.maint_hours, startedAt: s.maint_started_at },
  telegram: { official: s.tg_official, support: s.tg_support, community: s.tg_community },
});

const load = async () => (await query(SELECT_SETTINGS, ['global'])).rows[0];

const nonNegative = (value, label) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new HttpError(400, `${label} must be a positive number`);
  return n;
};

router.get('/', asyncHandler(async (req, res) => res.json(present(await load()))));

// PUT /api/settings  { minDeposit, minWithdrawal, maintenanceHours }
router.put(
  '/',
  asyncHandler(async (req, res) => {
    const { minDeposit, minWithdrawal, maintenanceHours } = req.body;
    const sets = [];
    const params = [];
    if (minDeposit !== undefined) { params.push(nonNegative(minDeposit, 'Minimum deposit')); sets.push(`min_deposit = $${params.length}`); }
    if (minWithdrawal !== undefined) { params.push(nonNegative(minWithdrawal, 'Minimum withdrawal')); sets.push(`min_withdrawal = $${params.length}`); }
    if (maintenanceHours !== undefined) {
      const hours = Math.round(Number(maintenanceHours));
      if (!(hours >= 1 && hours <= 168)) throw new HttpError(400, 'Maintenance duration must be 1–168 hours');
      params.push(hours);
      sets.push(`maint_hours = $${params.length}`);
    }
    if (!sets.length) return res.json(present(await load()));
    const { rows } = await query(`UPDATE settings SET ${sets.join(', ')} WHERE key = 'global' RETURNING *`, params);
    res.json(present(rows[0]));
  })
);

// POST /api/settings/maintenance  { enabled }
router.post(
  '/maintenance',
  asyncHandler(async (req, res) => {
    const enabled = Boolean(req.body.enabled);
    const { rows } = await query(
      `UPDATE settings SET maint_enabled = $1, maint_started_at = $2 WHERE key = 'global' RETURNING *`,
      [enabled, enabled ? new Date() : null]
    );
    res.json(present(rows[0]));
  })
);

// PUT /api/settings/telegram/:key  { value }
router.put(
  '/telegram/:key',
  asyncHandler(async (req, res) => {
    const { key } = req.params;
    if (!TELEGRAM_KEYS.includes(key)) throw new HttpError(404, 'Unknown channel');
    const value = String(req.body.value ?? '').trim();
    if (value && !/^https?:\/\//.test(value)) throw new HttpError(400, 'Enter a valid URL starting with https://');
    const { rows } = await query(`UPDATE settings SET tg_${key} = $1 WHERE key = 'global' RETURNING *`, [value]);
    res.json(present(rows[0]));
  })
);

export default router;
