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

// Tables and columns added after the first release. Every step is additive and idempotent,
// so an existing database (with its users, attempts and content) upgrades in place.
const SCHEMA_V2 = `
CREATE TABLE IF NOT EXISTS tests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id INTEGER REFERENCES topics(id) ON DELETE SET NULL,
  position INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  published INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id INTEGER REFERENCES topics(id) ON DELETE SET NULL,
  position INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  image_id INTEGER,
  pdf_id INTEGER,
  published INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS persons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id INTEGER REFERENCES topics(id) ON DELETE SET NULL,
  position INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  reign TEXT NOT NULL DEFAULT '',
  biography TEXT NOT NULL DEFAULT '',
  facts TEXT NOT NULL DEFAULT '[]',
  image_id INTEGER,
  published INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  data BLOB NOT NULL,
  topic_id INTEGER,
  material_id INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS publications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note TEXT NOT NULL DEFAULT '',
  hash TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS org_sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_failures (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

-- Server-side secrets (signing test sessions). Not content: never published or restored.
CREATE TABLE IF NOT EXISTS app_secrets (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Emblems the organizer uploads; the built-in library lives in public/assets/js/emblems.js.
CREATE TABLE IF NOT EXISTS emblems (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  file_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Suggestions and feedback from students to the organizer. Not content: never published or restored.
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  reply TEXT,
  replied_at TEXT,
  read_at TEXT,
  reply_seen INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(user_id, id);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status, id);

-- «Кітаптар»: textbooks with a cover (files.kind 'image') and a PDF (files.kind 'bookpdf').
-- Not content: they are published one by one with their own flag, never through the snapshot.
CREATE TABLE IF NOT EXISTS books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT 'Қазақстан тарихы',
  grade INTEGER,
  publisher TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  cover_id INTEGER,
  pdf_id INTEGER,
  page_count INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Large files are kept in 1 MB pieces (a request on Vercel carries at most 4.5 MB).
CREATE TABLE IF NOT EXISTS file_chunks (
  file_id INTEGER NOT NULL,
  idx INTEGER NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (file_id, idx)
);
CREATE TABLE IF NOT EXISTS book_files (
  file_id INTEGER PRIMARY KEY,
  page_count INTEGER NOT NULL DEFAULT 0
);
-- Where each student stopped in each book.
CREATE TABLE IF NOT EXISTS book_progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id INTEGER NOT NULL,
  last_page INTEGER NOT NULL DEFAULT 1,
  opened_count INTEGER NOT NULL DEFAULT 0,
  last_opened_at TEXT,
  PRIMARY KEY (user_id, book_id)
);
-- Days (Asia/Almaty) on which a student opened a book.
CREATE TABLE IF NOT EXISTS book_days (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, book_id, day)
);
-- Active time: one row per 15-second slot of an Almaty day in which the student was active.
-- The key makes two open tabs count once.
CREATE TABLE IF NOT EXISTS activity_slots (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  slot INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'site',
  book_id INTEGER,
  page INTEGER,
  PRIMARY KEY (user_id, day, slot)
);

CREATE INDEX IF NOT EXISTS idx_tests_topic ON tests(topic_id, position);
CREATE INDEX IF NOT EXISTS idx_materials_topic ON materials(topic_id, position);
CREATE INDEX IF NOT EXISTS idx_persons_topic ON persons(topic_id, position);
`;

// Test links (a test sent as a link, taken without an account), started tests, kept totals of
// active time and the pages a student really read.
const SCHEMA_V3 = `
-- One row per test: its permanent link id and how the link may be used. Kept apart from the
-- content tables, so publishing or restoring a version never changes a link.
CREATE TABLE IF NOT EXISTS test_links (
  test_id INTEGER PRIMARY KEY,
  share_id TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 0,
  opens_at TEXT,
  closes_at TEXT,
  retakes INTEGER NOT NULL DEFAULT 1,
  show_result INTEGER NOT NULL DEFAULT 1,
  show_answers INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- The test exactly as it was handed out through its link: an attempt is graded on its own
-- version even if the organizer edits the test meanwhile.
CREATE TABLE IF NOT EXISTS link_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  test_id INTEGER NOT NULL,
  hash TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (test_id, hash)
);
-- Every start through a link. finished_at is set once, when the answers are graded.
-- participant: a random id kept in the browser's cookie, not a person's identity.
CREATE TABLE IF NOT EXISTS link_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  test_id INTEGER NOT NULL,
  version_id INTEGER NOT NULL,
  test_title TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  participant TEXT NOT NULL,
  served TEXT NOT NULL,
  started_ms INTEGER NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  correct INTEGER,
  total INTEGER,
  score INTEGER,
  max_score INTEGER,
  percent INTEGER,
  duration_sec INTEGER,
  answers TEXT
);
CREATE INDEX IF NOT EXISTS idx_link_attempts_test ON link_attempts(test_id, id);
CREATE INDEX IF NOT EXISTS idx_link_attempts_participant ON link_attempts(test_id, participant);
-- A signed-in student opened a test; attempt_id is filled in when that test is submitted.
CREATE TABLE IF NOT EXISTS test_starts (
  nonce TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  test_id INTEGER NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  attempt_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_test_starts_user ON test_starts(user_id, started_at);
-- Active time of old days, summed before their 15-second slots are removed.
CREATE TABLE IF NOT EXISTS activity_days (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  book_id INTEGER NOT NULL DEFAULT 0,
  seconds INTEGER NOT NULL,
  PRIMARY KEY (user_id, day, kind, book_id)
);
-- A page counts as read after 30 s of active time on it in one day; kept for good.
CREATE TABLE IF NOT EXISTS book_pages_read (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id INTEGER NOT NULL,
  page INTEGER NOT NULL,
  first_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, book_id, page)
);
`;

const COLUMNS = [
  ['topics', 'published', 'INTEGER NOT NULL DEFAULT 1'],
  ['topics', 'image_id', 'INTEGER'],
  ['topics', 'icon', "TEXT NOT NULL DEFAULT ''"],
  // Topics are never removed from the table: attempts reference them with ON DELETE CASCADE.
  ['topics', 'deleted', 'INTEGER NOT NULL DEFAULT 0'],
  ['questions', 'test_id', 'INTEGER'],
  ['questions', 'image_id', 'INTEGER'],
  ['options', 'image_id', 'INTEGER'],
  ['attempts', 'test_id', 'INTEGER'],
  // Accounts can sign in with an email as well as a login.
  ['users', 'email', 'TEXT'],
  // Test builder: description, cover, timing and scoring settings (JSON).
  ['tests', 'description', "TEXT NOT NULL DEFAULT ''"],
  ['tests', 'cover_image_id', 'INTEGER'],
  ['tests', 'settings', "TEXT NOT NULL DEFAULT '{}'"],
  // Question formats: single, multiple, image, matching, ordering, open, context (children use parent_id).
  ['questions', 'type', "TEXT NOT NULL DEFAULT 'single'"],
  ['questions', 'points', 'INTEGER NOT NULL DEFAULT 1'],
  ['questions', 'data', "TEXT NOT NULL DEFAULT '{}'"],
  ['questions', 'parent_id', 'INTEGER'],
  ['attempts', 'score', 'REAL'],
  ['attempts', 'max_score', 'REAL'],
  ['attempt_answers', 'answer', 'TEXT'],
  ['attempt_answers', 'option_ids', 'TEXT'],
  // School grade (6–11) and textbook publisher a test follows; empty until the organizer tags it.
  // Attempt kinds: 'test' (the whole test) or 'rework' (only the questions answered wrongly in parent_id).
  ['attempts', 'kind', "TEXT NOT NULL DEFAULT 'test'"],
  ['attempts', 'parent_id', 'INTEGER'],
  ['tests', 'grade', 'INTEGER'],
  ['tests', 'publisher', "TEXT NOT NULL DEFAULT ''"],
  // The rest of the textbook a test is based on (all optional).
  ['tests', 'subject', "TEXT NOT NULL DEFAULT ''"],
  ['tests', 'book_year', 'INTEGER'],
  ['tests', 'book_authors', "TEXT NOT NULL DEFAULT ''"],
  ['tests', 'book_pages', "TEXT NOT NULL DEFAULT ''"],
  // A book's section in the list, and whether students may save its PDF.
  ['books', 'category', "TEXT NOT NULL DEFAULT ''"],
  ['books', 'allow_download', 'INTEGER NOT NULL DEFAULT 0'],
];

async function addMissingColumns() {
  for (const [table, column, type] of COLUMNS) {
    const cols = await all(`PRAGMA table_info(${table})`);
    if (!cols.some((c) => c.name === column)) await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

export async function migrate() {
  if (config.dbUrl.startsWith('file:')) await db.execute('PRAGMA journal_mode = WAL');
  await db.executeMultiple(SCHEMA);
  await db.executeMultiple(SCHEMA_V2);
  await db.executeMultiple(SCHEMA_V3);
  await addMissingColumns();
  // Pages read before book_pages_read existed: from the slots still kept.
  await db.execute(
    `INSERT OR IGNORE INTO book_pages_read (user_id, book_id, page)
     SELECT user_id, book_id, page FROM activity_slots WHERE kind = 'book' AND page IS NOT NULL
     GROUP BY user_id, day, book_id, page HAVING COUNT(*) * 15 >= 30`,
  );
  // First release kept one test per topic as topic_id on questions: give each such topic a test row.
  await db.batch(
    [
      `INSERT INTO tests (topic_id, position, title, published)
       SELECT t.id, 1, t.title, 1 FROM topics t
       WHERE EXISTS (SELECT 1 FROM questions q WHERE q.topic_id = t.id AND q.test_id IS NULL)
         AND NOT EXISTS (SELECT 1 FROM tests x WHERE x.topic_id = t.id)`,
      `UPDATE questions SET test_id = (SELECT x.id FROM tests x WHERE x.topic_id = questions.topic_id ORDER BY x.id LIMIT 1)
       WHERE test_id IS NULL`,
      `UPDATE attempts SET test_id = (SELECT x.id FROM tests x WHERE x.topic_id = attempts.topic_id ORDER BY x.id LIMIT 1)
       WHERE test_id IS NULL`,
      `CREATE INDEX IF NOT EXISTS idx_questions_test ON questions(test_id, position)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email COLLATE NOCASE) WHERE email IS NOT NULL`,
    ],
    'write',
  );
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
