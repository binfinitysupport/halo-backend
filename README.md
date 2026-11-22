# halo-backend – Halo admin API (Express + PostgreSQL / Neon)

## Run locally

```bash
cp .env.example .env     # set DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD and AUTH_SECRET
npm install
npm run migrate          # creates the tables (safe to re-run)
npm run seed             # loads the dummy data (wipes existing data first)
npm start                # http://localhost:5050  (macOS uses port 5000 for AirPlay)
```

Health check: `GET /api/health` → `{ "ok": true }`.

## Admin authentication

- `POST /api/auth/login` with `{ "email", "password" }` checks them against `ADMIN_EMAIL` / `ADMIN_PASSWORD`
  and returns `{ "token", "expiresAt" }`. The token is signed with `AUTH_SECRET` and is valid for 8 hours.
- Every other `/api` route (except `/api/health`) needs `Authorization: Bearer <token>`; otherwise it answers 401.
- 5 failed logins from the same address lock login for 15 minutes (429).
- In the frontend, admins log in from the user app's login form (Email tab) and are sent to `/admin`.

Example:

```bash
curl -s -H 'Content-Type: application/json' -d '{"email":"<ADMIN_EMAIL>","password":"<ADMIN_PASSWORD>"}' http://localhost:5050/api/auth/login
```

## User app API (B-Infinity)

Public (no token): `POST /api/app/auth/register`, `POST /api/app/auth/login`, `GET /api/app/content`,
and the gateway callback `POST /api/webhooks/oxapay`.

Private (send `Authorization: Bearer <user token>`):

| Method | Path | What it does |
|---|---|---|
| POST | `/api/app/auth/logout` | Ends the session; older tokens stop working |
| GET | `/api/app/me` | Profile and both wallet balances |
| GET | `/api/app/wallets` | Flexible and Active strategy balances |
| GET | `/api/app/bills?type=All\|Recharge\|Withdrawal\|Transfer` | Newest 100 ledger entries |
| POST | `/api/app/transfers` | `mode: "user"` (to a 7-digit UUID, min 70) or `"wallet"` (Flexible to Active, min 10); needs `fundPassword` |
| POST | `/api/app/deposits` | Creates an OxaPay payment: `option` (`USDT-TRC20`, `USDT-BEP20`, `USDC-BEP20`, `ETH-BEP20`), `amount` (USD) |
| GET | `/api/app/deposits/:trackId` | Deposit status: Pending, Credited or Expired |
| POST | `/api/app/withdrawals` | `network` TRC20/BEP20, `address`, `amount` (20–50,000), `fundPassword`; fee 6% |
| GET | `/api/app/withdrawals` | The user's withdrawal requests |
| GET / POST | `/api/app/kyc` | Identity status; submit the form with two photos as data URLs |

Money rules live in `src/rules/business-rules.js`, with the section of the Technical Document each one comes from.

### Payment gateway (OxaPay)

1. Set `OXAPAY_MERCHANT_API_KEY` and `PUBLIC_API_URL` (this API's public address, e.g. the Render URL).
2. OxaPay sends a callback to `PUBLIC_API_URL/api/webhooks/oxapay` and signs it in the `HMAC` header
   (HMAC-SHA512 of the raw body with your merchant key). Callbacks with a bad signature get a 400.
3. A `paid` callback credits the Active strategy wallet once; repeats do nothing.
4. OxaPay can't reach `localhost`, so local deposits can only be tested by sending a signed callback yourself.

## Deploy on Render

`render.yaml` is a Render Blueprint (Node web service, region Ohio – same AWS region as the Neon database).
In the Render dashboard set `DATABASE_URL`, `CLIENT_ORIGIN` (the frontend URL), `ADMIN_EMAIL`,
`ADMIN_PASSWORD` (a strong one) and `AUTH_SECRET`.

Run `npm run migrate` / `npm run seed` from your machine against the same `DATABASE_URL` when the schema
or dummy data needs to change; the free Render plan has no pre-deploy step.

## Environment

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string (Neon needs `?sslmode=require`) |
| `PORT` | Port to listen on (Render sets it) |
| `CLIENT_ORIGIN` | Allowed browser origin(s) for CORS, comma-separated |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | The admin login |
| `AUTH_SECRET` | Signs admin session tokens; without it sessions end on every restart |
| `DB_WARM_CONNECTIONS` | Connections opened at startup (default 4) |
| `DB_KEEP_WARM_MINUTES` | Optional ping interval to keep Neon awake (uses compute hours) |

## How a request flows (start here if you're new)

```
browser ──► Express (src/index.js)
              1. cors + JSON body parsing
              2. public routes: /api/health, /api/auth/login
              3. requireAdmin (src/middleware/require-admin.js) – stops the request with 401 if there is no valid token
              4. the route file for that URL, e.g. src/routes/users.js for /api/users
                   └─ runs SQL with query() from src/db.js and sends JSON back
              5. errors thrown anywhere end up in errorHandler (src/middleware/errors.js) → { "message": ... }
```

Things worth knowing:
- Route handlers are wrapped in `asyncHandler` so a thrown error (or `throw new HttpError(400, '...')`) becomes a
  proper JSON error response instead of crashing the server.
- SQL uses `$1, $2 …` placeholders with a separate values array – never put user input straight into SQL text.
- The database is far away (Neon), so each query costs a network round trip; routes try to do their work in one query.
- The tables are described in `db/schema.sql`; `npm run seed` fills them with dummy data from `src/dummy/generator.js`.

## Code map

```
db/schema.sql                   tables (users, transactions, kyc_requests, banners, balance_adjustments, orders, settings)
src/index.js                    app setup: public routes, then requireAdmin, then the admin routes
src/db.js                       Postgres pool (kept-open connections, SSL automatic for Neon)
src/auth/admin-token.js         admin credential check and signed session tokens
src/middleware/require-admin.js 401 unless the request carries a valid admin token
src/middleware/errors.js        404 and error responses
src/routes/auth.js              POST /api/auth/login (with failed-attempt lockout)
src/routes/*.js                 one file per admin area: dashboard, users, kyc, transactions, content, settings
src/dummy/generator.js          DUMMY DATA ONLY – remove when real data is live
src/seed.js                     loads the dummy values
```

## Before real users

- `src/routes/users.js` → `/:id/team`: replace the dummy team with a recursive query on `referrer_id`.
- `src/routes/dashboard.js`: remove `DUMMY` offsets and the static "active today" value.
- `src/routes/transactions.js` → `/:id/sync`: call your payment gateway.
- `src/routes/users.js` → `/:id/reset-password`: call your email/SMS provider.
