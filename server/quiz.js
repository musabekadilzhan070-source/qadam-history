import crypto from 'node:crypto';
import { all, get, run, batch } from './db.js';
import { published } from './publish.js';
import { assembleQuestions, pickUnits, forStudent, grade, gradable, reviewItem, cleanAnswer, settingsOf } from './questions.js';

/** A published test with its topic, or null. */
export async function findTest(testId) {
  const snap = await published();
  const test = snap.tests.find((x) => x.id === testId);
  if (!test) return null;
  const topic = snap.topics.find((t) => t.id === test.topic_id);
  return { test: { ...test, settings: settingsOf(test.settings) }, topic: { id: topic.id, slug: topic.slug, title: topic.title } };
}

/** First published test of a topic (old /topics/:slug/test links). */
export async function firstTestOfTopic(slug) {
  const snap = await published();
  const topic = snap.topics.find((t) => t.slug === slug);
  return topic ? snap.tests.find((x) => x.topic_id === topic.id)?.id ?? null : null;
}

// ─── Test sessions ───────────────────────────────────────────────
// Starting a test signs which questions were handed out and when, so grading covers exactly
// those questions and the time limit can be checked on the server.
let secret = null;
async function signingKey() {
  if (secret) return secret;
  let row = await get("SELECT value FROM app_secrets WHERE key = 'test_sessions'");
  if (!row) {
    await run("INSERT OR IGNORE INTO app_secrets (key, value) VALUES ('test_sessions', ?)", crypto.randomBytes(32).toString('hex'));
    row = await get("SELECT value FROM app_secrets WHERE key = 'test_sessions'");
  }
  secret = row.value;
  return secret;
}

const sign = async (body) => crypto.createHmac('sha256', await signingKey()).update(body).digest('base64url');

export async function makeToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${await sign(body)}`;
}

export async function readToken(token) {
  const [body, mac] = String(token || '').split('.');
  if (!body || !mac) return null;
  const expected = await sign(body);
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString());
  } catch {
    return null;
  }
}

/** Time allowed for the served questions, in seconds (0 = unlimited). */
export function timeAllowed(settings, questionCount) {
  if (settings.time_limit_min) return settings.time_limit_min * 60;
  if (settings.question_time_sec) return settings.question_time_sec * questionCount;
  return 0;
}

/** What a student gets when starting a test: the picked questions without answers, and a session token. */
export function studentPaper(test, settings) {
  const units = pickUnits(test.questions, settings);
  const served = gradable(units).map((q) => q.id);
  return {
    units: units.map((u) => forStudent(u, settings)),
    served,
    meta: {
      question_count: served.length,
      max_score: gradable(units).reduce((s, q) => s + q.points, 0),
      time_limit_sec: timeAllowed(settings, served.length),
      question_time_sec: settings.question_time_sec,
      pass_percent: settings.pass_percent,
    },
  };
}

export async function startTest(test) {
  const paper = studentPaper(test, test.settings);
  const token = await makeToken({ t: test.id, q: paper.served, s: Date.now() });
  return { ...paper.meta, units: paper.units, token };
}

const GRACE_SEC = 90;

/** Grades a submitted test. For a signed-in student the attempt and each answer are saved. */
export async function submitTest(test, { token, answers }, { userId }) {
  const session = await readToken(token);
  if (!session || session.t !== test.id) {
    const e = new Error('Тест сессиясы жарамсыз. Тестті қайта бастаңыз.');
    e.status = 400;
    throw e;
  }
  const elapsed = Math.max(0, Math.round((Date.now() - session.s) / 1000));
  const allowed = timeAllowed(test.settings, session.q.length);
  if (allowed && elapsed > allowed + GRACE_SEC) {
    const e = new Error('Тест уақыты әлдеқашан аяқталған. Тестті қайта бастаңыз.');
    e.status = 400;
    throw e;
  }
  const result = grade(test, session.q, answers, test.settings);
  let attemptId = null;
  if (userId && result.total > 0) {
    // One write transaction: the attempt row, then its answers keyed to that row.
    const duration = Math.min(elapsed, 6 * 60 * 60);
    const latest = '(SELECT MAX(id) FROM attempts WHERE user_id = ?)';
    const [inserted] = await batch([
      [
        'INSERT INTO attempts (user_id, topic_id, test_id, correct, total, score, max_score, duration_sec) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        userId, test.topic_id, test.id, result.correct, result.total, result.score, result.max_score, duration,
      ],
      ...result.stored.map(({ question, answer }, i) => [
        `INSERT INTO attempt_answers (attempt_id, question_id, option_id, option_ids, answer, is_correct) VALUES (${latest}, ?, ?, ?, ?, ?)`,
        userId,
        question.id,
        Array.isArray(answer) && typeof answer[0] === 'number' ? answer[0] : null,
        Array.isArray(answer) && typeof answer[0] === 'number' ? JSON.stringify(answer) : null,
        JSON.stringify(answer),
        result.items[i].is_correct ? 1 : 0,
      ]),
    ]);
    attemptId = inserted.lastInsertRowid;
  }
  return {
    attempt_id: attemptId,
    correct: result.correct,
    total: result.total,
    score: result.score,
    max_score: result.max_score,
    percent: result.percent,
    passed: result.percent >= test.settings.pass_percent,
    pass_percent: test.settings.pass_percent,
    duration_sec: elapsed,
    items: result.items,
  };
}

// Titles come from the draft tables so results stay readable after a test is hidden;
// LEFT JOINs keep an attempt even if its test or topic was deleted.
const ATTEMPT_SQL = `
  SELECT a.id, a.test_id, a.correct, a.total, a.score, a.max_score, a.duration_sec, a.created_at,
         x.title AS test_title,
         t.slug AS topic_slug, COALESCE(t.title, x.title, 'Өшірілген тест') AS topic_title,
         p.slug AS period_slug, COALESCE(p.title, '') AS period_title, COALESCE(p.position, 0) AS period_number
  FROM attempts a
  LEFT JOIN tests x ON x.id = a.test_id
  LEFT JOIN topics t ON t.id = COALESCE(x.topic_id, a.topic_id)
  LEFT JOIN periods p ON p.id = t.period_id`;

// Older attempts have no score: their percent comes from the count of correct answers.
const percentOf = (a) =>
  a.max_score ? Math.round((a.score / a.max_score) * 100) : a.total ? Math.round((a.correct / a.total) * 100) : 0;
const withPercent = (a) => ({ ...a, percent: percentOf(a) });

export async function userResults(userId) {
  const attempts = (await all(`${ATTEMPT_SQL} WHERE a.user_id = ? ORDER BY a.created_at DESC, a.id DESC`, userId)).map(withPercent);
  const summary = await get(
    `SELECT COUNT(*) AS attempts, COUNT(DISTINCT COALESCE(test_id, -topic_id)) AS tests_done,
            COALESCE(SUM(correct), 0) AS correct, COALESCE(SUM(total), 0) AS answered
     FROM attempts WHERE user_id = ?`,
    userId,
  );
  return {
    summary: {
      ...summary,
      average_percent: attempts.length ? Math.round(attempts.reduce((s, a) => s + a.percent, 0) / attempts.length) : null,
    },
    attempts,
  };
}

async function draftTest(testId) {
  const test = await get('SELECT settings FROM tests WHERE id = ?', testId);
  const rows = await all('SELECT * FROM questions WHERE test_id = ?', testId);
  const options = rows.length
    ? await all(`SELECT * FROM options WHERE question_id IN (${rows.map((r) => r.id).join(',')})`)
    : [];
  return { settings: settingsOf(test?.settings), questions: assembleQuestions(rows, options) };
}

/** One saved attempt with the student's answers, visible only to its owner. */
export async function attemptDetail(userId, attemptId) {
  const attempt = await get(`${ATTEMPT_SQL} WHERE a.id = ? AND a.user_id = ?`, attemptId, userId);
  if (!attempt) return null;
  const rows = await all('SELECT question_id, option_id, option_ids, answer FROM attempt_answers WHERE attempt_id = ?', attemptId);
  const fromSnapshot = (await published()).tests.find((x) => x.id === attempt.test_id);
  const test = fromSnapshot
    ? { settings: settingsOf(fromSnapshot.settings), questions: fromSnapshot.questions }
    : attempt.test_id
      ? await draftTest(attempt.test_id)
      : { settings: settingsOf({}), questions: [] };
  const index = new Map();
  for (const q of test.questions) {
    if (q.type === 'context') for (const c of q.children) index.set(c.id, [c, q]);
    else index.set(q.id, [q, null]);
  }
  const items = [];
  for (const r of rows) {
    const found = index.get(r.question_id);
    if (!found) continue;
    let raw;
    try {
      raw = JSON.parse(r.answer ?? r.option_ids ?? 'null');
    } catch {
      raw = null;
    }
    if (raw === null && r.option_id) raw = [r.option_id];
    items.push(reviewItem(found[0], cleanAnswer(found[0], raw), test.settings, found[1]));
  }
  // Keep the test's own order.
  const order = [...index.keys()];
  items.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  return { ...withPercent(attempt), items };
}
