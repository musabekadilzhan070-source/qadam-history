import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env loader: KEY=VALUE lines, existing environment variables win.
function loadDotEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadDotEnv();

const dataDir = path.resolve(ROOT, process.env.DATA_DIR || 'data');
const tursoUrl = (process.env.TURSO_DATABASE_URL || '').trim();

if (!tursoUrl && process.env.VERCEL) {
  throw new Error('TURSO_DATABASE_URL орнатылмаған: Vercel-де деректер Turso дерекқорында сақталады (DEPLOY.md).');
}

export const config = {
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '0.0.0.0',
  cookieSecure: process.env.COOKIE_SECURE === '1' || Boolean(process.env.VERCEL),
  dataDir,
  // Turso in production, a local SQLite file otherwise. DB_FILE overrides the file (tests).
  dbUrl: tursoUrl || `file:${process.env.DB_FILE || path.join(dataDir, 'qadam.sqlite')}`,
  dbAuthToken: (process.env.TURSO_AUTH_TOKEN || '').trim() || undefined,
  publicDir: path.join(ROOT, 'public'),
};

if (!tursoUrl && !process.env.DB_FILE) fs.mkdirSync(dataDir, { recursive: true });
