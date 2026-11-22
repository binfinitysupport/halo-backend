// Database access for the whole API.
// Creates one shared PostgreSQL connection pool (a set of reusable connections) and exports
// small helpers. Route files only use `query()`, `num()` and `likePattern()` from here.
import net from 'node:net';
import pg from 'pg';

const { Pool } = pg;

const MAX_POOL_CONNECTIONS = 10;
const DEFAULT_WARM_CONNECTIONS = 4;
const MILLISECONDS_PER_MINUTE = 60_000;

// The connection string comes from .env (see .env.example). Without it the API cannot work, so stop right away.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
  process.exit(1);
}

// Hosted databases like Neon require an encrypted (SSL) connection; a local Postgres usually doesn't.
// Neon connection strings contain "sslmode=require" or "neon.tech", which is how we tell them apart.
const needsSsl = /sslmode=require|neon\.tech/.test(connectionString);

// Some networks resolve the database name to an IPv6 address that never answers, and the driver waits
// for it until it times out. We ask for IPv4 instead. The hostname is still used for the encryption check.
const IPV4 = 4;
function createIpv4Socket() {
  const socket = new net.Socket();
  const connectSocket = socket.connect.bind(socket);
  socket.connect = (port, hostName) => connectSocket({ port, host: hostName, family: IPV4 });
  return socket;
}

// Opening a connection to a remote database (encryption + login) takes seconds, so we keep connections open:
// idleTimeoutMillis: 0 means "never close an idle connection" (pg's default closes them after 10 seconds).
export const pool = new Pool({
  connectionString,
  ssl: needsSsl ? { rejectUnauthorized: true } : false,
  stream: createIpv4Socket,
  max: MAX_POOL_CONNECTIONS,
  idleTimeoutMillis: 0,
  keepAlive: true,
});

// If the database drops an idle connection, log it instead of crashing; the pool opens a new one when needed.
pool.on('error', (error) => console.warn('Idle database connection closed:', error.message));

// Runs one SQL statement. Always pass user input in `params` and refer to it as $1, $2, ... in the SQL,
// never by pasting it into the SQL text (that would allow SQL injection).
export const query = (sql, params) => pool.query(sql, params);

// Called once at startup (index.js): opens a few connections in advance so the first admin page loads,
// which fire several requests at once, don't each have to wait for a new connection.
export async function warmPool(connectionCount = Number(process.env.DB_WARM_CONNECTIONS) || DEFAULT_WARM_CONNECTIONS) {
  const numberToOpen = Math.min(connectionCount, MAX_POOL_CONNECTIONS);

  const pendingConnections = [];
  for (let index = 0; index < numberToOpen; index++) {
    pendingConnections.push(pool.connect());
  }
  const clients = await Promise.all(pendingConnections);

  // A tiny query proves each connection really works, then each one goes back into the pool.
  await Promise.all(clients.map((client) => client.query('SELECT 1')));
  clients.forEach((client) => client.release());
}

// Optional (set DB_KEEP_WARM_MINUTES in .env): run a tiny query every N minutes so the connections stay open
// and a serverless database (Neon) doesn't go to sleep. Off by default because it uses Neon compute hours.
export function keepWarm(intervalMinutes = Number(process.env.DB_KEEP_WARM_MINUTES) || 0) {
  if (!(intervalMinutes > 0)) return;

  const pingDatabase = () => pool.query('SELECT 1').catch(() => undefined);
  const timer = setInterval(pingDatabase, intervalMinutes * MILLISECONDS_PER_MINUTE);
  timer.unref(); // don't keep the Node process alive just for this timer
}

// Postgres returns NUMERIC columns (money amounts) as strings like "12.50"; the frontend expects numbers.
// Missing values (null) become 0.
export const num = (value) => (value === null || value === undefined ? 0 : Number(value));

// Turns search text into a pattern for SQL "ILIKE" (case-insensitive "contains").
// The characters %, _ and \ have special meanings in LIKE, so they are escaped to be matched literally.
// Example: likePattern('50%') -> '%50\%%'
export const likePattern = (searchText) => {
  const escapedText = String(searchText).replace(/[\\%_]/g, (specialCharacter) => '\\' + specialCharacter);
  return `%${escapedText}%`;
};
