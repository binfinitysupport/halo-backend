// Creates or updates the database tables. Run with: npm run migrate
// It reads db/schema.sql and runs it against DATABASE_URL. Safe to run again and again,
// because every statement in the schema uses "IF NOT EXISTS" or "ON CONFLICT DO NOTHING".
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

// Find db/schema.sql relative to this file (src/migrate.js -> ../db/schema.sql).
const sourceFolder = path.dirname(fileURLToPath(import.meta.url));
const schemaFilePath = path.join(sourceFolder, '..', 'db', 'schema.sql');
const schemaSql = fs.readFileSync(schemaFilePath, 'utf8');

try {
  await pool.query(schemaSql);
  console.log('Schema is up to date.');
} catch (error) {
  console.error('Migration failed:', error.message);
  process.exitCode = 1; // tells the terminal the command failed
} finally {
  await pool.end(); // close all connections so the script can exit
}
