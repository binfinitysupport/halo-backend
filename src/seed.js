import 'dotenv/config';
import { pool } from './db.js';
import * as dummy from './dummy/generator.js';

// Loads the prototype's dummy values. Re-running it wipes the dummy data first.
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('TRUNCATE orders, balance_adjustments, kyc_requests, transactions, banners, users RESTART IDENTITY CASCADE');
  await client.query("UPDATE settings SET fee_percent=30, trial_amount=3, min_deposit=70, min_withdrawal=20, maint_enabled=false, maint_hours=2, maint_started_at=NULL, tg_official='https://t.me/halo_official', tg_support='https://t.me/halo_support', tg_community='', announcement_text='VIP 4 is now live with QS-2 servers. Scheduled maintenance on Nov 10, 02:00 UTC.', announcement_live=true WHERE key='global'");

  // 1) Users. Referrer = users[(seq + 7) % 36], as in the prototype.
  const userRows = dummy.generateUsers(36);
  const ids = [];
  for (const u of userRows) {
    const r = await client.query(
      `INSERT INTO users (seq, uuid, phone, name, vip, active_balance, flex_balance, team_size, kyc_status, status, joined_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [u.seq, u.uuid, u.phone, u.name, u.vip, u.activeBalance, u.flexBalance, u.teamSize, u.kycStatus, u.status, u.joined]
    );
    ids.push(r.rows[0].id);
  }
  for (let i = 0; i < ids.length; i++) {
    await client.query('UPDATE users SET referrer_id=$1 WHERE id=$2', [ids[(i + 7) % ids.length], ids[i]]);
  }

  // 2) Deposits and withdrawals.
  for (const t of [...dummy.generateDeposits(), ...dummy.generateWithdrawals()]) {
    await client.query(
      `INSERT INTO transactions (tx_id, type, user_id, network, address, amount, status, tx_hash, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [t.txId, t.type, ids[t.userSeq], t.network, t.address, t.amount, t.status, t.txHash ?? '', t.createdAt]
    );
  }

  // 3) KYC queue, orders, banners.
  for (const k of dummy.generateKyc(userRows)) {
    await client.query(
      `INSERT INTO kyc_requests (user_id, country, document_type, document_number, status, submitted_at)
       VALUES ($1,$2,$3,$4,'pending',$5)`,
      [ids[k.userSeq], k.country, k.documentType, k.documentNumber, k.submittedAt]
    );
  }
  for (const o of dummy.generateOrders()) {
    await client.query(
      `INSERT INTO orders (order_id, user_id, vip, amount, total, income, fee, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [o.orderId, ids[o.userSeq], o.vip, o.amount, o.total, o.income, o.fee, o.createdAt]
    );
  }
  let sort = 0;
  for (const b of dummy.POPUP_BANNERS) {
    await client.query('INSERT INTO banners (kind, title, subtitle, sort_order) VALUES ($1,$2,$3,$4)', ['popup', b.title, b.subtitle, sort++]);
  }
  sort = 0;
  for (const b of dummy.HOME_BANNERS) {
    await client.query('INSERT INTO banners (kind, title, subtitle, sort_order) VALUES ($1,$2,$3,$4)', ['home', b.title, b.subtitle, sort++]);
  }

  await client.query('COMMIT');
  const count = async (t) => (await client.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n;
  console.log('Seed complete:', {
    users: await count('users'),
    transactions: await count('transactions'),
    kyc: await count('kyc_requests'),
    orders: await count('orders'),
    banners: await count('banners'),
  });
} catch (err) {
  await client.query('ROLLBACK');
  console.error('Seed failed:', err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
