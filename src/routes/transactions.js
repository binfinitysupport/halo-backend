import { Router } from 'express';
import { query, num, likePattern } from '../db.js';
import { asyncHandler, HttpError } from '../utils/http.js';

const router = Router();

const TYPES = ['deposit', 'withdrawal'];
const DONE_STATUS = { deposit: 'Credited', withdrawal: 'Paid' };

const present = (t) => ({
  id: t.id,
  txId: t.tx_id,
  type: t.type,
  user: { phone: t.phone, uuid: t.uuid },
  network: t.network,
  address: t.address,
  amount: num(t.amount),
  status: t.status,
  txHash: t.tx_hash,
  createdAt: t.created_at,
});

const BASE = `SELECT t.id, t.tx_id, t.type, t.network, t.address, t.amount, t.status, t.tx_hash, t.created_at,
  u.phone, u.uuid FROM transactions t JOIN users u ON u.id = t.user_id`;

// GET /api/transactions?type=deposit|withdrawal&status=All|Pending|Paid|Credited|Rejected&q=
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { type = 'deposit', status = 'All', q = '' } = req.query;
    if (!TYPES.includes(type)) throw new HttpError(400, 'Invalid type');
    const where = ['t.type = $1'];
    const params = [type];
    if (status !== 'All') {
      params.push(status);
      where.push(`t.status = $${params.length}`);
    }
    const term = String(q).trim();
    if (term) {
      params.push(likePattern(term));
      where.push(`(t.tx_id ILIKE $${params.length} OR u.phone ILIKE $${params.length})`);
    }
    const { rows } = await query(`${BASE} WHERE ${where.join(' AND ')} ORDER BY t.seq`, params);
    res.json(rows.map(present));
  })
);

// PATCH /api/transactions/:id  { status: 'Paid' | 'Rejected' | 'Credited' }
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { status } = req.body;
    if (!['Paid', 'Rejected', 'Credited'].includes(status)) throw new HttpError(400, 'Invalid status');
    const { rows } = await query(
      `UPDATE transactions SET status = $1 WHERE id = $2 AND status = 'Pending' RETURNING status`,
      [status, req.params.id]
    ).catch((e) => {
      if (e.code === '22P02') throw new HttpError(400, 'Invalid id');
      throw e;
    });
    if (!rows[0]) throw new HttpError(400, 'Only pending requests can be changed');
    res.json({ ok: true, status: rows[0].status });
  })
);

// POST /api/transactions/approve-all  { type }
router.post(
  '/approve-all',
  asyncHandler(async (req, res) => {
    const type = req.body.type;
    if (!TYPES.includes(type)) throw new HttpError(400, 'Invalid type');
    const { rowCount } = await query(
      `UPDATE transactions SET status = $1 WHERE type = $2 AND status = 'Pending'`,
      [DONE_STATUS[type], type]
    );
    res.json({ count: rowCount });
  })
);

// POST /api/transactions/:id/sync -> refresh status from the payment gateway
router.post(
  '/:id/sync',
  asyncHandler(async (req, res) => {
    const { rows } = await query('SELECT status FROM transactions WHERE id = $1', [req.params.id]).catch((e) => {
      if (e.code === '22P02') throw new HttpError(400, 'Invalid id');
      throw e;
    });
    if (!rows[0]) throw new HttpError(404, 'Transaction not found');
    // Hook your payment gateway here. For now it returns the stored status.
    res.json({ status: rows[0].status });
  })
);

export default router;
