import express from 'express';
import { all, get, run, batch } from './db.js';
import { dayOf, secondOfDay, utcRangeOf, isDay } from './almaty.js';
import { attemptDetail, textbook } from './quiz.js';

// Active time and the daily report («Кураторға есеп беру»). Everything here is the signed-in
// student's own data: every query is filtered by req.user.id.
//
// While a QADAM page is visible and the student has done something in the last minutes, the page
// sends a heartbeat every 15 seconds. Each heartbeat marks the 15-second slots of the current
// Almaty day it covers. A slot is stored once per student, so two open tabs do not double the
// time, and a closed or idle page simply stops adding slots.

export const SLOT_SEC = 15;
const KINDS = ['site', 'test', 'book'];
/** A page counts as read after this much active time on it in one day. */
export const PAGE_READ_SEC = 30;

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const activityRouter = express.Router();

activityRouter.post(
  '/',
  wrap(async (req, res) => {
    const kind = KINDS.includes(req.body?.kind) ? req.body.kind : 'site';
    let bookId = null;
    let page = null;
    if (kind === 'book') {
      bookId = Number(req.body?.book_id);
      page = Number(req.body?.page);
      const book = Number.isInteger(bookId)
        ? await get(
            `SELECT b.id, b.page_count FROM books b JOIN files p ON p.id = b.pdf_id AND p.kind = 'bookpdf'
             WHERE b.id = ? AND b.published = 1`,
            bookId,
          )
        : null;
      if (!book) return res.status(404).json({ error: 'Кітап табылмады.' });
      if (!Number.isInteger(page) || page < 1 || page > (book.page_count || 10000)) page = null;
    }
    const now = Date.now();
    const day = dayOf(now);
    const second = secondOfDay(now);
    const slots = new Set([Math.floor(second / SLOT_SEC)]);
    // «Active since the last beat»: also the slot just before, so timer jitter never loses a slot.
    if (req.body?.continuous && second >= SLOT_SEC - 1) slots.add(Math.floor((second - (SLOT_SEC - 1)) / SLOT_SEC));
    await batch(
      [...slots].map((slot) => [
        `INSERT INTO activity_slots (user_id, day, slot, kind, book_id, page) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, day, slot) DO UPDATE SET kind = excluded.kind, book_id = excluded.book_id, page = excluded.page
         WHERE activity_slots.kind = 'site' AND excluded.kind <> 'site'`,
        req.user.id, day, slot, kind, bookId, page,
      ]),
    );
    res.json({ ok: true, day });
  }),
);

const percentOf = (a) =>
  a.max_score ? Math.round((a.score / a.max_score) * 100) : a.total ? Math.round((a.correct / a.total) * 100) : 0;

/** Groups attempts by test, oldest first inside each group. */
function byTest(rows) {
  const groups = new Map();
  for (const a of rows) {
    const key = a.test_id ?? `t${a.topic_title}`;
    if (!groups.has(key)) {
      groups.set(key, {
        test_id: a.test_id,
        title: a.test_title || a.topic_title,
        topic_title: a.topic_title,
        grade: a.grade ?? null,
        publisher: a.publisher || '',
        attempts: [],
      });
    }
    groups.get(key).attempts.push({
      id: a.id,
      percent: percentOf(a),
      correct: a.correct,
      wrong: a.total - a.correct,
      total: a.total,
      score: a.score,
      max_score: a.max_score,
      duration_sec: a.duration_sec,
      created_at: a.created_at,
    });
  }
  return [...groups.values()].map((g) => ({
    ...g,
    times: g.attempts.length,
    best_percent: Math.max(...g.attempts.map((x) => x.percent)),
    last: g.attempts[g.attempts.length - 1],
  }));
}

/** Everything the student did on one Almaty day. */
export async function dailyReport(user, day) {
  const [from, to] = utcRangeOf(day);
  const attempts = await all(
    `SELECT a.id, a.test_id, a.kind, a.correct, a.total, a.score, a.max_score, a.duration_sec, a.created_at,
            x.title AS test_title, x.grade, x.publisher, COALESCE(t.title, x.title, 'Өшірілген тест') AS topic_title
     FROM attempts a
     LEFT JOIN tests x ON x.id = a.test_id
     LEFT JOIN topics t ON t.id = COALESCE(x.topic_id, a.topic_id)
     WHERE a.user_id = ? AND a.created_at >= ? AND a.created_at < ?
     ORDER BY a.created_at, a.id`,
    user.id,
    from,
    to,
  );
  const tests = byTest(attempts.filter((a) => a.kind !== 'rework'));
  const reworks = byTest(attempts.filter((a) => a.kind === 'rework'));

  const slots = await all(
    'SELECT kind, book_id, page, COUNT(*) AS n FROM activity_slots WHERE user_id = ? AND day = ? GROUP BY kind, book_id, page',
    user.id,
    day,
  );
  const seconds = (pred) => slots.filter(pred).reduce((s, r) => s + r.n * SLOT_SEC, 0);

  const opened = await all(
    `SELECT d.book_id, d.opened_at, b.title, b.grade, b.publisher, b.subject
     FROM book_days d LEFT JOIN books b ON b.id = d.book_id
     WHERE d.user_id = ? AND d.day = ? ORDER BY d.opened_at`,
    user.id,
    day,
  );
  const books = opened.map((b) => {
    const pages = slots
      .filter((r) => r.kind === 'book' && r.book_id === b.book_id && r.page && r.n * SLOT_SEC >= PAGE_READ_SEC)
      .map((r) => r.page)
      .sort((x, y) => x - y);
    return {
      book_id: b.book_id,
      title: b.title || 'Өшірілген кітап',
      subject: b.subject || '',
      grade: b.grade ?? null,
      publisher: b.publisher || '',
      reading_sec: seconds((r) => r.kind === 'book' && r.book_id === b.book_id),
      pages_read: pages.length,
      pages,
    };
  });

  return {
    student: user.display_name,
    day,
    time_zone: 'Asia/Almaty',
    generated_at: new Date().toISOString(),
    tests,
    reworks,
    books,
    activity: {
      active_sec: seconds(() => true),
      test_sec: seconds((r) => r.kind === 'test'),
      reading_sec: seconds((r) => r.kind === 'book'),
      tests_done: tests.reduce((s, t) => s + t.times, 0),
      reworks_done: reworks.reduce((s, t) => s + t.times, 0),
      books_opened: books.length,
      pages_read: books.reduce((s, b) => s + b.pages_read, 0),
    },
  };
}

export const reportRouter = express.Router();

/** Today's report by default; a past day can be asked for with ?day=YYYY-MM-DD (never a future one). */
reportRouter.get(
  '/daily',
  wrap(async (req, res) => {
    const today = dayOf();
    const day = req.query.day ? String(req.query.day) : today;
    if (!isDay(day) || day > today) return res.status(400).json({ error: 'Күн қате көрсетілген.' });
    res.json(await dailyReport(req.user, day));
  }),
);

// ─── One test: first and last result, history ─────────────────────
// Every finished attempt is its own row (a test is saved only when it is submitted, so an
// unfinished test never counts). The first row of a test is the first result and never changes;
// the newest row is the last result.

const attemptView = (a) => ({
  id: a.id,
  percent: percentOf(a),
  correct: a.correct,
  wrong: a.total - a.correct,
  total: a.total,
  score: a.score,
  max_score: a.max_score,
  duration_sec: a.duration_sec,
  created_at: a.created_at,
});

/** Tests the student has finished, newest first, with their first and last percent. */
export async function reportTests(userId) {
  const rows = await all(
    `SELECT a.id, a.test_id, a.correct, a.total, a.score, a.max_score, a.created_at,
            COALESCE(x.title, 'Өшірілген тест') AS title, COALESCE(t.title, x.title, '') AS topic_title
     FROM attempts a LEFT JOIN tests x ON x.id = a.test_id LEFT JOIN topics t ON t.id = COALESCE(x.topic_id, a.topic_id)
     WHERE a.user_id = ? AND a.kind = 'test' AND a.test_id IS NOT NULL
     ORDER BY a.created_at, a.id`,
    userId,
  );
  const tests = new Map();
  for (const a of rows) {
    if (!tests.has(a.test_id)) tests.set(a.test_id, { test_id: a.test_id, title: a.title, topic_title: a.topic_title, attempts: 0, first: a });
    const t = tests.get(a.test_id);
    t.attempts += 1;
    t.last = a;
  }
  return [...tests.values()]
    .map((t) => ({
      test_id: t.test_id,
      title: t.title,
      topic_title: t.topic_title,
      attempts: t.attempts,
      first_percent: percentOf(t.first),
      last_percent: percentOf(t.last),
      last_at: t.last.created_at,
    }))
    .sort((a, b) => (a.last_at < b.last_at ? 1 : -1));
}

/** First and last result of one test, every attempt in order, reworks and questions to repeat. */
export async function testReport(user, testId) {
  const attempts = await all(
    `SELECT id, correct, total, score, max_score, duration_sec, created_at FROM attempts
     WHERE user_id = ? AND test_id = ? AND kind = 'test' ORDER BY created_at, id`,
    user.id,
    testId,
  );
  if (!attempts.length) return null;
  const test = await get(
    `SELECT x.id, x.title, x.grade, x.publisher, x.subject, x.book_year, x.book_authors, x.book_pages,
            COALESCE(t.title, x.title) AS topic_title, COALESCE(p.title, '') AS period_title
     FROM tests x LEFT JOIN topics t ON t.id = x.topic_id LEFT JOIN periods p ON p.id = t.period_id WHERE x.id = ?`,
    testId,
  );
  const history = attempts.map(attemptView);
  const first = history[0];
  const last = history[history.length - 1];
  const reworks = await all(
    `SELECT r.correct, r.total, r.created_at FROM attempts r JOIN attempts a ON a.id = r.parent_id
     WHERE r.user_id = ? AND r.kind = 'rework' AND (a.test_id = ? OR r.test_id = ?) ORDER BY r.id`,
    user.id,
    testId,
    testId,
  );
  // Questions answered wrongly in the last attempt: what the student should look at again.
  const detail = await attemptDetail(user.id, last.id);
  const attention = (detail?.items || [])
    .filter((i) => !i.is_correct)
    .slice(0, 8)
    .map((i) => ({ text: i.context ? `${i.context.title}: ${i.text}` : i.text, answered: i.answered }));
  return {
    student: user.display_name,
    generated_at: new Date().toISOString(),
    test: { id: testId, title: test?.title || 'Өшірілген тест', topic_title: test?.topic_title || '', period_title: test?.period_title || '', ...textbook(test || {}) },
    first,
    last,
    attempts: history,
    change: {
      percent_points: last.percent - first.percent,
      correct: last.correct - first.correct,
      wrong: last.wrong - first.wrong,
    },
    best_percent: Math.max(...history.map((a) => a.percent)),
    average_percent: Math.round(history.reduce((s, a) => s + a.percent, 0) / history.length),
    reworks: {
      count: reworks.length,
      fixed: reworks.reduce((s, r) => s + r.correct, 0),
      total: reworks.reduce((s, r) => s + r.total, 0),
    },
    attention,
  };
}

reportRouter.get(
  '/tests',
  wrap(async (req, res) => {
    res.json({ tests: await reportTests(req.user.id) });
  }),
);

reportRouter.get(
  '/test/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const report = Number.isInteger(id) && id > 0 ? await testReport(req.user, id) : null;
    if (!report) return res.status(404).json({ error: 'Бұл тест бойынша сіздің нәтижеңіз жоқ.' });
    res.json(report);
  }),
);

/** Old activity is not needed for daily reports: keep the last 120 days. */
export async function purgeOldActivity() {
  const cutoff = dayOf(Date.now() - 120 * 24 * 3600 * 1000);
  await run('DELETE FROM activity_slots WHERE day < ?', cutoff);
}
