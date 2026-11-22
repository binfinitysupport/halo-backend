// Routes for the admin Settings page: deposit/withdrawal minimums, maintenance mode and Telegram links.
// Mounted at /api/settings in index.js. Every route here needs an admin token (see middleware/require-admin.js).
// All settings are stored in ONE row of the "settings" table, the row with key = 'global'.
import { Router } from 'express';
import { query, num } from '../db.js';
import { asyncHandler, HttpError } from '../utils/http.js';

const router = Router();

const TELEGRAM_CHANNELS = ['official', 'support', 'community'];
const MIN_MAINTENANCE_HOURS = 1;
const MAX_MAINTENANCE_HOURS = 168; // one week

// Database row → the JSON shape the admin app expects.
const toSettingsResponse = (settings) => ({
  feePercent: num(settings.fee_percent),
  trialAmount: num(settings.trial_amount),
  minDeposit: num(settings.min_deposit),
  minWithdrawal: num(settings.min_withdrawal),
  maintenance: {
    enabled: settings.maint_enabled,
    hours: settings.maint_hours,
    startedAt: settings.maint_started_at,
  },
  telegram: {
    official: settings.tg_official,
    support: settings.tg_support,
    community: settings.tg_community,
  },
});

// Reads the single settings row.
async function loadGlobalSettings() {
  const { rows } = await query('SELECT * FROM settings WHERE key = $1', ['global']);
  return rows[0];
}

// Returns the value as a number, or stops the request with 400 if it isn't a number of 0 or more.
function requireNonNegativeNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new HttpError(400, `${label} must be a positive number`);
  }
  return number;
}

// GET /api/settings → all settings (see toSettingsResponse for the shape)
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const settings = await loadGlobalSettings();
    res.json(toSettingsResponse(settings));
  })
);

// PUT /api/settings  body { minDeposit?, minWithdrawal?, maintenanceHours? } → all settings after saving
// Only the fields that are sent get changed.
router.put(
  '/',
  asyncHandler(async (req, res) => {
    const { minDeposit, minWithdrawal, maintenanceHours } = req.body;

    // Build the "SET ..." part of the SQL from the fields that were sent (values go in `params` as $1, $2, ...).
    const setClauses = [];
    const params = [];
    if (minDeposit !== undefined) {
      params.push(requireNonNegativeNumber(minDeposit, 'Minimum deposit'));
      setClauses.push(`min_deposit = $${params.length}`);
    }
    if (minWithdrawal !== undefined) {
      params.push(requireNonNegativeNumber(minWithdrawal, 'Minimum withdrawal'));
      setClauses.push(`min_withdrawal = $${params.length}`);
    }
    if (maintenanceHours !== undefined) {
      const hours = Math.round(Number(maintenanceHours));
      const isInRange = hours >= MIN_MAINTENANCE_HOURS && hours <= MAX_MAINTENANCE_HOURS;
      if (!isInRange) {
        throw new HttpError(400, 'Maintenance duration must be 1–168 hours');
      }
      params.push(hours);
      setClauses.push(`maint_hours = $${params.length}`);
    }

    // Nothing to change: just return the current settings.
    if (setClauses.length === 0) {
      const settings = await loadGlobalSettings();
      return res.json(toSettingsResponse(settings));
    }

    // Save and get the updated row back in the same statement (RETURNING *).
    const { rows } = await query(`UPDATE settings SET ${setClauses.join(', ')} WHERE key = 'global' RETURNING *`, params);
    res.json(toSettingsResponse(rows[0]));
  })
);

// POST /api/settings/maintenance  body { enabled } → all settings after saving
// Turning it on also records the start time (the user app uses it for the maintenance countdown).
router.post(
  '/maintenance',
  asyncHandler(async (req, res) => {
    const enabled = Boolean(req.body.enabled);
    const startedAt = enabled ? new Date() : null;

    const { rows } = await query(
      `UPDATE settings SET maint_enabled = $1, maint_started_at = $2 WHERE key = 'global' RETURNING *`,
      [enabled, startedAt]
    );
    res.json(toSettingsResponse(rows[0]));
  })
);

// PUT /api/settings/telegram/:key  body { value } → all settings after saving
// :key is one of official | support | community. An empty value clears the link.
router.put(
  '/telegram/:key',
  asyncHandler(async (req, res) => {
    const channel = req.params.key;
    if (!TELEGRAM_CHANNELS.includes(channel)) {
      throw new HttpError(404, 'Unknown channel');
    }

    const link = String(req.body.value ?? '').trim();
    const looksLikeUrl = /^https?:\/\//.test(link);
    if (link && !looksLikeUrl) {
      throw new HttpError(400, 'Enter a valid URL starting with https://');
    }

    // The column name (tg_official, tg_support, tg_community) is safe to put in the SQL text because
    // `channel` was checked against TELEGRAM_CHANNELS above. The link itself goes in as $1.
    const { rows } = await query(`UPDATE settings SET tg_${channel} = $1 WHERE key = 'global' RETURNING *`, [link]);
    res.json(toSettingsResponse(rows[0]));
  })
);

export default router;
