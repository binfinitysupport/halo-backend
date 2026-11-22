// Routes for the admin Users page and the user detail drawer (profile, wallets, team).
// Mounted at /api/users in index.js. Every route here needs an admin token (see middleware/require-admin.js).
import { Router } from 'express';
import { query, num, likePattern } from '../db.js';
import { asyncHandler, HttpError, rethrowInvalidIdAs400 } from '../utils/http.js';
import { buildDummyTeam } from '../dummy/generator.js';

const router = Router();

// The two wallets an admin can adjust: display name + the column in the users table that holds the balance.
const WALLETS = {
  flexible: { name: 'Flexible wallet', column: 'flex_balance' },
  active: { name: 'Active strategy wallet', column: 'active_balance' },
};

const LOWEST_VIP_LEVEL = 0;
const HIGHEST_VIP_LEVEL = 4;
const ACCOUNT_STATUSES = ['active', 'frozen'];
const RECENT_ADJUSTMENTS_SHOWN = 5;

// The user columns every route reads. "u" is the short name (alias) for the users table in each query.
const USER_COLUMNS = `u.id, u.uuid, u.phone, u.name, u.vip, u.active_balance, u.flex_balance,
  u.team_size, u.kyc_status, u.status, u.joined_at, u.seq, u.referrer_id`;

// Database row → the JSON shape the admin app expects.
const toUserResponse = (user) => ({
  id: user.id,
  uuid: user.uuid,
  phone: user.phone,
  name: user.name,
  vip: user.vip,
  activeBalance: num(user.active_balance),
  flexBalance: num(user.flex_balance),
  teamSize: user.team_size,
  kycStatus: user.kyc_status,
  status: user.status,
  joined: user.joined_at,
});

// Loads one user by id, or stops the request with 404 (unknown id) / 400 (malformed id).
// extraColumns: extra SQL columns to read in the same query (they may refer to "u"),
// so related data arrives in one trip to the database instead of two.
async function findUser(id, extraColumns = '') {
  const sql = `SELECT ${USER_COLUMNS}${extraColumns} FROM users u WHERE u.id = $1`;
  const { rows } = await query(sql, [id]).catch(rethrowInvalidIdAs400);
  if (!rows[0]) {
    throw new HttpError(404, 'User not found');
  }
  return rows[0];
}

// GET /api/users?vip=All|VIP 0..VIP 4&q=search → list of users, filtered by VIP level and search text
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { vip = 'All', q: searchQuery = '' } = req.query;

    // Build the WHERE conditions step by step; each value goes into `params` and is used as $1, $2, ...
    const conditions = [];
    const params = [];

    if (vip !== 'All') {
      const level = Number(String(vip).replace('VIP ', '')); // "VIP 2" -> 2
      if (!Number.isInteger(level)) {
        throw new HttpError(400, 'Invalid VIP filter');
      }
      params.push(level);
      conditions.push(`u.vip = $${params.length}`);
    }

    const searchText = String(searchQuery).trim();
    if (searchText) {
      params.push(likePattern(searchText));
      const searchPlaceholder = `$${params.length}`;
      // Match the text anywhere in the phone number, UUID or name.
      conditions.push(`(u.phone ILIKE ${searchPlaceholder} OR u.uuid ILIKE ${searchPlaceholder} OR u.name ILIKE ${searchPlaceholder})`);
    }

    let whereClause = '';
    if (conditions.length > 0) {
      whereClause = 'WHERE ' + conditions.join(' AND ');
    }

    const sql = `SELECT ${USER_COLUMNS} FROM users u ${whereClause} ORDER BY u.seq`;
    const { rows } = await query(sql, params);
    res.json(rows.map(toUserResponse));
  })
);

// GET /api/users/:id → { user, adjustments: the 5 most recent balance adjustments }
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    // Extra column "adjustments": the user's latest balance adjustments as a JSON array,
    // read in the same query as the user (json_agg turns rows into an array; '[]' if there are none).
    const user = await findUser(req.params.id, `,
      (SELECT coalesce(json_agg(a), '[]') FROM (
         SELECT wallet, note, amount, created_at FROM balance_adjustments
         WHERE user_id = u.id ORDER BY created_at DESC LIMIT ${RECENT_ADJUSTMENTS_SHOWN}) a) AS adjustments`);

    const recentAdjustments = user.adjustments.map((adjustment) => ({
      wallet: WALLETS[adjustment.wallet].name,
      note: adjustment.note,
      amount: num(adjustment.amount),
      createdAt: adjustment.created_at,
    }));

    res.json({
      user: toUserResponse(user),
      adjustments: recentAdjustments,
    });
  })
);

// GET /api/users/:id/team → { totals, upline (who invited this user), levels }
router.get(
  '/:id/team',
  asyncHandler(async (req, res) => {
    // Extra column "referrer": the phone and UUID of the user who invited this one (null if nobody did).
    const user = await findUser(req.params.id, `,
      (SELECT json_build_object('phone', r.phone, 'uuid', r.uuid) FROM users r WHERE r.id = u.referrer_id) AS referrer`);
    const referrer = user.referrer;

    // DUMMY DATA: the team is generated, not read from the database.
    // Replace with a real referral-tree query (WITH RECURSIVE over referrer_id) once team data exists.
    const levels = buildDummyTeam(user.seq ?? 0, user.team_size);

    const allMembers = levels.flatMap((level) => level.members);
    const activeCount = allMembers.filter((member) => member.active).length;
    const totalDeposits = levels.reduce((total, level) => total + level.deposits, 0);
    const totalCommission = levels.reduce((total, level) => total + level.commission, 0);

    res.json({
      totals: {
        size: user.team_size,
        direct: levels[0].members.length,
        active: activeCount,
        inactive: user.team_size - activeCount,
        deposits: totalDeposits,
        commission: totalCommission,
      },
      upline: referrer ? { phone: referrer.phone, uuid: referrer.uuid } : null,
      levels,
    });
  })
);

// PATCH /api/users/:id  body { vip?, status? } → the updated user
// vip: 0–4. status: 'active' or 'frozen'. Only the fields that are sent get changed.
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    // Build the "SET ..." part of the SQL from the fields that were sent.
    const setClauses = [];
    const params = [];

    if (req.body.vip !== undefined) {
      const vip = Number(req.body.vip);
      const isValidLevel = Number.isInteger(vip) && vip >= LOWEST_VIP_LEVEL && vip <= HIGHEST_VIP_LEVEL;
      if (!isValidLevel) {
        throw new HttpError(400, 'VIP level must be 0–4');
      }
      params.push(vip);
      setClauses.push(`vip = $${params.length}`);
    }

    if (req.body.status !== undefined) {
      if (!ACCOUNT_STATUSES.includes(req.body.status)) {
        throw new HttpError(400, 'Invalid status');
      }
      params.push(req.body.status);
      setClauses.push(`status = $${params.length}`);
    }

    // Nothing to change: just return the user.
    if (setClauses.length === 0) {
      const user = await findUser(req.params.id);
      return res.json(toUserResponse(user));
    }

    // Save and read the updated user back in the same statement (RETURNING ...).
    params.push(req.params.id);
    const { rows } = await query(
      `UPDATE users u SET ${setClauses.join(', ')} WHERE u.id = $${params.length} RETURNING ${USER_COLUMNS}`,
      params
    ).catch(rethrowInvalidIdAs400);

    if (!rows[0]) {
      throw new HttpError(404, 'User not found');
    }
    res.json(toUserResponse(rows[0]));
  })
);

// POST /api/users/:id/adjust  body { wallet: 'flexible'|'active', direction: 'credit'|'debit', amount, note }
// → the updated user. Adds to (credit) or takes from (debit) one wallet and records why in balance_adjustments.
router.post(
  '/:id/adjust',
  asyncHandler(async (req, res) => {
    const { wallet = 'flexible', direction = 'credit', amount, note = '' } = req.body;

    // Check the input first.
    const amountValue = Number(amount);
    if (!(amountValue > 0)) {
      throw new HttpError(400, 'Enter an amount');
    }
    const description = String(note).trim();
    if (!description) {
      throw new HttpError(400, 'Add a description');
    }
    const walletInfo = WALLETS[wallet];
    if (!walletInfo) {
      throw new HttpError(400, 'Unknown wallet');
    }

    // Credit adds the amount, debit subtracts it.
    const signedAmount = direction === 'debit' ? -amountValue : amountValue;

    // Everything happens in ONE statement, so the balance change and its log entry can never get out of sync:
    //   "cur": read the current balance and lock the row (FOR UPDATE) so two admins can't change it at once
    //   "upd": change the balance, but only if it would not go below 0
    //   "log": record the adjustment, only if "upd" actually changed something
    //   final SELECT: "found" says whether the user exists; the other columns are the updated user
    //                 (all empty when the balance was too low and nothing changed).
    // walletInfo.column comes from our own WALLETS list, so it's safe to put in the SQL text.
    const { rows } = await query(
      `WITH cur AS (
         SELECT id, ${walletInfo.column} AS balance FROM users WHERE id = $1 FOR UPDATE
       ), upd AS (
         UPDATE users u SET ${walletInfo.column} = round(cur.balance + $2, 2)
         FROM cur WHERE u.id = cur.id AND cur.balance + $2 >= 0
         RETURNING ${USER_COLUMNS}
       ), log AS (
         INSERT INTO balance_adjustments (user_id, wallet, note, amount)
         SELECT id, $3, $4, $2 FROM upd
       )
       SELECT (SELECT count(*) FROM cur)::int AS found, upd.* FROM (SELECT 1) one LEFT JOIN upd ON true`,
      [req.params.id, signedAmount, wallet, description]
    ).catch(rethrowInvalidIdAs400);

    const result = rows[0];
    if (!result.found) {
      throw new HttpError(404, 'User not found');
    }
    if (!result.id) {
      throw new HttpError(400, `Amount exceeds ${walletInfo.name} balance`);
    }
    res.json(toUserResponse(result));
  })
);

// POST /api/users/:id/reset-password → { ok: true, sentTo: phone }
// No email/SMS provider is connected yet, so this only confirms which phone a reset would go to.
router.post(
  '/:id/reset-password',
  asyncHandler(async (req, res) => {
    const user = await findUser(req.params.id);
    // TODO when an email/SMS provider exists: send the reset link or code here.
    res.json({ ok: true, sentTo: user.phone });
  })
);

export default router;
