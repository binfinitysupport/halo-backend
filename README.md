# halo-backend – Halo admin API (Express + PostgreSQL / Neon)

## Run locally

```bash
cp .env.example .env     # paste your Neon connection string into DATABASE_URL
npm install
npm run migrate          # creates the tables (safe to re-run)
npm run seed             # loads the dummy data (wipes existing data first)
npm start                # http://localhost:5050  (macOS uses port 5000 for AirPlay)
```

Health check: `GET /api/health` → `{ "ok": true }`.

## Deploy on Render

`render.yaml` is a Render Blueprint (Node web service, region Ohio – same AWS region as the Neon database).
In the Render dashboard set:
- `DATABASE_URL` – the Neon connection string
- `CLIENT_ORIGIN` – the Vercel URL (comma-separate several origins if needed)

Run `npm run migrate` / `npm run seed` from your machine against the same `DATABASE_URL` when the schema
or dummy data needs to change; the free Render plan has no pre-deploy step.

## Environment

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string (Neon needs `?sslmode=require`) |
| `PORT` | Port to listen on (Render sets it) |
| `CLIENT_ORIGIN` | Allowed browser origin(s) for CORS, comma-separated |
| `DB_WARM_CONNECTIONS` | Connections opened at startup (default 4) |
| `DB_KEEP_WARM_MINUTES` | Optional ping interval to keep Neon awake (uses compute hours) |

## Layout

```
db/schema.sql           tables (users, transactions, kyc_requests, banners, balance_adjustments, orders, settings)
src/db.js               Postgres pool (kept-open connections, SSL automatic for Neon)
src/routes/*.js         REST endpoints used by the admin
src/dummy/generator.js  DUMMY DATA ONLY – remove when real data is live
src/seed.js             loads the dummy values
```

## Before real users

- **Add authentication to `/api`** – the admin API has no login; anyone with the URL can call it.
- `src/routes/users.js` → `/:id/team`: replace the dummy team with a recursive query on `referrer_id`.
- `src/routes/dashboard.js`: remove `DUMMY` offsets and the static "active today" value.
- `src/routes/transactions.js` → `/:id/sync`: call your payment gateway.
- `src/routes/users.js` → `/:id/reset-password`: call your email/SMS provider.
