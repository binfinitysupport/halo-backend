# halo-backend – notes for Claude Code

- Express + `pg`, PostgreSQL on Neon (AWS us-east-2). Deployed on Render (`render.yaml`, region Ohio).
  The frontend (`halo-frontend` repo) calls this API at the URL in its `src/environments/environment.ts`
  (locally `/api`, proxied to port 5050).
- Commands: `npm install`, `npm run migrate`, `npm run seed`, `npm start` (port 5050; macOS uses 5000 for AirPlay).
- `src/db.js`: connections are kept open (`idleTimeoutMillis: 0`) and warmed at startup – opening a Neon
  connection costs seconds. Keep each request to one SQL statement where possible (one round trip);
  multi-step writes use a single data-modifying CTE instead of BEGIN/COMMIT.
- `GET /api/health` is the Render health check (no DB call).
- Admin auth: `POST /api/auth/login` (credentials from `ADMIN_EMAIL`/`ADMIN_PASSWORD`) returns an HMAC-signed token
  (`src/auth/admin-token.js`); `requireAdmin` guards every `/api` route except `/api/health` and `/api/auth/*`.
- User accounts, balances and orders in the user app are client-side only; not in this database yet.
