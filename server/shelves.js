import express from 'express';
import { all, get, run, batch } from './db.js';

// ─── Books of a period (organizer) ────────────────────────────────
// The organizer puts textbooks from «Кітаптар» on a period: «Жаңа заман» → 8-сынып | Атамұра,
// 8-сынып | Мектеп … and picks the tests of each. One book can be on several periods; a test can
// belong to several books of its period. Nothing is copied: a row links an existing book, and
// the tests stay where they are. Changes are live at once (like the books themselves); students
// see a book only while it is published and has at least one published test.

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const failWith = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const id = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : 0;
};

/** Every period's books with the ids of their tests, in the organizer's order. */
export async function shelfState() {
  const entries = await all('SELECT id, period_id, book_id, position FROM period_books ORDER BY period_id, position, id');
  const links = await all('SELECT entry_id, test_id FROM period_book_tests ORDER BY test_id');
  return entries.map((e) => ({ ...e, test_ids: links.filter((l) => l.entry_id === e.id).map((l) => l.test_id) }));
}

const entryById = async (entryId) => (await shelfState()).find((e) => e.id === entryId);

/** Tests of a period in the cabinet (topics not deleted). */
const periodTestIds = async (periodId) =>
  new Set(
    (await all('SELECT x.id FROM tests x JOIN topics t ON t.id = x.topic_id AND t.deleted = 0 WHERE t.period_id = ?', periodId)).map((r) => r.id),
  );

async function checkBook(bookId) {
  if (!bookId || !(await get('SELECT 1 AS ok FROM books WHERE id = ?', bookId))) failWith(400, 'Кітапты «Кітаптар» бөлімінен таңдаңыз.');
}

/** A clean list of test ids that all belong to the period. */
async function cleanTests(periodId, raw) {
  if (!Array.isArray(raw)) failWith(400, 'Тесттер тізімі қате.');
  const ids = [...new Set(raw.map(id).filter(Boolean))];
  const allowed = await periodTestIds(periodId);
  const foreign = ids.filter((x) => !allowed.has(x));
  if (foreign.length) failWith(400, 'Тек осы кезеңнің тесттерін таңдауға болады.');
  return ids;
}

export const orgShelvesRouter = express.Router();

orgShelvesRouter.get(
  '/',
  wrap(async (_req, res) => {
    res.json({ entries: await shelfState() });
  }),
);

/** Puts a book on a period (optionally with its tests). */
orgShelvesRouter.post(
  '/',
  wrap(async (req, res) => {
    const periodId = id(req.body?.period_id);
    const bookId = id(req.body?.book_id);
    if (!periodId || !(await get('SELECT 1 AS ok FROM periods WHERE id = ?', periodId))) failWith(400, 'Кезеңді таңдаңыз.');
    await checkBook(bookId);
    if (await get('SELECT 1 AS ok FROM period_books WHERE period_id = ? AND book_id = ?', periodId, bookId)) {
      failWith(409, 'Бұл кітап осы кезеңге бекітіліп қойған.');
    }
    const tests = req.body?.test_ids ? await cleanTests(periodId, req.body.test_ids) : [];
    const { pos } = await get('SELECT COALESCE(MAX(position), 0) + 1 AS pos FROM period_books WHERE period_id = ?', periodId);
    const { lastInsertRowid } = await run('INSERT INTO period_books (period_id, book_id, position) VALUES (?, ?, ?)', periodId, bookId, pos);
    if (tests.length) await batch(tests.map((t) => ['INSERT INTO period_book_tests (entry_id, test_id) VALUES (?, ?)', lastInsertRowid, t]));
    res.status(201).json(await entryById(lastInsertRowid));
  }),
);

/** Another book in the same place (its tests stay), and/or the tests of this book. */
orgShelvesRouter.put(
  '/:id(\\d+)',
  wrap(async (req, res) => {
    const entry = await entryById(id(req.params.id));
    if (!entry) failWith(404, 'Кезең кітабы табылмады.');
    const statements = [];
    if (req.body?.book_id !== undefined) {
      const bookId = id(req.body.book_id);
      await checkBook(bookId);
      if (bookId !== entry.book_id && (await get('SELECT 1 AS ok FROM period_books WHERE period_id = ? AND book_id = ?', entry.period_id, bookId))) {
        failWith(409, 'Бұл кітап осы кезеңге бекітіліп қойған.');
      }
      statements.push(['UPDATE period_books SET book_id = ? WHERE id = ?', bookId, entry.id]);
    }
    if (req.body?.test_ids !== undefined) {
      const tests = await cleanTests(entry.period_id, req.body.test_ids);
      statements.push(['DELETE FROM period_book_tests WHERE entry_id = ?', entry.id]);
      for (const t of tests) statements.push(['INSERT INTO period_book_tests (entry_id, test_id) VALUES (?, ?)', entry.id, t]);
    }
    if (statements.length) await batch(statements);
    res.json(await entryById(entry.id));
  }),
);

/** Takes the book off the period (the book and the tests stay). */
orgShelvesRouter.delete(
  '/:id(\\d+)',
  wrap(async (req, res) => {
    const entryId = id(req.params.id);
    if (!(await get('SELECT 1 AS ok FROM period_books WHERE id = ?', entryId))) failWith(404, 'Кезең кітабы табылмады.');
    await batch([
      ['DELETE FROM period_book_tests WHERE entry_id = ?', entryId],
      ['DELETE FROM period_books WHERE id = ?', entryId],
    ]);
    res.json({ ok: true });
  }),
);

orgShelvesRouter.post(
  '/reorder',
  wrap(async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(id).filter(Boolean) : [];
    const rows = ids.length ? await all(`SELECT id, period_id FROM period_books WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids) : [];
    if (!rows.length || rows.length !== ids.length || new Set(rows.map((r) => r.period_id)).size !== 1) failWith(400, 'Реттеу тізімі қате.');
    await batch(ids.map((x, i) => ['UPDATE period_books SET position = ? WHERE id = ?', i + 1, x]));
    res.json({ ok: true });
  }),
);

/** From the test editor: which books of its period a test belongs to. */
orgShelvesRouter.put(
  '/test/:testId(\\d+)',
  wrap(async (req, res) => {
    const testId = id(req.params.testId);
    const row = await get('SELECT t.period_id FROM tests x JOIN topics t ON t.id = x.topic_id AND t.deleted = 0 WHERE x.id = ?', testId);
    if (!row) failWith(400, 'Алдымен тестті тақырыпқа байланыстырыңыз.');
    const wanted = new Set((Array.isArray(req.body?.entry_ids) ? req.body.entry_ids : []).map(id).filter(Boolean));
    const entries = (await shelfState()).filter((e) => e.period_id === row.period_id);
    if ([...wanted].some((e) => !entries.some((x) => x.id === e))) failWith(400, 'Тек осы тест кезеңінің кітаптарын таңдауға болады.');
    const statements = [];
    for (const e of entries) {
      const has = e.test_ids.includes(testId);
      if (wanted.has(e.id) && !has) statements.push(['INSERT INTO period_book_tests (entry_id, test_id) VALUES (?, ?)', e.id, testId]);
      if (!wanted.has(e.id) && has) statements.push(['DELETE FROM period_book_tests WHERE entry_id = ? AND test_id = ?', e.id, testId]);
    }
    if (statements.length) await batch(statements);
    res.json({ entries: (await shelfState()).filter((e) => e.period_id === row.period_id) });
  }),
);

orgShelvesRouter.use((err, _req, res, next) => {
  if (!err.status) return next(err);
  res.status(err.status).json({ error: err.message });
});
