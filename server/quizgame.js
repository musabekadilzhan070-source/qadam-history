import express from 'express';
import { all, get, run, batch } from './db.js';
import { published, publishQuizzes, dumpDraft } from './publish.js';
import { forStudent, reviewItem, cleanAnswer, settingsOf, gradable } from './questions.js';
import { defaultTopicEmblem } from './emblem-defaults.js';

// ─── Quiz: the game format of a test ─────────────────────────────
// A quiz is a test of its own (tests.format = 'quiz'), published in the snapshot's `quizzes`
// list. A student goes through its questions one at a time, in the test's order. A wrong answer
// sends the question to the end of the queue, so the quiz ends only when every question has
// been answered correctly. The queue is kept on the server (quiz_runs), so leaving the page or
// reloading the browser never loses the progress, and each student has their own run.

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const failWith = (status, message, extra = {}) => {
  throw Object.assign(new Error(message), { status, extra });
};
const parse = (text, fallback) => {
  try {
    return JSON.parse(text) ?? fallback;
  } catch {
    return fallback;
  }
};
const posId = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : 0;
};

/** Grading in a quiz: a question counts only when fully right; the correct answer is always shown after a wrong one. */
export const quizSettings = (settings) => ({ ...settingsOf(settings), partial_credit: false, show_answers: true });

/** The published quizzes (older snapshots have none). */
export const liveQuizzes = (snap) => snap.quizzes || [];

/** Every question a student answers, in the test's order: a context gives each of its questions with the context. */
export function quizSteps(test) {
  const steps = [];
  for (const q of test.questions) {
    if (q.type === 'context') for (const c of q.children) steps.push({ q: c, ctx: q });
    else steps.push({ q, ctx: null });
  }
  return steps;
}

async function findQuiz(testId) {
  const snap = await published();
  const test = liveQuizzes(snap).find((x) => x.id === testId);
  if (!test) return null;
  const topic = snap.topics.find((t) => t.id === test.topic_id);
  const period = topic ? snap.periods.find((p) => p.id === topic.period_id) : null;
  const steps = quizSteps(test);
  return {
    snap,
    test,
    topic,
    period,
    steps,
    byId: new Map(steps.map((s) => [s.q.id, s])),
    settings: quizSettings(test.settings),
  };
}

/** A question as the student sees it (no answers), with its context when it has one. */
function studentStep(step, settings) {
  const q = forStudent(step.q, settings);
  return {
    ...q,
    context: step.ctx ? { title: step.ctx.text, body: step.ctx.data.body, image_id: step.ctx.image_id } : null,
  };
}

/** What a run row holds, as numbers and lists. */
export function readRun(row) {
  return {
    ...row,
    question_ids: parse(row.question_ids, []),
    queue: parse(row.queue, []),
    wrong_ids: parse(row.wrong_ids, []),
    log: parse(row.log, []),
  };
}

/** Questions answered correctly in a run: those no longer waiting in the queue. */
const doneCount = (r) => r.total - new Set(r.queue).size;

/** The figures shown at the end and in the results. */
export function runSummary(r) {
  return {
    run_id: r.id,
    test_id: r.test_id,
    title: r.test_title,
    started_at: r.started_at,
    finished_at: r.finished_at,
    finished: Boolean(r.finished_at),
    total: r.total,
    done: doneCount(r),
    percent: r.total ? Math.round((doneCount(r) / r.total) * 100) : 0,
    first_correct: r.first_correct,
    repeated: r.repeated,
    wrong_answers: r.wrong_answers,
    answers: r.answers,
    duration_sec: r.duration_sec || 0,
  };
}

const quizInfo = (found) => ({
  id: found.test.id,
  title: found.test.title,
  description: found.test.description || '',
  cover_image_id: found.test.cover_image_id ?? null,
  grade: found.test.grade ?? null,
  publisher: found.test.publisher || '',
  question_count: found.steps.length,
  topic: found.topic ? { id: found.topic.id, slug: found.topic.slug, title: found.topic.title, icon: found.topic.icon || defaultTopicEmblem(found.topic.slug) } : null,
  period: found.period ? { slug: found.period.slug, title: found.period.title, number: found.period.number } : null,
});

/**
 * The quiz after this one: the next in the same period with the same class and textbook (the same
 * book), in the period's order; otherwise the next quiz of the period.
 */
function nextQuiz(found) {
  const { snap, test, topic } = found;
  if (!snap || !topic) return null;
  const topics = snap.topics.filter((t) => t.period_id === topic.period_id);
  const order = new Map(topics.map((t, i) => [t.id, i]));
  const list = liveQuizzes(snap)
    .filter((x) => order.has(x.topic_id))
    .sort((a, b) => order.get(a.topic_id) - order.get(b.topic_id));
  const i = list.findIndex((x) => x.id === test.id);
  const after = i >= 0 ? list.slice(i + 1) : [];
  const same = after.find((x) => (x.grade ?? null) === (test.grade ?? null) && (x.publisher || '') === (test.publisher || ''));
  const next = same || after[0] || null;
  return next ? { id: next.id, title: next.title } : null;
}

/** The run as the game needs it: the question to answer now (or the end), and the progress. */
export function runView(r, found) {
  const summary = runSummary(r);
  const head = r.queue[0];
  const step = head ? found.byId.get(head) : null;
  const firstPass = head ? !r.wrong_ids.includes(head) : false;
  return {
    ...summary,
    version: r.version,
    quiz: quizInfo(found),
    // «Сұрақ 7 / 20» while going through the questions; then the questions to repeat.
    phase: summary.finished ? 'done' : firstPass ? 'main' : 'repeat',
    number: firstPass ? r.question_ids.indexOf(head) + 1 : null,
    to_repeat: new Set(r.queue.filter((id) => r.wrong_ids.includes(id))).size,
    left: new Set(r.queue).size,
    question: step ? studentStep(step, found.settings) : null,
    next: summary.finished ? nextQuiz(found) : null,
  };
}

/**
 * Keeps a run in step with the quiz as it is published now: questions the organizer removed
 * leave the queue (a run whose remaining questions were all removed is finished).
 */
export async function syncRun(r, found, table = 'quiz_runs') {
  if (r.finished_at) return r;
  const queue = r.queue.filter((id) => found.byId.has(id));
  if (queue.length === r.queue.length) return r;
  const done = !queue.length;
  const { changes } = await run(
    `UPDATE ${table} SET queue = ?, total = ?, version = version + 1, updated_at = datetime('now')${done ? ", finished_at = datetime('now')" : ''}
     WHERE id = ? AND version = ?`,
    JSON.stringify(queue),
    // Removed questions that were already answered still count in the total.
    r.question_ids.filter((id) => found.byId.has(id) || !r.queue.includes(id)).length,
    r.id,
    r.version,
  );
  return readRun(await get(`SELECT * FROM ${table} WHERE id = ?`, r.id));
}

const openRunOf = async (userId, testId) => {
  const row = await get('SELECT * FROM quiz_runs WHERE user_id = ? AND test_id = ? AND finished_at IS NULL ORDER BY id DESC LIMIT 1', userId, testId);
  return row ? readRun(row) : null;
};

/** The student's unfinished run of this quiz, or a new one. Two starts at once make one run. */
async function startRun(userId, found) {
  const open = await openRunOf(userId, found.test.id);
  if (open) return syncRun(open, found);
  const ids = found.steps.map((s) => s.q.id);
  if (!ids.length) failWith(400, 'Бұл Quiz-де әзірге сұрақ жоқ.');
  // The unique index on unfinished runs makes a second start at the same moment a no-op.
  await run(
    `INSERT OR IGNORE INTO quiz_runs (user_id, test_id, test_title, question_ids, queue, total) VALUES (?, ?, ?, ?, ?, ?)`,
    userId,
    found.test.id,
    found.test.title,
    JSON.stringify(ids),
    JSON.stringify(ids),
    ids.length,
  );
  return openRunOf(userId, found.test.id);
}

const MAX_GAP_SEC = 5 * 60;
const MAX_LOG = 3000;
const sqliteMs = (text) => Date.parse(`${String(text).replace(' ', 'T')}Z`);

const isEmptyAnswer = (q, a) =>
  q.type === 'open' ? !String(a ?? '').trim() : Array.isArray(a) ? a.length === 0 : !a || Object.keys(a).length === 0;

/**
 * One answer to the question at the head of the queue. Right: the question leaves the queue.
 * Wrong: it goes to the end of the queue and comes back after the others. The run row is
 * changed only if nobody changed it meanwhile (version), so a double tap counts once.
 */
async function answerRun(userId, runId, body) {
  const row = await get('SELECT * FROM quiz_runs WHERE id = ? AND user_id = ?', runId, userId);
  if (!row) failWith(404, 'Quiz табылмады.');
  const found = await findQuiz(row.test_id);
  if (!found) failWith(404, 'Бұл Quiz қазір оқушыларға жабық.');
  return applyAnswer(await syncRun(readRun(row), found), found, body);
}

/** Grades an answer to the head of the queue of a run (of a student, or of a link) and moves the queue. */
export async function applyAnswer(r, found, body, table = 'quiz_runs') {
  if (r.finished_at) failWith(409, 'Бұл Quiz аяқталған.', { state: runView(r, found) });
  const head = r.queue[0];
  const questionId = posId(body?.question_id);
  // An answer to a question that is not the current one (an old tab, a repeated request): the
  // student gets the current state instead and nothing is counted.
  if (questionId !== head || (body?.version !== undefined && Number(body.version) !== r.version)) {
    failWith(409, 'Quiz басқа бетте жалғасқан. Қазіргі сұрақ көрсетілді.', { state: runView(r, found) });
  }
  const step = found.byId.get(head);
  const answer = cleanAnswer(step.q, body?.answer);
  if (isEmptyAnswer(step.q, answer)) failWith(400, 'Алдымен жауап беріңіз.');
  const item = reviewItem(step.q, answer, found.settings, step.ctx);
  const ok = item.is_correct;

  const queue = r.queue.slice(1);
  const wrong = new Set(r.wrong_ids);
  const firstTry = !wrong.has(head);
  if (!ok) {
    queue.push(head);
    wrong.add(head);
  }
  const now = Date.now();
  const last = sqliteMs(r.updated_at);
  const gap = Number.isFinite(last) ? Math.max(0, Math.min(MAX_GAP_SEC, Math.round((now - last) / 1000))) : 0;
  const log = [...r.log, { q: head, ok, t: Math.round(now / 1000) }].slice(-MAX_LOG);
  const finished = !queue.length;
  const { changes } = await run(
    `UPDATE ${table} SET queue = ?, wrong_ids = ?, log = ?, first_correct = first_correct + ?, repeated = ?, wrong_answers = wrong_answers + ?,
            answers = answers + 1, duration_sec = COALESCE(duration_sec, 0) + ?, version = version + 1, updated_at = datetime('now')
            ${finished ? ", finished_at = datetime('now')" : ''}
     WHERE id = ? AND version = ? AND finished_at IS NULL`,
    JSON.stringify(queue),
    JSON.stringify([...wrong]),
    JSON.stringify(log),
    ok && firstTry ? 1 : 0,
    wrong.size,
    ok ? 0 : 1,
    gap,
    r.id,
    r.version,
  );
  const fresh = readRun(await get(`SELECT * FROM ${table} WHERE id = ?`, r.id));
  if (!changes) failWith(409, 'Бұл жауап бұрын қабылданған. Қазіргі сұрақ көрсетілді.', { state: runView(fresh, found) });
  return { correct: ok, feedback: feedbackOf(item), state: runView(fresh, found) };
}

/** What the student sees after answering: the verdict, the correct answer and the explanation. */
function feedbackOf(item) {
  const out = { type: item.type, explanation: item.explanation || '' };
  if (item.correct_option_ids) out.correct_option_ids = item.correct_option_ids;
  if (item.chosen_option_ids) out.chosen_option_ids = item.chosen_option_ids;
  if (item.options) out.options = item.options;
  if (item.pairs) out.pairs = item.pairs;
  if (item.correct_order) out.correct_order = item.correct_order;
  if (item.chosen_order) out.chosen_order = item.chosen_order;
  if (item.accepted) out.accepted = item.accepted;
  if (item.answer !== undefined) out.answer = item.answer;
  return out;
}

// ─── Lists for the student pages ─────────────────────────────────

/** The student's state in every quiz: in progress (with how far) or finished (how many times). */
export async function quizProgress(userId) {
  if (!userId) return new Map();
  const rows = await all('SELECT test_id, queue, total, finished_at FROM quiz_runs WHERE user_id = ? ORDER BY id', userId);
  const map = new Map();
  for (const r of rows) {
    const p = map.get(r.test_id) || { finished: 0, open: null };
    if (r.finished_at) p.finished += 1;
    else {
      const left = new Set(parse(r.queue, [])).size;
      p.open = { done: r.total - left, total: r.total };
    }
    map.set(r.test_id, p);
  }
  return map;
}

/** A quiz card for the period and book pages. */
export function quizCard(x, progress, topic, period) {
  const p = progress.get(x.id);
  return {
    id: x.id,
    format: 'quiz',
    title: x.title,
    description: x.description || '',
    cover_image_id: x.cover_image_id ?? null,
    grade: x.grade ?? null,
    publisher: x.publisher || '',
    question_count: gradable(x.questions).length,
    finished_times: p?.finished || 0,
    in_progress: p?.open || null,
    slug: topic?.slug || '',
    topic_title: topic?.title || '',
    topic_icon: topic ? topic.icon || defaultTopicEmblem(topic.slug) : null,
    summary: topic?.summary || '',
    period_slug: period?.slug || '',
    period_title: period?.title || '',
    period_number: period?.number || 0,
  };
}

/** Every quiz run of a student, newest first (their «Менің нәтижелерім»). */
export async function userQuizResults(userId) {
  const rows = (await all('SELECT * FROM quiz_runs WHERE user_id = ? ORDER BY COALESCE(finished_at, updated_at) DESC, id DESC', userId)).map(readRun);
  const runs = rows.map(runSummary);
  const finished = runs.filter((r) => r.finished);
  return {
    summary: {
      finished: finished.length,
      in_progress: runs.length - finished.length,
      quizzes: new Set(finished.map((r) => r.test_id)).size,
      first_correct: finished.reduce((s, r) => s + r.first_correct, 0),
      questions: finished.reduce((s, r) => s + r.total, 0),
      wrong_answers: finished.reduce((s, r) => s + r.wrong_answers, 0),
    },
    runs,
  };
}

/** Quiz runs of one Almaty day (the report for the curator): finished that day or answered in. */
export async function quizRunsBetween(userId, from, to) {
  const rows = await all(
    `SELECT * FROM quiz_runs WHERE user_id = ? AND ((finished_at >= ? AND finished_at < ?) OR (finished_at IS NULL AND updated_at >= ? AND updated_at < ?))
     ORDER BY COALESCE(finished_at, updated_at), id`,
    userId,
    from,
    to,
    from,
    to,
  );
  return rows.map((r) => runSummary(readRun(r)));
}

// ─── Student API: /api/quizzes ───────────────────────────────────
export const quizRouter = express.Router();

/** The quiz page: the quiz, the student's unfinished run (if any) and their last finished one. */
quizRouter.get(
  '/:id(\\d+)',
  wrap(async (req, res) => {
    const found = await findQuiz(posId(req.params.id));
    if (!found) return res.status(404).json({ error: 'Quiz табылмады немесе әзірге жабық.' });
    let open = await openRunOf(req.user.id, found.test.id);
    if (open) open = await syncRun(open, found);
    const last = await get('SELECT * FROM quiz_runs WHERE user_id = ? AND test_id = ? AND finished_at IS NOT NULL ORDER BY id DESC LIMIT 1', req.user.id, found.test.id);
    const times = (await get('SELECT COUNT(*) AS n FROM quiz_runs WHERE user_id = ? AND test_id = ? AND finished_at IS NOT NULL', req.user.id, found.test.id)).n;
    res.json({
      quiz: quizInfo(found),
      run: open && !open.finished_at ? runView(open, found) : null,
      last: last ? runSummary(readRun(last)) : null,
      finished_times: times,
    });
  }),
);

/** Starts the quiz, or continues the unfinished run. */
quizRouter.post(
  '/:id(\\d+)/start',
  wrap(async (req, res) => {
    const found = await findQuiz(posId(req.params.id));
    if (!found) return res.status(404).json({ error: 'Quiz табылмады немесе әзірге жабық.' });
    const r = await startRun(req.user.id, found);
    res.json(runView(r, found));
  }),
);

/** The answer to the current question of a run. */
quizRouter.post(
  '/runs/:run(\\d+)/answer',
  wrap(async (req, res) => {
    res.json(await answerRun(req.user.id, posId(req.params.run), req.body || {}));
  }),
);

/** A run of the student (the end screen after a reload). */
quizRouter.get(
  '/runs/:run(\\d+)',
  wrap(async (req, res) => {
    const row = await get('SELECT * FROM quiz_runs WHERE id = ? AND user_id = ?', posId(req.params.run), req.user.id);
    if (!row) return res.status(404).json({ error: 'Нәтиже табылмады.' });
    const r = readRun(row);
    const found = await findQuiz(r.test_id);
    res.json(found ? runView(r, found) : { ...runSummary(r), quiz: { id: r.test_id, title: r.test_title }, phase: r.finished_at ? 'done' : 'closed', question: null, next: null });
  }),
);

quizRouter.use((err, _req, res, next) => {
  if (!err.status) return next(err);
  res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
});

// ─── Copying classic tests into quizzes ──────────────────────────

/**
 * Makes the quiz copy of every classic test that has none yet: same topic, class, textbook,
 * position, settings, questions (with contexts, matching pairs, chronology items and pictures)
 * and options, in the same books of the period. The copy is a separate test: later edits of
 * either one do not change the other. quiz_sources remembers each copied test for good, so
 * running this again never makes a second copy (not even after a copy was deleted).
 * Before the first copy the content tables are saved to data_backups. Copies of live tests go
 * live; the report checks every copy against its source.
 */
export async function copyClassicToQuizzes({ note = 'Quiz көшірмелері' } = {}) {
  const pending = (
    await all(
      `SELECT x.id FROM tests x JOIN topics t ON t.id = x.topic_id AND t.deleted = 0
       WHERE COALESCE(x.format, 'classic') <> 'quiz'
         AND x.id NOT IN (SELECT source_test_id FROM quiz_sources)
         AND NOT EXISTS (SELECT 1 FROM tests q WHERE q.format = 'quiz' AND q.source_test_id = x.id)
       ORDER BY x.id`,
    )
  ).map((r) => r.id);
  if (!pending.length) return { copied: 0, questions: 0, options: 0, live: 0, mismatches: [], backup_id: null };

  const dump = await dumpDraft();
  dump.period_book_tests = await all('SELECT * FROM period_book_tests');
  const backup = await run('INSERT INTO data_backups (note, data) VALUES (?, ?)', `${note}: көшіру алдындағы резерв`, JSON.stringify(dump));

  const list = pending.join(',');
  const { m: maxTest } = await get('SELECT COALESCE(MAX(id), 0) AS m FROM tests');
  const { m: maxQuestion } = await get('SELECT COALESCE(MAX(id), 0) AS m FROM questions');
  // One write transaction: either every copy is there with all its questions, or nothing changed.
  await batch([
    [
      `INSERT INTO tests (topic_id, position, title, published, description, cover_image_id, settings, grade, publisher, subject,
                          book_year, book_authors, book_pages, format, source_test_id, updated_at)
       SELECT topic_id, position, (CASE WHEN length(title) > 153 THEN substr(title, 1, 153) ELSE title END) || ' (QUIZ)', published,
              description, cover_image_id, settings, grade, publisher, subject, book_year, book_authors, book_pages, 'quiz', id, datetime('now')
       FROM tests WHERE id IN (${list}) ORDER BY id`,
    ],
    [`INSERT OR IGNORE INTO quiz_sources (source_test_id, quiz_test_id) SELECT source_test_id, id FROM tests WHERE id > ? AND format = 'quiz' AND source_test_id IS NOT NULL`, maxTest],
    [
      `INSERT INTO questions (topic_id, test_id, position, text, explanation, image_id, type, points, data, parent_id, copied_from)
       SELECT q.topic_id, n.id, q.position, q.text, q.explanation, q.image_id, q.type, q.points, q.data, NULL, q.id
       FROM questions q JOIN tests n ON n.source_test_id = q.test_id AND n.format = 'quiz' AND n.id > ?
       ORDER BY q.test_id, q.id`,
      maxTest,
    ],
    // A context's questions point at the copy of their context.
    [
      `UPDATE questions SET parent_id = (
         SELECT n.id FROM questions n WHERE n.test_id = questions.test_id AND n.id > ?
           AND n.copied_from = (SELECT o.parent_id FROM questions o WHERE o.id = questions.copied_from))
       WHERE id > ? AND copied_from IN (SELECT id FROM questions WHERE parent_id IS NOT NULL AND id <= ?)`,
      maxQuestion,
      maxQuestion,
      maxQuestion,
    ],
    [
      `INSERT INTO options (question_id, position, text, is_correct, image_id)
       SELECT n.id, o.position, o.text, o.is_correct, o.image_id
       FROM questions n JOIN options o ON o.question_id = n.copied_from
       WHERE n.id > ? ORDER BY n.id, o.position, o.id`,
      maxQuestion,
    ],
    [
      `INSERT OR IGNORE INTO period_book_tests (entry_id, test_id, position)
       SELECT l.entry_id, n.id, l.position FROM period_book_tests l JOIN tests n ON n.source_test_id = l.test_id AND n.format = 'quiz' AND n.id > ?`,
      maxTest,
    ],
  ]);

  // Check every copy against its source: questions by type, options, correct options, pictures.
  const made = await all(`SELECT id, source_test_id, published FROM tests WHERE id > ? AND format = 'quiz' ORDER BY id`, maxTest);
  const shape = async (testId) =>
    get(
      `SELECT (SELECT COUNT(*) FROM questions WHERE test_id = ?1) AS questions,
              (SELECT COUNT(*) FROM questions WHERE test_id = ?1 AND parent_id IS NOT NULL) AS children,
              (SELECT group_concat(type || ':' || points || ':' || length(text) || ':' || length(data) || ':' || COALESCE(image_id, 0), '|')
                 FROM (SELECT type, points, text, data, image_id FROM questions WHERE test_id = ?1 ORDER BY position, id)) AS sig,
              (SELECT COUNT(*) FROM options o JOIN questions q ON q.id = o.question_id WHERE q.test_id = ?1) AS options,
              (SELECT COUNT(*) FROM options o JOIN questions q ON q.id = o.question_id WHERE q.test_id = ?1 AND o.is_correct = 1) AS correct,
              (SELECT COUNT(*) FROM options o JOIN questions q ON q.id = o.question_id WHERE q.test_id = ?1 AND o.image_id IS NOT NULL) AS pictures`,
      testId,
    );
  const mismatches = [];
  let questions = 0;
  let options = 0;
  for (const m of made) {
    const [a, b] = [await shape(m.source_test_id), await shape(m.id)];
    questions += b.questions;
    options += b.options;
    if (JSON.stringify(a) !== JSON.stringify(b)) mismatches.push({ source: m.source_test_id, quiz: m.id, source_shape: a, quiz_shape: b });
  }
  const live = await publishQuizzes(made.filter((m) => m.published).map((m) => m.id), `${note}: ${made.length} Quiz`);
  return { copied: made.length, questions, options, live: live.length, mismatches, backup_id: backup.lastInsertRowid };
}

// ─── Organizer API: /api/org/quizzes ─────────────────────────────
export const orgQuizRouter = express.Router();

/** Copies the classic tests that have no quiz yet. */
orgQuizRouter.post(
  '/copy',
  wrap(async (_req, res) => {
    res.json(await copyClassicToQuizzes({ note: 'Классикалық тесттерден Quiz көшірмелері' }));
  }),
);

/** How many classic tests still have no quiz copy. */
orgQuizRouter.get(
  '/copy',
  wrap(async (_req, res) => {
    const row = await get(
      `SELECT COUNT(*) AS n FROM tests x JOIN topics t ON t.id = x.topic_id AND t.deleted = 0
       WHERE COALESCE(x.format, 'classic') <> 'quiz' AND x.id NOT IN (SELECT source_test_id FROM quiz_sources)`,
    );
    res.json({ pending: row.n });
  }),
);

/** Every student's quiz runs (optionally of one quiz or one student), newest first. */
orgQuizRouter.get(
  '/results',
  wrap(async (req, res) => {
    const where = [];
    const args = [];
    if (posId(req.query.test)) {
      where.push('r.test_id = ?');
      args.push(posId(req.query.test));
    }
    if (posId(req.query.user)) {
      where.push('r.user_id = ?');
      args.push(posId(req.query.user));
    }
    const rows = await all(
      `SELECT r.*, u.display_name, u.username, u.email, x.grade, x.publisher, COALESCE(x.title, r.test_title) AS live_title,
              t.title AS topic_title, p.title AS period_title
       FROM quiz_runs r JOIN users u ON u.id = r.user_id
       LEFT JOIN tests x ON x.id = r.test_id LEFT JOIN topics t ON t.id = x.topic_id LEFT JOIN periods p ON p.id = t.period_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY COALESCE(r.finished_at, r.updated_at) DESC, r.id DESC LIMIT 1000`,
      ...args,
    );
    // Runs through a link (a typed name, no account): not when one student's runs are asked for.
    const linkRows = posId(req.query.user)
      ? []
      : await all(
          `SELECT r.*, x.grade, x.publisher, COALESCE(x.title, r.test_title) AS live_title, t.title AS topic_title, p.title AS period_title
           FROM link_quiz_runs r
           LEFT JOIN tests x ON x.id = r.test_id LEFT JOIN topics t ON t.id = x.topic_id LEFT JOIN periods p ON p.id = t.period_id
           ${posId(req.query.test) ? 'WHERE r.test_id = ?' : ''}
           ORDER BY COALESCE(r.finished_at, r.updated_at) DESC, r.id DESC LIMIT 1000`,
          ...(posId(req.query.test) ? [posId(req.query.test)] : []),
        );
    const view = (row, via) => ({
      ...runSummary(readRun(row)),
      title: row.live_title,
      via,
      user:
        via === 'link'
          ? { id: null, display_name: row.name, login: 'Сілтеме арқылы' }
          : { id: row.user_id, display_name: row.display_name, login: row.email || row.username },
      grade: row.grade ?? null,
      publisher: row.publisher || '',
      topic_title: row.topic_title || '',
      period_title: row.period_title || '',
    });
    const stamp = (r) => String(r.finished_at || r.updated_at || '');
    const runs = [...rows.map((r) => [stamp(r), view(r, 'site')]), ...linkRows.map((r) => [stamp(r), view(r, 'link')])]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([, v]) => v);
    res.json({ runs: runs.slice(0, 1500) });
  }),
);

orgQuizRouter.use((err, _req, res, next) => {
  if (!err.status) return next(err);
  res.status(err.status).json({ error: err.message });
});
