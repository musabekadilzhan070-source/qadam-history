import crypto from 'node:crypto';
import { config } from './config.js';
import { get, run } from './db.js';

const COOKIE = 'qadam_sid';
const TTL_MS = 1000 * 60 * 60 * 24 * 60; // 60 күн

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

function cookieString(value, maxAgeMs, req) {
  const parts = [`${COOKIE}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  parts.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
  if (config.cookieSecure || req.secure) parts.push('Secure');
  return parts.join('; ');
}

export async function startSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', sha256(token), userId, Date.now() + TTL_MS);
  res.setHeader('Set-Cookie', cookieString(token, TTL_MS, req));
}

export async function endSession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) await run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
  res.setHeader('Set-Cookie', cookieString('', 0, req));
}

/** Attaches req.user from the session cookie. */
export async function sessionMiddleware(req, _res, next) {
  req.user = null;
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) {
    const row = await get(
      `SELECT u.id, u.username, u.display_name, u.created_at FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
      sha256(token),
      Date.now(),
    );
    if (row) req.user = row;
  }
  next();
}

export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Алдымен аккаунтқа кіріңіз.' });
  next();
}

/** In-memory limiter for login attempts: N failures per window per key. */
export function makeLimiter({ max, windowMs }) {
  const hits = new Map();
  return {
    blocked(key) {
      const h = hits.get(key);
      if (!h?.until) return 0;
      if (h.until > Date.now()) return Math.ceil((h.until - Date.now()) / 1000);
      hits.delete(key);
      return 0;
    },
    fail(key) {
      const h = hits.get(key) || { count: 0, until: 0 };
      h.count += 1;
      if (h.count >= max) {
        h.until = Date.now() + windowMs;
        h.count = 0;
      }
      hits.set(key, h);
    },
    reset(key) {
      hits.delete(key);
    },
  };
}

export function purgeExpiredSessions() {
  return run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
}
