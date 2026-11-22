// Routes for the admin Deposits and Withdrawals pages (both kinds live in the "transactions" table).
// Mounted at /api/transactions in index.js. Every route here needs an admin token (see middleware/require-admin.js).
import { Router } from 'express';
import { query, num, likePattern } from '../db.js';
import { asyncHandler, HttpError, rethrowInvalidIdAs400 } from '../utils/http.js';

const router = Router();

const TRANSACTION_TYPES = ['deposit', 'withdrawal'];
// The status a pending transaction gets when an admin approves it.
// Deposits are credited automatically by the payment webhook, so only withdrawals are approved here.
const COMPLETED_STATUS_BY_TYPE = { withdrawal: 'Paid' };
// The statuses an admin may set on a single transaction.
const ALLOWED_NEW_STATUSES = ['Paid', 'Rejected'];

// Database row → the JSON shape the admin app expects.
const toTransactionResponse = (transaction) => ({
  id: transaction.id,
  txId: transaction.tx_id,
  type: transaction.type,
  user: { phone: transaction.phone, uuid: transaction.uuid },
  network: transaction.network,
  address: transaction.address,
  amount: num(transaction.amount),
  status: transaction.status,
  txHash: transaction.tx_hash,
  createdAt: transaction.created_at,
});

// Each transaction (t) joined with its user (u), so the list can show the user's phone and UUID.
const SELECT_TRANSACTIONS_WITH_USER = `SELECT t.id, t.tx_id, t.type, t.network, t.address, t.amount, t.status, t.tx_hash, t.created_at,
  u.phone, u.uuid FROM transactions t JOIN users u ON u.id = t.user_id`;

// GET /api/transactions?type=deposit|withdrawal&status=All|Pending|Paid|Credited|Rejected&q=search
// → list of transactions of that type, optionally filtered by status and by search text (ID or phone)
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { type = 'deposit', status = 'All', q: searchQuery = '' } = req.query;
    if (!TRANSACTION_TYPES.includes(type)) {
      throw new HttpError(400, 'Invalid type');
    }

    // Build the WHERE conditions step by step; each value goes into `params` and is used as $1, $2, ...
    const conditions = ['t.type = $1'];
    const params = [type];

    if (status !== 'All') {
      params.push(status);
      conditions.push(`t.status = $${params.length}`);
    }

    const searchText = String(searchQuery).trim();
    if (searchText) {
      params.push(likePattern(searchText));
      const searchPlaceholder = `$${params.length}`;
      conditions.push(`(t.tx_id ILIKE ${searchPlaceholder} OR u.phone ILIKE ${searchPlaceholder})`);
    }

    const sql = `${SELECT_TRANSACTIONS_WITH_USER} WHERE ${conditions.join(' AND ')} ORDER BY t.seq`;
    const { rows } = await query(sql, params);
    res.json(rows.map(toTransactionResponse));
  })
);

// PATCH /api/transactions/:id  body { status: 'Paid' | 'Rejected' } → { ok: true, status }
// Only a pending withdrawal can be changed. Rejecting it returns the amount to the user's Flexible wallet
// and writes a ledger line, all in one statement.
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { status } = req.body;
    if (!ALLOWED_NEW_STATUSES.includes(status)) {
      throw new HttpError(400, 'Invalid status');
    }

    // The "AND status = 'Pending'" part makes sure an already-handled request is never changed twice.
    const { rows } = await query(
      `WITH changed AS (
         UPDATE transactions SET status = $1
         WHERE id = $2 AND type = 'withdrawal' AND status = 'Pending'
         RETURNING user_id, amount, tx_id
       ), refund AS (
         UPDATE users u SET flex_balance = u.flex_balance + changed.amount
         FROM changed WHERE u.id = changed.user_id AND $1 = 'Rejected'
         RETURNING u.id
       ), entry AS (
         INSERT INTO wallet_entries (user_id, wallet, kind, amount, reference, note)
         SELECT user_id, 'flexible', 'withdrawal_refund', amount, tx_id, 'Withdrawal rejected – amount returned'
         FROM changed WHERE $1 = 'Rejected'
       )
       SELECT $1::text AS status FROM changed`,
      [status, req.params.id]
    ).catch(rethrowInvalidIdAs400);

    if (!rows[0]) {
      throw new HttpError(400, 'Only pending withdrawal requests can be changed');
    }
    res.json({ ok: true, status: rows[0].status });
  })
);

// POST /api/transactions/approve-all  body { type: 'withdrawal' } → { count: number approved }
// Marks every pending withdrawal as paid. (Deposits are never approved by hand.)
router.post(
  '/approve-all',
  asyncHandler(async (req, res) => {
    const type = req.body.type;
    if (type !== 'withdrawal') {
      throw new HttpError(400, 'Only withdrawals can be approved in bulk');
    }

    const { rowCount } = await query(
      `UPDATE transactions SET status = $1 WHERE type = 'withdrawal' AND status = 'Pending'`,
      [COMPLETED_STATUS_BY_TYPE.withdrawal]
    );
    res.json({ count: rowCount });
  })
);

// POST /api/transactions/:id/sync → { status }
// Meant to refresh the status from the payment gateway. No gateway is connected yet,
// so for now it simply returns the status stored in the database.
router.post(
  '/:id/sync',
  asyncHandler(async (req, res) => {
    const { rows } = await query('SELECT status FROM transactions WHERE id = $1', [req.params.id])
      .catch(rethrowInvalidIdAs400);

    if (!rows[0]) {
      throw new HttpError(404, 'Transaction not found');
    }
    // TODO when a payment gateway exists: ask it for the latest status here and save it.
    res.json({ status: rows[0].status });
  })
);

export default router;
