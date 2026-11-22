// Entry point of the API server (started with `npm start`).
// Order matters. Each request flows through these steps from top to bottom until one of them sends a response:
//   1. CORS and health check
//   2. payment webhooks (read raw bytes so the signature can be checked)
//   3. JSON body parsing
//   4. admin login, then the user app's public routes (register, login, content)
//   5. the user app's private routes (need a user token)
//   6. the admin's private routes (need an admin token)
//   7. "not found" and the error handler
import 'dotenv/config'; // loads the variables from .env into process.env (must be the first import)
import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { errorHandler, notFound } from './middleware/errors.js';
import { requireAdmin } from './middleware/require-admin.js';
import { requireUser } from './middleware/require-user.js';
import { warmPool, keepWarm } from './db.js';
import authRoutes from './routes/auth.js';
import webhookRoutes from './routes/webhooks.js';
import appAuthRoutes from './routes/app/auth.js';
import appContentRoutes from './routes/app/content.js';
import appPrivateRoutes from './routes/app/index.js';
import dashboardRoutes from './routes/dashboard.js';
import userRoutes from './routes/users.js';
import kycRoutes from './routes/kyc.js';
import transactionRoutes from './routes/transactions.js';
import contentRoutes from './routes/content.js';
import settingsRoutes from './routes/settings.js';

const DEFAULT_PORT = 5050;
const DEFAULT_FRONTEND_ORIGIN = 'http://localhost:4200';

const app = express();

// ---- Setup ----
// CORS: which websites may call this API from the browser. CLIENT_ORIGIN can list several, comma-separated
// (e.g. "https://my-site.vercel.app,http://localhost:4200").
const allowedOrigins = (process.env.CLIENT_ORIGIN || DEFAULT_FRONTEND_ORIGIN)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
app.use(cors({ origin: allowedOrigins }));

// GET /api/health → { ok: true }. The hosting platform calls it to check the server is up.
// It doesn't touch the database, so a slow database can't make the server look "down".
app.get('/api/health', (req, res) => res.json({ ok: true }));

// ---- Payment callbacks: public, but signed by the gateway. Must come BEFORE express.json() ----
app.use('/api/webhooks', webhookRoutes);

app.use(express.json({ limit: '6mb' })); // reads JSON request bodies into req.body (6 MB allows KYC photos)

// ---- Admin login and public user-app routes (no token needed) ----
app.use('/api/auth', authRoutes); // admin: POST /api/auth/login
app.use('/api/app/auth', appAuthRoutes); // user: POST /api/app/auth/register and /login
app.use('/api/app/content', appContentRoutes); // user: GET /api/app/content

// ---- User app private routes: need a user token ----
app.use('/api/app', requireUser, appPrivateRoutes);
app.all('/api/app/*', (req, res) => res.status(404).json({ message: 'Not found' }));

// ---- Admin endpoints: every route below needs a valid admin token ----
app.use('/api', requireAdmin); // stops the request with 401 if the token is missing or invalid
app.use('/api', dashboardRoutes); // /api/meta, /api/dashboard/kpis
app.use('/api/users', userRoutes);
app.use('/api/kyc', kycRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api', notFound); // any other /api path

// ---- Optional: serve the built Angular app from this same server ----
// Only when NODE_ENV=production and the frontend was built next to this repo (../client/dist/...).
// When the frontend is hosted separately this folder doesn't exist and the block is skipped.
const thisFolder = path.dirname(fileURLToPath(import.meta.url));
const angularBuildFolder = path.resolve(thisFolder, '../../client/dist/halo-admin/browser');
if (process.env.NODE_ENV === 'production' && fs.existsSync(angularBuildFolder)) {
  app.use(express.static(angularBuildFolder));
  // Any non-API URL gets index.html, so Angular's router can show the right page (e.g. /admin on refresh).
  app.get('*', (req, res) => res.sendFile(path.join(angularBuildFolder, 'index.html')));
}

// Must be added last: turns thrown errors into JSON error responses.
app.use(errorHandler);

// ---- Start ----
// Connect to the database first; only start accepting requests once that works.
const PORT = process.env.PORT || DEFAULT_PORT;
warmPool()
  .then(() => {
    keepWarm();
    app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));
  })
  .catch((error) => {
    console.error('Cannot reach the database:', error.message);
    process.exit(1);
  });
