// Fills the database with demo data. Run with: npm run seed
// WARNING: it first DELETES all users, transactions, KYC requests, orders, banners and adjustments.
// The demo values come from dummy/generator.js (they match the admin prototype's screens).
// Everything runs inside one transaction (BEGIN … COMMIT): if any step fails, nothing is changed.
import 'dotenv/config';
import { pool } from './db.js';
import * as dummyData from './dummy/generator.js';

const DUMMY_USER_COUNT = 36;
// In the prototype, user number N was invited by user number (N + 7), wrapping around at the end.
const REFERRER_OFFSET = 7;

const client = await pool.connect();
try {
  await client.query('BEGIN');

  // 0) Start from empty tables and reset the global settings row to the demo values.
  await client.query('TRUNCATE orders, balance_adjustments, kyc_requests, transactions, banners, users RESTART IDENTITY CASCADE');
  await client.query(`
    UPDATE settings SET
      fee_percent = 30,
      trial_amount = 3,
      min_deposit = 70,
      min_withdrawal = 20,
      maint_enabled = false,
      maint_hours = 2,
      maint_started_at = NULL,
      tg_official = 'https://t.me/halo_official',
      tg_support = 'https://t.me/halo_support',
      tg_community = '',
      announcement_text = 'VIP 4 is now live with QS-2 servers. Scheduled maintenance on Nov 10, 02:00 UTC.',
      announcement_live = true
    WHERE key = 'global'`);

  // 1) Users. Remember each new user's database id by position (seq), because the other tables refer to users by seq.
  const dummyUsers = dummyData.generateUsers(DUMMY_USER_COUNT);
  const userIdsBySeq = [];
  for (const user of dummyUsers) {
    const insertResult = await client.query(
      `INSERT INTO users (seq, uuid, phone, name, vip, active_balance, flex_balance, team_size, kyc_status, status, joined_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [user.seq, user.uuid, user.phone, user.name, user.vip, user.activeBalance, user.flexBalance, user.teamSize, user.kycStatus, user.status, user.joined]
    );
    userIdsBySeq.push(insertResult.rows[0].id);
  }

  // Who invited whom (set after all users exist, because a referrer may come later in the list).
  for (let seq = 0; seq < userIdsBySeq.length; seq++) {
    const referrerSeq = (seq + REFERRER_OFFSET) % userIdsBySeq.length;
    await client.query('UPDATE users SET referrer_id = $1 WHERE id = $2', [userIdsBySeq[referrerSeq], userIdsBySeq[seq]]);
  }

  // 2) Deposits and withdrawals.
  const allTransactions = [...dummyData.generateDeposits(), ...dummyData.generateWithdrawals()];
  for (const transaction of allTransactions) {
    await client.query(
      `INSERT INTO transactions (tx_id, type, user_id, network, address, amount, status, tx_hash, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        transaction.txId,
        transaction.type,
        userIdsBySeq[transaction.userSeq],
        transaction.network,
        transaction.address,
        transaction.amount,
        transaction.status,
        transaction.txHash ?? '', // withdrawals have no hash yet
        transaction.createdAt,
      ]
    );
  }

  // 3) KYC requests waiting for review.
  for (const kycRequest of dummyData.generateKyc(dummyUsers)) {
    await client.query(
      `INSERT INTO kyc_requests (user_id, country, document_type, document_number, status, submitted_at)
       VALUES ($1,$2,$3,$4,'pending',$5)`,
      [userIdsBySeq[kycRequest.userSeq], kycRequest.country, kycRequest.documentType, kycRequest.documentNumber, kycRequest.submittedAt]
    );
  }

  // 4) Orders (used for the dashboard's fee total).
  for (const order of dummyData.generateOrders()) {
    await client.query(
      `INSERT INTO orders (order_id, user_id, vip, amount, total, income, fee, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [order.orderId, userIdsBySeq[order.userSeq], order.vip, order.amount, order.total, order.income, order.fee, order.createdAt]
    );
  }

  // 5) Banners. sort_order is their position on the page (0 = first), counted separately for each kind.
  const insertBanners = async (kind, banners) => {
    for (let position = 0; position < banners.length; position++) {
      const banner = banners[position];
      await client.query(
        'INSERT INTO banners (kind, title, subtitle, sort_order) VALUES ($1,$2,$3,$4)',
        [kind, banner.title, banner.subtitle, position]
      );
    }
  };
  await insertBanners('popup', dummyData.POPUP_BANNERS);
  await insertBanners('home', dummyData.HOME_BANNERS);

  await client.query('COMMIT');

  // Print how many rows each table now has.
  const countRows = async (tableName) => {
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${tableName}`);
    return rows[0].n;
  };
  console.log('Seed complete:', {
    users: await countRows('users'),
    transactions: await countRows('transactions'),
    kyc: await countRows('kyc_requests'),
    orders: await countRows('orders'),
    banners: await countRows('banners'),
  });
} catch (error) {
  await client.query('ROLLBACK'); // undo everything from this run
  console.error('Seed failed:', error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end(); // close all connections so the script can exit
}
