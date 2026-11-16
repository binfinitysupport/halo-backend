import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { errorHandler, notFound } from './middleware/errors.js';
import { warmPool, keepWarm } from './db.js';
import dashboard from './routes/dashboard.js';
import users from './routes/users.js';
import kyc from './routes/kyc.js';
import transactions from './routes/transactions.js';
import content from './routes/content.js';
import settings from './routes/settings.js';

const app = express();

// CLIENT_ORIGIN may list several origins, comma-separated (e.g. the Vercel URL and localhost).
const origins = (process.env.CLIENT_ORIGIN || 'http://localhost:4200').split(',').map((o) => o.trim()).filter(Boolean);
app.use(cors({ origin: origins }));
app.use(express.json());

// Render health check; no database call so a slow database doesn't mark the service down.
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api', dashboard);
app.use('/api/users', users);
app.use('/api/kyc', kyc);
app.use('/api/transactions', transactions);
app.use('/api/content', content);
app.use('/api/settings', settings);
app.use('/api', notFound);

// Single-server setup: serve the built Angular app when it sits next to this repo.
// On Render the frontend lives on Vercel, so this is skipped.
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist/halo-admin/browser');
if (process.env.NODE_ENV === 'production' && fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use(errorHandler);

const PORT = process.env.PORT || 5050;
warmPool()
  .then(() => {
    keepWarm();
    app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('Cannot reach the database:', err.message);
    process.exit(1);
  });
