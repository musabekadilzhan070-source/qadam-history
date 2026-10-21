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

export const config = {
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '0.0.0.0',
  cookieSecure: process.env.COOKIE_SECURE === '1',
  dataDir,
  dbFile: process.env.DB_FILE === ':memory:' ? ':memory:' : path.join(dataDir, 'qadam.sqlite'),
  publicDir: path.join(ROOT, 'public'),
};

if (config.dbFile !== ':memory:') fs.mkdirSync(dataDir, { recursive: true });
