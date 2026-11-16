# halo-backend – notes for Claude Code

- Express + `pg`, PostgreSQL on Neon (AWS us-east-2). Deployed on Render (`render.yaml`, region Ohio).
  The frontend (`halo-frontend` repo) is on Vercel and reaches this API through a `/api` rewrite.
- Commands: `npm install`, `npm run migrate`, `npm run seed`, `npm start` (port 5050; macOS uses 5000 for AirPlay).
- `src/db.js`: connections are kept open (`idleTimeoutMillis: 0`) and warmed at startup – opening a Neon
  connection costs seconds. Keep each request to one SQL statement where possible (one round trip);
  multi-step writes use a single data-modifying CTE instead of BEGIN/COMMIT.
- `GET /api/health` is the Render health check (no DB call).
- The admin API has no authentication yet.
- User accounts, balances and orders in the user app are client-side only; not in this database yet.
