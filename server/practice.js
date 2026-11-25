import crypto from 'node:crypto';
import express from 'express';
import { all, get, run, batch } from './db.js';
import { published } from './publish.js';
import { forStudent, grade } from './questions.js';
import { makeToken, readToken } from './quiz.js';
import { dayOf } from './almaty.js';
import { DATE_CARDS, PERSON_CARDS } from './seed/cards.js';

// Three ways to practise beside the tests:
//   ҰБТ сынақ   a mock exam in the format of the national exam: single-choice questions mixed from
//               the classic tests of every period, one point each, a time limit, the score per period.
//   Карточкалар dates and persons to learn by heart, repeated in Leitner boxes.
//   Жетістіктер badges earned for the work done on the site.

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const parse = (text, fallback) => {
  try {
    return JSON.parse(text) ?? fallback;
  } catch {
    return fallback;
  }
};
const int = (v, min, max, dflt) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : dflt;
};

// ─── ҰБТ сынақ ─────────────────────────────────────────────────────
// In the ҰБТ «Қазақстан тарихы» has 20 single-choice tasks, one point each. The exam gives about
// two minutes a task, so 20 tasks get 40 minutes. The organizer can change both numbers.
export const MOCK_DEFAULTS = { question_count: 20, time_min: 40 };
const MOCK_GRACE_SEC = 90;

export async function mockSettings() {
  const row = await get("SELECT value FROM settings WHERE key = 'mock'");
  const s = { ...MOCK_DEFAULTS, ...parse(row?.value, {}) };
  return { question_count: int(s.question_count, 5, 60, 20), time_min: int(s.time_min, 5, 180, 40) };
}

const SETTINGS = { shuffle_options: true, show_answers: true, partial_credit: false, pass_percent: 0 };
const norm = (s) => String(s || '').toLocaleLowerCase('kk').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// The pool of a published snapshot: every single-choice question of the classic tests (one correct
// option, not inside a reading context), once per wording, with the period it belongs to.
const pools = new WeakMap();
function poolOf(snap) {
  if (pools.has(snap)) return pools.get(snap);
  const periodOfTopic = new Map(snap.topics.map((t) => [t.id, t.period_id]));
  const seen = new Set();
  const byId = new Map();
  const byPeriod = new Map(snap.periods.map((p) => [p.id, []]));
  for (const test of snap.tests) {
    const periodId = periodOfTopic.get(test.topic_id);
    if (!byPeriod.has(periodId)) continue;
    for (const q of test.questions) {
      if (!['single', 'image'].includes(q.type)) continue;
      if (q.options.filter((o) => o.is_correct).length !== 1 || q.options.length < 2) continue;
      const key = `${norm(q.text)}|${q.image_id || ''}`;
      if (!norm(q.text) && !q.image_id) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      const item = { q: { ...q, points: 1 }, periodId, topicId: test.topic_id };
      byId.set(q.id, item);
      byPeriod.get(periodId).push(item);
    }
  }
  const pool = { byId, byPeriod };
  pools.set(snap, pool);
  return pool;
}

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Picks the questions of a new exam: spread evenly over the periods, fresh ones first, in period order. */
export function pickMock(snap, count, recentIds = new Set()) {
  const { byPeriod } = poolOf(snap);
  const periods = snap.periods.filter((p) => byPeriod.get(p.id)?.length).sort((a, b) => a.number - b.number);
  if (!periods.length) return [];
  // Each period's share; what a small period cannot give goes to the others.
  const want = new Map(periods.map((p) => [p.id, 0]));
  let left = count;
  while (left > 0) {
    const open = periods.filter((p) => want.get(p.id) < byPeriod.get(p.id).length);
    if (!open.length) break;
    for (const p of open) {
      if (left <= 0) break;
      want.set(p.id, want.get(p.id) + 1);
      left -= 1;
    }
  }
  const picked = [];
  for (const p of periods) {
    const list = byPeriod.get(p.id);
    const fresh = shuffle(list.filter((x) => !recentIds.has(x.q.id)));
    const old = shuffle(list.filter((x) => recentIds.has(x.q.id)));
    picked.push(...[...fresh, ...old].slice(0, want.get(p.id)));
  }
  return picked;
}

async function recentMockIds(userId) {
  const rows = await all('SELECT question_ids FROM mock_runs WHERE user_id = ? ORDER BY id DESC LIMIT 3', userId);
  return new Set(rows.flatMap((r) => parse(r.question_ids, [])));
}

export async function mockInfo(userId) {
  const snap = await published();
  const { byPeriod } = poolOf(snap);
  const settings = await mockSettings();
  const runs = await all(
    'SELECT id, correct, total, score, max_score, by_period, duration_sec, created_at FROM mock_runs WHERE user_id = ? ORDER BY id DESC LIMIT 30',
    userId,
  );
  const pool = [...byPeriod.values()].reduce((s, l) => s + l.length, 0);
  return {
    settings,
    pool,
    ready: pool >= Math.min(settings.question_count, 5),
    periods: snap.periods
      .slice()
      .sort((a, b) => a.number - b.number)
      .map((p) => ({ id: p.id, number: p.number, title: p.title, slug: p.slug, questions: byPeriod.get(p.id)?.length || 0 })),
    runs: runs.map((r) => ({ ...r, by_period: parse(r.by_period, []) })),
  };
}

export async function startMock(userId) {
  const snap = await published();
  const settings = await mockSettings();
  const picked = pickMock(snap, settings.question_count, await recentMockIds(userId));
  if (picked.length < Math.min(settings.question_count, 5)) fail(409, 'ҰБТ сынағына сұрақ әзірге жеткіліксіз.');
  const nonce = crypto.randomBytes(12).toString('base64url');
  const ids = picked.map((x) => x.q.id);
  const token = await makeToken({ m: 1, u: userId, q: ids, s: Date.now(), n: nonce, l: settings.time_min * 60 });
  return {
    token,
    units: picked.map((x) => forStudent(x.q, SETTINGS)),
    question_count: ids.length,
    max_score: ids.length,
    time_limit_sec: settings.time_min * 60,
    question_time_sec: 0,
  };
}

/** Grades stored or new answers against the current snapshot; questions no longer published are left out. */
function gradeMock(snap, ids, answers) {
  const { byId } = poolOf(snap);
  const items = ids.map((id) => byId.get(id)).filter(Boolean);
  const result = grade({ questions: items.map((x) => x.q) }, items.map((x) => x.q.id), answers, SETTINGS);
  const periods = snap.periods.slice().sort((a, b) => a.number - b.number);
  const byPeriod = periods
    .map((p) => {
      const mine = result.items.filter((it) => byId.get(it.id)?.periodId === p.id);
      return { period_id: p.id, number: p.number, title: p.title, slug: p.slug, correct: mine.filter((i) => i.is_correct).length, total: mine.length };
    })
    .filter((p) => p.total > 0);
  // Each review item says which topic it came from, so a student knows what to read again.
  const topicTitle = new Map(snap.topics.map((t) => [t.id, t]));
  for (const it of result.items) {
    const t = topicTitle.get(byId.get(it.id)?.topicId);
    if (t) it.topic = { title: t.title, slug: t.slug };
  }
  return { ...result, by_period: byPeriod };
}

export async function submitMock(userId, body) {
  const session = await readToken(body?.token);
  if (!session || session.m !== 1 || session.u !== userId) fail(400, 'Сынақ сессиясы жарамсыз. Сынақты қайта бастаңыз.');
  const elapsed = Math.max(0, Math.round((Date.now() - session.s) / 1000));
  if (session.l && elapsed > session.l + MOCK_GRACE_SEC) fail(400, 'Сынақ уақыты әлдеқашан аяқталған. Сынақты қайта бастаңыз.');
  const snap = await published();
  const answers = body?.answers && typeof body.answers === 'object' ? body.answers : {};
  const r = gradeMock(snap, session.q, answers);
  const stored = Object.fromEntries(r.stored.map(({ question, answer }) => [question.id, answer]));
  const already = await get('SELECT id FROM mock_runs WHERE nonce = ?', session.n);
  let id = already?.id;
  if (!id) {
    const res = await run(
      `INSERT INTO mock_runs (user_id, nonce, question_ids, answers, correct, total, score, max_score, by_period, duration_sec)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(nonce) DO NOTHING`,
      userId, session.n, JSON.stringify(session.q), JSON.stringify(stored), r.correct, r.total, r.score, r.max_score,
      JSON.stringify(r.by_period), Math.min(elapsed, 6 * 3600),
    );
    id = res.lastInsertRowid ? Number(res.lastInsertRowid) : (await get('SELECT id FROM mock_runs WHERE nonce = ?', session.n))?.id;
  }
  return mockResult(userId, id, r, elapsed);
}

async function mockResult(userId, id, r, duration) {
  const prev = await get('SELECT MAX(score) AS best, COUNT(*) AS n FROM mock_runs WHERE user_id = ? AND id < ?', userId, id);
  return {
    id,
    correct: r.correct,
    total: r.total,
    score: r.score,
    max_score: r.max_score,
    percent: r.percent,
    duration_sec: duration,
    by_period: r.by_period,
    previous_best: prev?.n ? prev.best : null,
    items: r.items,
  };
}

export async function mockRun(userId, id) {
  const row = await get('SELECT * FROM mock_runs WHERE id = ? AND user_id = ?', id, userId);
  if (!row) fail(404, 'Сынақ нәтижесі табылмады.');
  const snap = await published();
  const r = gradeMock(snap, parse(row.question_ids, []), parse(row.answers, {}));
  // The saved score stays as it was on the day; the review shows the questions still published.
  const saved = { ...r, correct: row.correct, total: row.total, score: row.score, max_score: row.max_score, by_period: parse(row.by_period, []) };
  saved.percent = row.max_score ? Math.round((row.score / row.max_score) * 100) : 0;
  return { ...(await mockResult(userId, row.id, saved, row.duration_sec)), created_at: row.created_at };
}

// ─── Карточкалар ──────────────────────────────────────────────────
// Leitner boxes: «Білемін» moves a card one box up and puts its next review further away;
// «Қайталау» sends it back to box 1, to be asked again in this session. Box 4 and up counts as learned.
export const CARD_KINDS = ['date', 'person'];
const BOX_DAYS = [0, 1, 2, 4, 8, 16];
export const LEARNED_BOX = 4;

let seeding = null;
/** Adds the first set of cards once, when the site has never had any. */
export function ensureCards() {
  seeding ||= (async () => {
    const done = await get("SELECT value FROM settings WHERE key = 'cards_seeded'");
    if (done) return;
    const has = await get('SELECT 1 AS ok FROM fact_cards LIMIT 1');
    const rows = [...DATE_CARDS.map((c) => ['date', ...c]), ...PERSON_CARDS.map((c) => ['person', ...c])];
    await batch([
      ...(has
        ? []
        : rows.map(([kind, period, front, back, note], i) => [
            'INSERT INTO fact_cards (kind, period_number, front, back, note, position) VALUES (?, ?, ?, ?, ?, ?)',
            kind, period, front, back, note, i + 1,
          ])),
      ["INSERT INTO settings (key, value) VALUES ('cards_seeded', '1') ON CONFLICT(key) DO NOTHING"],
    ]);
  })().catch((err) => {
    seeding = null;
    throw err;
  });
  return seeding;
}

const cardOut = (c) => ({ id: c.id, kind: c.kind, front: c.front, back: c.back, note: c.note, period_number: c.period_number });

export async function cardsFor(userId) {
  await ensureCards();
  const snap = await published();
  const cards = await all('SELECT * FROM fact_cards WHERE published = 1 ORDER BY period_number, kind, position, id');
  const progress = await all('SELECT card_id, box, due_at, right_count, wrong_count FROM card_progress WHERE user_id = ?', userId);
  return {
    periods: snap.periods
      .slice()
      .sort((a, b) => a.number - b.number)
      .map((p) => ({ number: p.number, title: p.title, slug: p.slug })),
    cards: cards.map(cardOut),
    progress: Object.fromEntries(progress.map((p) => [p.card_id, { box: p.box, due_at: p.due_at, right: p.right_count, wrong: p.wrong_count }])),
    learned_box: LEARNED_BOX,
    now: new Date().toISOString().slice(0, 19).replace('T', ' '),
  };
}

export async function reviewCard(userId, cardId, known) {
  const card = await get('SELECT id FROM fact_cards WHERE id = ? AND published = 1', cardId);
  if (!card) fail(404, 'Карточка табылмады.');
  const cur = await get('SELECT box FROM card_progress WHERE user_id = ? AND card_id = ?', userId, cardId);
  const box = known ? Math.min(5, (cur?.box || 0) + 1) : 1;
  const days = known ? BOX_DAYS[box] : 0;
  await batch([
    [
      `INSERT INTO card_progress (user_id, card_id, box, due_at, right_count, wrong_count, updated_at)
       VALUES (?, ?, ?, datetime('now', ?), ?, ?, datetime('now'))
       ON CONFLICT(user_id, card_id) DO UPDATE SET box = excluded.box, due_at = excluded.due_at,
         right_count = right_count + excluded.right_count, wrong_count = wrong_count + excluded.wrong_count, updated_at = excluded.updated_at`,
      userId, cardId, box, `+${days} days`, known ? 1 : 0, known ? 0 : 1,
    ],
    [
      'INSERT INTO card_days (user_id, day, reviews) VALUES (?, ?, 1) ON CONFLICT(user_id, day) DO UPDATE SET reviews = reviews + 1',
      userId, dayOf(),
    ],
  ]);
  const p = await get('SELECT box, due_at, right_count, wrong_count FROM card_progress WHERE user_id = ? AND card_id = ?', userId, cardId);
  return { card_id: cardId, box: p.box, due_at: p.due_at, right: p.right_count, wrong: p.wrong_count };
}

/** A card from the organizer's form. */
export function cardFields(body) {
  const s = (v, max) => String(v ?? '').trim().slice(0, max);
  const kind = CARD_KINDS.includes(body?.kind) ? body.kind : 'date';
  const front = s(body?.front, 120);
  const back = s(body?.back, 300);
  const note = s(body?.note, 500);
  if (!front) fail(400, kind === 'date' ? 'Датаны жазыңыз.' : 'Тұлғаның атын жазыңыз.');
  if (!back) fail(400, kind === 'date' ? 'Оқиғаны жазыңыз.' : 'Тұлға кім екенін жазыңыз.');
  const period = body?.period_number === null || body?.period_number === '' ? null : int(body?.period_number, 1, 9, null);
  return { kind, front, back, note, period_number: period, published: body?.published === false ? 0 : 1 };
}

// ─── Жетістіктер ──────────────────────────────────────────────────
// Every badge is a rule over what the student has done; an earned badge is kept with its date.

async function userStats(userId) {
  const snap = await published();
  const tests = await all(
    `SELECT test_id, MAX(CASE WHEN total > 0 AND correct = total THEN 1 ELSE 0 END) AS perfect
     FROM attempts WHERE user_id = ? AND kind = 'test' AND test_id IS NOT NULL GROUP BY test_id`,
    userId,
  );
  const reworks = (await get("SELECT COUNT(*) AS n FROM attempts WHERE user_id = ? AND kind = 'rework'", userId)).n;
  const quizzes = (await get('SELECT COUNT(DISTINCT test_id) AS n FROM quiz_runs WHERE user_id = ? AND finished_at IS NOT NULL', userId)).n;
  const mock = await get('SELECT COUNT(*) AS n, MAX(CASE WHEN max_score > 0 THEN score * 1.0 / max_score END) AS best FROM mock_runs WHERE user_id = ?', userId);
  const cards = await get('SELECT COUNT(*) AS seen, SUM(CASE WHEN box >= ? THEN 1 ELSE 0 END) AS learned FROM card_progress WHERE user_id = ?', LEARNED_BOX, userId);
  // Days with any work: tests, quizzes, mock exams, cards (in Almaty days).
  const stamps = await all(
    `SELECT created_at AS t FROM attempts WHERE user_id = ?1
     UNION ALL SELECT finished_at FROM quiz_runs WHERE user_id = ?1 AND finished_at IS NOT NULL
     UNION ALL SELECT created_at FROM mock_runs WHERE user_id = ?1`,
    userId,
  );
  const days = new Set(stamps.map((r) => dayOf(Date.parse(`${r.t.replace(' ', 'T')}Z`))));
  for (const r of await all('SELECT day FROM card_days WHERE user_id = ?', userId)) days.add(r.day);
  const doneTests = new Set(tests.map((t) => t.test_id));
  const periodOfTopic = new Map(snap.topics.map((t) => [t.id, t.period_id]));
  const periods = snap.periods
    .slice()
    .sort((a, b) => a.number - b.number)
    .map((p) => {
      const mine = snap.tests.filter((x) => periodOfTopic.get(x.topic_id) === p.id);
      return { number: p.number, title: p.title, total: mine.length, done: mine.filter((x) => doneTests.has(x.id)).length };
    });
  return {
    tests: doneTests.size,
    perfect: tests.filter((t) => t.perfect).length,
    reworks,
    quizzes,
    mocks: mock.n,
    mockBest: mock.best ?? 0,
    cardsLearned: cards.learned || 0,
    cardsSeen: cards.seen || 0,
    streak: longestStreak(days),
    periods,
  };
}

/** The longest run of consecutive days in a set of 'YYYY-MM-DD'. */
export function longestStreak(days) {
  const sorted = [...days].sort();
  let best = 0;
  let cur = 0;
  let prev = null;
  for (const d of sorted) {
    const t = Date.parse(`${d}T00:00:00Z`);
    cur = prev !== null && t - prev === 86400000 ? cur + 1 : 1;
    best = Math.max(best, cur);
    prev = t;
  }
  return best;
}

const PERIOD_NAMES = ['', 'Ежелгі заман', 'Орта ғасыр', 'Жаңа заман', 'Қазіргі заман'];

/** The badges in display order: [key, title, how to earn, icon, value(stats), need]. */
function badgeRules(stats) {
  const rules = [
    ['first_test', 'Алғашқы қадам', 'Бірінші тестті тапсыр', 'step', stats.tests, 1],
    ['tests_10', 'Ізденуші', '10 түрлі тест тапсыр', 'tests', stats.tests, 10],
    ['tests_50', 'Тарихшы', '50 түрлі тест тапсыр', 'scroll', stats.tests, 50],
    ['tests_150', 'Шежіреші', '150 түрлі тест тапсыр', 'crown', stats.tests, 150],
    ['perfect_1', 'Мінсіз', 'Бір тестті 100% тапсыр', 'target', stats.perfect, 1],
    ['perfect_10', 'Мерген', '10 тестті 100% тапсыр', 'target', stats.perfect, 10],
    ['rework_1', 'Қатесін түзеген', 'Қатемен жұмысты бір рет орында', 'repeat', stats.reworks, 1],
    ['quiz_1', 'Quiz жеңімпазы', 'Бір quiz-ді соңына дейін өт', 'quiz', stats.quizzes, 1],
    ['quiz_10', 'Quiz шебері', '10 quiz-ді соңына дейін өт', 'quiz', stats.quizzes, 10],
    ['mock_1', 'ҰБТ-ға қадам', 'Бірінші ҰБТ сынағын тапсыр', 'exam', stats.mocks, 1],
    ['mock_80', 'Жоғары балл', 'ҰБТ сынағынан 80% және одан жоғары жина', 'exam', Math.round(stats.mockBest * 100), 80],
    ['mock_100', 'Толық балл', 'ҰБТ сынағынан ең жоғары балл жина', 'crown', Math.round(stats.mockBest * 100), 100],
    ['cards_20', 'Даталар білгірі', '20 карточканы меңгер', 'cards', stats.cardsLearned, 20],
    ['cards_100', 'Есте сақтау шебері', '100 карточканы меңгер', 'cards', stats.cardsLearned, 100],
    ['streak_3', 'Табанды', '3 күн қатарынан оқы', 'flame', stats.streak, 3],
    ['streak_7', 'Тұрақты', '7 күн қатарынан оқы', 'flame', stats.streak, 7],
    ['streak_30', 'Темірдей тәртіп', '30 күн қатарынан оқы', 'flame', stats.streak, 30],
  ];
  for (const p of stats.periods) {
    if (!p.total || !PERIOD_NAMES[p.number]) continue;
    rules.push([`period_${p.number}`, `${p.title} білгірі`, `«${p.title}» кезеңінің барлық тестін тапсыр`, 'periods', p.done, p.total]);
  }
  return rules;
}

/** All badges with the student's progress; newly earned ones are saved and listed in `fresh`. */
export async function badgesFor(userId) {
  const stats = await userStats(userId);
  const rules = badgeRules(stats);
  const have = new Map((await all('SELECT badge, earned_at, seen FROM user_badges WHERE user_id = ?', userId)).map((r) => [r.badge, r]));
  const earnedNow = rules.filter(([key, , , , value, need]) => value >= need && !have.has(key)).map(([key]) => key);
  if (earnedNow.length) {
    await batch(earnedNow.map((key) => ['INSERT INTO user_badges (user_id, badge) VALUES (?, ?) ON CONFLICT DO NOTHING', userId, key]));
    for (const r of await all('SELECT badge, earned_at, seen FROM user_badges WHERE user_id = ?', userId)) have.set(r.badge, r);
  }
  const badges = rules.map(([key, title, text, icon, value, need]) => ({
    key,
    title,
    text,
    icon,
    have: Math.min(value, need),
    need,
    earned_at: have.get(key)?.earned_at || null,
  }));
  return {
    badges,
    earned: badges.filter((b) => b.earned_at).length,
    fresh: badges.filter((b) => b.earned_at && !have.get(b.key)?.seen),
    stats: { streak: stats.streak, cards_learned: stats.cardsLearned, mocks: stats.mocks, mock_best_percent: stats.mocks ? Math.round(stats.mockBest * 100) : null },
  };
}

// ─── Student routes: /api/practice ────────────────────────────────
export const practiceRouter = express.Router();

practiceRouter.get('/mock', wrap(async (req, res) => res.json(await mockInfo(req.user.id))));
practiceRouter.post('/mock/start', wrap(async (req, res) => res.json(await startMock(req.user.id))));
practiceRouter.post('/mock/submit', wrap(async (req, res) => res.json(await submitMock(req.user.id, req.body))));
practiceRouter.get('/mock/:id(\\d+)', wrap(async (req, res) => res.json(await mockRun(req.user.id, Number(req.params.id)))));

practiceRouter.get('/cards', wrap(async (req, res) => res.json(await cardsFor(req.user.id))));
practiceRouter.post(
  '/cards/:id(\\d+)/review',
  wrap(async (req, res) => res.json(await reviewCard(req.user.id, Number(req.params.id), req.body?.known === true))),
);

practiceRouter.get('/badges', wrap(async (req, res) => res.json(await badgesFor(req.user.id))));
/** Marks the new badges as shown (the toast was seen). */
practiceRouter.post(
  '/badges/seen',
  wrap(async (req, res) => {
    await run('UPDATE user_badges SET seen = 1 WHERE user_id = ? AND seen = 0', req.user.id);
    res.json({ ok: true });
  }),
);

practiceRouter.use((err, _req, res, next) => {
  if (!err.status) return next(err);
  res.status(err.status).json({ error: err.message });
});

// ─── Organizer routes: /api/org/practice ──────────────────────────
export const orgPracticeRouter = express.Router();

orgPracticeRouter.get(
  '/cards',
  wrap(async (_req, res) => {
    await ensureCards();
    const cards = await all('SELECT * FROM fact_cards ORDER BY period_number, kind, position, id');
    const learned = await all('SELECT card_id, COUNT(*) AS n FROM card_progress WHERE box >= ? GROUP BY card_id', LEARNED_BOX);
    const n = new Map(learned.map((r) => [r.card_id, r.n]));
    const snap = await published();
    res.json({
      periods: snap.periods.slice().sort((a, b) => a.number - b.number).map((p) => ({ number: p.number, title: p.title })),
      cards: cards.map((c) => ({ ...cardOut(c), published: Boolean(c.published), learned_by: n.get(c.id) || 0 })),
    });
  }),
);
orgPracticeRouter.post(
  '/cards',
  wrap(async (req, res) => {
    const c = cardFields(req.body);
    const pos = (await get('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM fact_cards')).p;
    const r = await run(
      'INSERT INTO fact_cards (kind, front, back, note, period_number, published, position) VALUES (?, ?, ?, ?, ?, ?, ?)',
      c.kind, c.front, c.back, c.note, c.period_number, c.published, pos,
    );
    res.status(201).json({ card: cardOut(await get('SELECT * FROM fact_cards WHERE id = ?', Number(r.lastInsertRowid))) });
  }),
);
orgPracticeRouter.put(
  '/cards/:id(\\d+)',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!(await get('SELECT id FROM fact_cards WHERE id = ?', id))) fail(404, 'Карточка табылмады.');
    const c = cardFields(req.body);
    await run(
      "UPDATE fact_cards SET kind = ?, front = ?, back = ?, note = ?, period_number = ?, published = ?, updated_at = datetime('now') WHERE id = ?",
      c.kind, c.front, c.back, c.note, c.period_number, c.published, id,
    );
    res.json({ card: cardOut(await get('SELECT * FROM fact_cards WHERE id = ?', id)) });
  }),
);
orgPracticeRouter.delete(
  '/cards/:id(\\d+)',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    await batch([
      ['DELETE FROM card_progress WHERE card_id = ?', id],
      ['DELETE FROM fact_cards WHERE id = ?', id],
    ]);
    res.json({ ok: true });
  }),
);

orgPracticeRouter.get(
  '/mock',
  wrap(async (_req, res) => {
    const snap = await published();
    const { byPeriod } = poolOf(snap);
    const runs = await all(
      `SELECT m.id, m.correct, m.total, m.score, m.max_score, m.duration_sec, m.created_at, u.display_name, u.email
       FROM mock_runs m JOIN users u ON u.id = m.user_id ORDER BY m.id DESC LIMIT 200`,
    );
    res.json({
      settings: await mockSettings(),
      defaults: MOCK_DEFAULTS,
      periods: snap.periods
        .slice()
        .sort((a, b) => a.number - b.number)
        .map((p) => ({ number: p.number, title: p.title, questions: byPeriod.get(p.id)?.length || 0 })),
      runs,
    });
  }),
);
orgPracticeRouter.put(
  '/mock',
  wrap(async (req, res) => {
    const s = { question_count: int(req.body?.question_count, 5, 60, 20), time_min: int(req.body?.time_min, 5, 180, 40) };
    await run("INSERT INTO settings (key, value) VALUES ('mock', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(s));
    res.json({ settings: s });
  }),
);

orgPracticeRouter.use((err, _req, res, next) => {
  if (!err.status) return next(err);
  res.status(err.status).json({ error: err.message });
});
