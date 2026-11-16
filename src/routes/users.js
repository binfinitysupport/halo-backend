import { Router } from 'express';
import { query, num, likePattern } from '../db.js';
import { asyncHandler, HttpError } from '../utils/http.js';
import { buildDummyTeam } from '../dummy/generator.js';

const router = Router();

const WALLETS = {
  flexible: { name: 'Flexible wallet', column: 'flex_balance' },
  active: { name: 'Active strategy wallet', column: 'active_balance' },
};

const USER_COLUMNS = `u.id, u.uuid, u.phone, u.name, u.vip, u.active_balance, u.flex_balance,
  u.team_size, u.kyc_status, u.status, u.joined_at, u.seq, u.referrer_id`;

const present = (r) => ({
  id: r.id,
  uuid: r.uuid,
  phone: r.phone,
  name: r.name,
  vip: r.vip,
  activeBalance: num(r.active_balance),
  flexBalance: num(r.flex_balance),
  teamSize: r.team_size,
  kycStatus: r.kyc_status,
  status: r.status,
  joined: r.joined_at,
});

// extra: additional SELECT columns (may reference u), so related data comes back in the same round trip.
async function findUser(id, extra = '') {
  const { rows } = await query(`SELECT ${USER_COLUMNS}${extra} FROM users u WHERE u.id = $1`, [id]).catch((e) => {
    if (e.code === '22P02') throw new HttpError(400, 'Invalid id'); // not a uuid
    throw e;
  });
  if (!rows[0]) throw new HttpError(404, 'User not found');
  return rows[0];
}

// GET /api/users?vip=All|VIP 0..4&q=search
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { vip = 'All', q = '' } = req.query;
    const where = [];
    const params = [];
    if (vip !== 'All') {
      const level = Number(String(vip).replace('VIP ', ''));
      if (!Number.isInteger(level)) throw new HttpError(400, 'Invalid VIP filter');
      params.push(level);
      where.push(`u.vip = $${params.length}`);
    }
    const term = String(q).trim();
    if (term) {
      params.push(likePattern(term));
      const p = `$${params.length}`;
      where.push(`(u.phone ILIKE ${p} OR u.uuid ILIKE ${p} OR u.name ILIKE ${p})`);
    }
    const sql = `SELECT ${USER_COLUMNS} FROM users u ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY u.seq`;
    const { rows } = await query(sql, params);
    res.json(rows.map(present));
  })
);

// GET /api/users/:id -> user + last 5 balance adjustments
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = await findUser(req.params.id, `,
      (SELECT coalesce(json_agg(a), '[]') FROM (
         SELECT wallet, note, amount, created_at FROM balance_adjustments
         WHERE user_id = u.id ORDER BY created_at DESC LIMIT 5) a) AS adjustments`);
    res.json({
      user: present(user),
      adjustments: user.adjustments.map((a) => ({
        wallet: WALLETS[a.wallet].name,
        note: a.note,
        amount: num(a.amount),
        createdAt: a.created_at,
      })),
    });
  })
);

// GET /api/users/:id/team
router.get(
  '/:id/team',
  asyncHandler(async (req, res) => {
    const user = await findUser(req.params.id, `,
      (SELECT json_build_object('phone', r.phone, 'uuid', r.uuid) FROM users r WHERE r.id = u.referrer_id) AS referrer`);
    const referrer = user.referrer;

    // DUMMY: replace with a real referral-tree query (WITH RECURSIVE over referrer_id) when team data is live.
    const levels = buildDummyTeam(user.seq ?? 0, user.team_size);
    const members = levels.flatMap((l) => l.members);
    const active = members.filter((m) => m.active).length;

    res.json({
      totals: {
        size: user.team_size,
        direct: levels[0].members.length,
        active,
        inactive: user.team_size - active,
        deposits: levels.reduce((a, l) => a + l.deposits, 0),
        commission: levels.reduce((a, l) => a + l.commission, 0),
      },
      upline: referrer ? { phone: referrer.phone, uuid: referrer.uuid } : null,
      levels,
    });
  })
);

// PATCH /api/users/:id  { vip?, status? }
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const sets = [];
    const params = [];
    if (req.body.vip !== undefined) {
      const vip = Number(req.body.vip);
      if (!Number.isInteger(vip) || vip < 0 || vip > 4) throw new HttpError(400, 'VIP level must be 0–4');
      params.push(vip);
      sets.push(`vip = $${params.length}`);
    }
    if (req.body.status !== undefined) {
      if (!['active', 'frozen'].includes(req.body.status)) throw new HttpError(400, 'Invalid status');
      params.push(req.body.status);
      sets.push(`status = $${params.length}`);
    }
    if (!sets.length) return res.json(present(await findUser(req.params.id)));
    params.push(req.params.id);
    const { rows } = await query(
      `UPDATE users u SET ${sets.join(', ')} WHERE u.id = $${params.length} RETURNING ${USER_COLUMNS}`, params
    ).catch((e) => {
      if (e.code === '22P02') throw new HttpError(400, 'Invalid id');
      throw e;
    });
    if (!rows[0]) throw new HttpError(404, 'User not found');
    res.json(present(rows[0]));
  })
);

// POST /api/users/:id/adjust  { wallet, direction: 'credit'|'debit', amount, note }
router.post(
  '/:id/adjust',
  asyncHandler(async (req, res) => {
    const { wallet = 'flexible', direction = 'credit', amount, note = '' } = req.body;
    const value = Number(amount);
    if (!(value > 0)) throw new HttpError(400, 'Enter an amount');
    if (!String(note).trim()) throw new HttpError(400, 'Add a description');
    const w = WALLETS[wallet];
    if (!w) throw new HttpError(400, 'Unknown wallet');

    const delta = (direction === 'debit' ? -1 : 1) * value;
    // One statement: lock the row, apply the change only if the balance stays >= 0, log it, and return the user.
    const { rows } = await query(
      `WITH cur AS (
         SELECT id, ${w.column} AS balance FROM users WHERE id = $1 FOR UPDATE
       ), upd AS (
         UPDATE users u SET ${w.column} = round(cur.balance + $2, 2)
         FROM cur WHERE u.id = cur.id AND cur.balance + $2 >= 0
         RETURNING ${USER_COLUMNS}
       ), log AS (
         INSERT INTO balance_adjustments (user_id, wallet, note, amount)
         SELECT id, $3, $4, $2 FROM upd
       )
       SELECT (SELECT count(*) FROM cur)::int AS found, upd.* FROM (SELECT 1) one LEFT JOIN upd ON true`,
      [req.params.id, delta, wallet, String(note).trim()]
    ).catch((e) => {
      if (e.code === '22P02') throw new HttpError(400, 'Invalid id');
      throw e;
    });
    if (!rows[0].found) throw new HttpError(404, 'User not found');
    if (!rows[0].id) throw new HttpError(400, `Amount exceeds ${w.name} balance`);
    res.json(present(rows[0]));
  })
);

// POST /api/users/:id/reset-password
router.post(
  '/:id/reset-password',
  asyncHandler(async (req, res) => {
    const user = await findUser(req.params.id);
    // Hook your email/SMS provider here.
    res.json({ ok: true, sentTo: user.phone });
  })
);

export default router;
