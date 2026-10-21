import { createClient } from '@libsql/client';
import { config } from './config.js';

// libSQL client: a local SQLite file in development, a Turso database in production
// (TURSO_DATABASE_URL + TURSO_AUTH_TOKEN).
export const db = createClient({ url: config.dbUrl, authToken: config.dbAuthToken });

// Schema is additive only: CREATE ... IF NOT EXISTS never touches existing rows.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  position INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  range_label TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period_id INTEGER NOT NULL REFERENCES periods(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  position INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  range_label TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  key_points TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL,
  explanation TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL,
  is_correct INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  correct INTEGER NOT NULL,
  total INTEGER NOT NULL,
  duration_sec INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attempt_answers (
  attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  option_id INTEGER REFERENCES options(id) ON DELETE SET NULL,
  is_correct INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (attempt_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_topics_period ON topics(period_id, position);
CREATE INDEX IF NOT EXISTS idx_questions_topic ON questions(topic_id, position);
CREATE INDEX IF NOT EXISTS idx_options_question ON options(question_id, position);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts(user_id, created_at);
`;

export async function migrate() {
  if (config.dbUrl.startsWith('file:')) await db.execute('PRAGMA journal_mode = WAL');
  await db.executeMultiple(SCHEMA);
}

// Rows as plain objects with numbers (libSQL returns integers as numbers, ids as bigint only in lastInsertRowid).
const plain = (result) =>
  result.rows.map((row) => Object.fromEntries(result.columns.map((col, i) => [col, row[i]])));

export const all = async (sql, ...args) => plain(await db.execute({ sql, args }));
export const get = async (sql, ...args) => (await all(sql, ...args))[0];
export async function run(sql, ...args) {
  const r = await db.execute({ sql, args });
  return { changes: r.rowsAffected, lastInsertRowid: r.lastInsertRowid === undefined ? null : Number(r.lastInsertRowid) };
}

/** Runs statements ([sql, ...args]) atomically in one write transaction. */
export async function batch(statements) {
  const results = await db.batch(
    statements.map(([sql, ...args]) => ({ sql, args })),
    'write',
  );
  return results.map((r) => ({ lastInsertRowid: r.lastInsertRowid === undefined ? null : Number(r.lastInsertRowid) }));
}
