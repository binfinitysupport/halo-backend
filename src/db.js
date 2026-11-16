import pg from 'pg';

const { Pool } = pg;

// Neon needs SSL; local Postgres does not. Neon URLs already include ?sslmode=require.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
  process.exit(1);
}

// Opening a connection to a remote Postgres (TLS + auth) costs seconds, so connections are kept open:
// pg's default closes idle ones after 10s, which made the next click after any pause very slow.
export const pool = new Pool({
  connectionString,
  ssl: /sslmode=require|neon\.tech/.test(connectionString) ? { rejectUnauthorized: true } : false,
  max: 10,
  idleTimeoutMillis: 0,
  keepAlive: true,
});

// A dropped idle connection (e.g. the server restarts it) must not crash the API; the pool reconnects.
pool.on('error', (err) => console.warn('Idle database connection closed:', err.message));

export const query = (text, params) => pool.query(text, params);

// Open a few connections up front so the admin's parallel requests don't each pay the connect cost.
export async function warmPool(count = Number(process.env.DB_WARM_CONNECTIONS) || 4) {
  const clients = await Promise.all(Array.from({ length: Math.min(count, 10) }, () => pool.connect()));
  await Promise.all(clients.map((c) => c.query('SELECT 1')));
  clients.forEach((c) => c.release());
}

// Optional: run a tiny query every N minutes so the connections stay open and a serverless database
// (Neon) doesn't suspend. Off by default because it keeps the database running and uses compute hours.
export function keepWarm(minutes = Number(process.env.DB_KEEP_WARM_MINUTES) || 0) {
  if (!(minutes > 0)) return;
  setInterval(() => pool.query('SELECT 1').catch(() => undefined), minutes * 60_000).unref();
}

// Postgres returns NUMERIC as strings; the UI expects numbers.
export const num = (v) => (v === null || v === undefined ? 0 : Number(v));

// Escape LIKE wildcards so user search text is matched literally.
export const likePattern = (term) => `%${String(term).replace(/[\\%_]/g, (c) => '\\' + c)}%`;
