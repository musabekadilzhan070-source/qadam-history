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
    const writes = [...slots].map((slot) => [
        `INSERT INTO activity_slots (user_id, day, slot, kind, book_id, page) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, day, slot) DO UPDATE SET kind = excluded.kind, book_id = excluded.book_id, page = excluded.page
         WHERE activity_slots.kind = 'site' AND excluded.kind <> 'site'`,
        req.user.id, day, slot, kind, bookId, page,
      ]);
    // A page with 30 s of active time today is read, for good (the slots themselves are removed later).
    if (bookId && page) {
      writes.push([
        `INSERT OR IGNORE INTO book_pages_read (user_id, book_id, page)
         SELECT ?, ?, ? WHERE (SELECT COUNT(*) FROM activity_slots WHERE user_id = ? AND day = ? AND kind = 'book' AND book_id = ? AND page = ?) * ${SLOT_SEC} >= ${PAGE_READ_SEC}`,
        req.user.id, bookId, page, req.user.id, day, bookId, page,
      ]);
    }
    await batch(writes);
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

/**
 * Slots older than 120 days are not needed for daily reports: their time is first added to
 * activity_days (so the total time stays right), then they are removed, in one transaction.
 */
export async function purgeOldActivity() {
  const cutoff = dayOf(Date.now() - 120 * 24 * 3600 * 1000);
  await batch([
    [
      `INSERT INTO activity_days (user_id, day, kind, book_id, seconds)
       SELECT user_id, day, kind, COALESCE(book_id, 0), COUNT(*) * ${SLOT_SEC} FROM activity_slots WHERE day < ?
       GROUP BY user_id, day, kind, COALESCE(book_id, 0)
       ON CONFLICT(user_id, day, kind, book_id) DO UPDATE SET seconds = activity_days.seconds + excluded.seconds`,
      cutoff,
    ],
    ['DELETE FROM activity_slots WHERE day < ?', cutoff],
  ]);
}

// ─── Overview: everything the student did on QADAM ────────────────
const addDays = (day, n) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
/** Monday of the Almaty week holding `day`. */
const mondayOf = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  return addDays(day, -((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7));
};
const dbToMs = (s) => (s ? Date.parse(String(s).replace(' ', 'T') + 'Z') : 0);
/** A book is finished when at least 90% of its pages were read (opening it is not reading). */
export const FINISHED_SHARE = 0.9;

export async function overviewReport(user) {
  const today = dayOf();
  const monday = mondayOf(today);
  const weekStart = addDays(today, -6);

  // Active time: the kept slots plus the totals of removed old days.
  const slots = await all(
    'SELECT day, kind, book_id, COUNT(*) AS n, MAX(slot) AS last_slot FROM activity_slots WHERE user_id = ? GROUP BY day, kind, book_id',
    user.id,
  );
  const old = await all('SELECT day, kind, book_id, seconds FROM activity_days WHERE user_id = ?', user.id);
  const rows = [...slots.map((r) => ({ day: r.day, kind: r.kind, book_id: r.book_id || 0, sec: r.n * SLOT_SEC })), ...old.map((r) => ({ day: r.day, kind: r.kind, book_id: r.book_id, sec: r.seconds }))];
  const sum = (pred) => rows.filter(pred).reduce((s, r) => s + r.sec, 0);
  const week = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(weekStart, i);
    return { day, sec: sum((r) => r.day === day) };
  });

  // Tests: finished attempts and starts that were never submitted.
  const attempts = await all(
    `SELECT a.id, a.test_id, a.correct, a.total, a.score, a.max_score, a.duration_sec, a.created_at,
            COALESCE(x.title, 'Өшірілген тест') AS title, COALESCE(t.title, '') AS topic_title
     FROM attempts a LEFT JOIN tests x ON x.id = a.test_id LEFT JOIN topics t ON t.id = COALESCE(x.topic_id, a.topic_id)
     WHERE a.user_id = ? AND a.kind = 'test' ORDER BY a.created_at DESC, a.id DESC`,
    user.id,
  );
  const unfinished = await all(
    `SELECT s.test_id, s.started_at, COALESCE(x.title, 'Өшірілген тест') AS title, COALESCE(t.title, '') AS topic_title
     FROM test_starts s LEFT JOIN tests x ON x.id = s.test_id LEFT JOIN topics t ON t.id = x.topic_id
     WHERE s.user_id = ? AND s.attempt_id IS NULL ORDER BY s.started_at DESC`,
    user.id,
  );
  const history = [
    ...attempts.map((a) => ({
      status: 'finished',
      test_id: a.test_id,
      title: a.title,
      topic_title: a.topic_title,
      at: a.created_at,
      correct: a.correct,
      total: a.total,
      score: a.score,
      max_score: a.max_score,
      percent: percentOf(a),
      duration_sec: a.duration_sec,
    })),
    ...unfinished.map((s) => ({ status: 'unfinished', test_id: s.test_id, title: s.title, topic_title: s.topic_title, at: s.started_at })),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  // Books: every published book, with what the student did in it.
  const books = (
    await all(
      `SELECT b.id, b.title, b.grade, b.publisher, b.subject, b.page_count,
              (SELECT MIN(d.opened_at) FROM book_days d WHERE d.user_id = ? AND d.book_id = b.id) AS started_at,
              g.last_opened_at, g.last_page,
              (SELECT COUNT(*) FROM book_pages_read r WHERE r.user_id = ? AND r.book_id = b.id) AS pages_read
       FROM books b LEFT JOIN book_progress g ON g.book_id = b.id AND g.user_id = ?
       WHERE b.published = 1 OR g.user_id IS NOT NULL ORDER BY b.position, b.id`,
      user.id,
      user.id,
      user.id,
    )
  ).map((b) => {
    const pages = b.page_count || 0;
    const progress = pages ? Math.min(100, Math.round((b.pages_read / pages) * 100)) : 0;
    const opened = Boolean(b.started_at || b.last_opened_at);
    const finished = pages > 0 && b.pages_read >= Math.ceil(pages * FINISHED_SHARE);
    return {
      book_id: b.id,
      title: b.title,
      subject: b.subject,
      grade: b.grade ?? null,
      publisher: b.publisher || '',
      started_at: b.started_at,
      last_opened_at: b.last_opened_at,
      reading_sec: sum((r) => r.kind === 'book' && r.book_id === b.id),
      pages_read: b.pages_read,
      page_count: pages,
      progress,
      status: finished ? 'finished' : opened ? 'reading' : 'not_started',
    };
  });

  // The latest moment of any activity: an active slot, a finished test or an opened book.
  let lastMs = 0;
  for (const r of slots) {
    const [from] = utcRangeOf(r.day);
    lastMs = Math.max(lastMs, dbToMs(from) + (r.last_slot + 1) * SLOT_SEC * 1000);
  }
  if (attempts[0]) lastMs = Math.max(lastMs, dbToMs(attempts[0].created_at));
  for (const b of books) lastMs = Math.max(lastMs, dbToMs(b.last_opened_at));
  lastMs = Math.min(lastMs, Date.now());

  const finishedTests = history.filter((h) => h.status === 'finished');
  return {
    student: user.display_name,
    generated_at: new Date().toISOString(),
    today,
    week_from: monday,
    last_activity_at: lastMs ? new Date(lastMs).toISOString() : null,
    summary: {
      attempts: finishedTests.length + unfinished.length,
      finished: finishedTests.length,
      unfinished: unfinished.length,
      tests_done: new Set(finishedTests.map((h) => h.test_id)).size,
      average_percent: finishedTests.length ? Math.round(finishedTests.reduce((s, h) => s + h.percent, 0) / finishedTests.length) : null,
      books_total: books.length,
      books_opened: books.filter((b) => b.status !== 'not_started').length,
      books_finished: books.filter((b) => b.status === 'finished').length,
      today_sec: sum((r) => r.day === today),
      week_sec: sum((r) => r.day >= monday && r.day <= today),
      total_sec: sum(() => true),
      test_sec: sum((r) => r.kind === 'test'),
      reading_sec: sum((r) => r.kind === 'book'),
    },
    week,
    history,
    books,
  };
}

reportRouter.get(
  '/overview',
  wrap(async (req, res) => {
    res.json(await overviewReport(req.user));
  }),
);
