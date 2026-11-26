import crypto from 'node:crypto';
import express from 'express';
import { all, get, run, batch } from './db.js';
import { published } from './publish.js';
import { forStudent, grade } from './questions.js';
import { makeToken, readToken } from './quiz.js';
import { dayOf } from './almaty.js';
import { DATE_CARDS, PERSON_CARDS } from './seed/cards.js';
import { CARD_FIXES_V3, CARD_FIXES_V4 } from './seed/card-fixes.js';
import { VARIANTS } from './seed/variants.js';
import { rowsToQuestions } from './transfer.js';

// Three ways to practise beside the tests:
//   Сынақ тесттер ten fixed variants of 50 questions (levels A, B, C) in the manner of the ҰБТ,
//               a time limit, the score per level and per period.
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

// ─── Сынақ тесттер ──────────────────────────────────────────────────
// Ten fixed variants of 50 questions in the manner of the ҰБТ (server/seed/variants.js): level A
// (25 questions, a fact), level B (15, understanding), level C (10: several answers, matching or
// ordering). A and B give 1 point; C gives 2 for a full answer and 1 for an answer with one slip,
// as in the ҰБТ, so a variant gives 60 points. The organizer sets the time.
export const MOCK_DEFAULTS = { time_min: 100 };
const MOCK_GRACE_SEC = 90;
export const LEVELS = ['A', 'B', 'C'];
export const LEVEL_TITLES = { A: 'А деңгейі', B: 'В деңгейі', C: 'С деңгейі' };

export async function mockSettings() {
  const row = await get("SELECT value FROM settings WHERE key = 'mock'");
  const s = { ...MOCK_DEFAULTS, ...parse(row?.value, {}) };
  // Settings saved before the variants had a 40-minute default for 20 questions.
  const time = s.question_count !== undefined && !s.variants ? MOCK_DEFAULTS.time_min : s.time_min;
  return { time_min: int(time, 10, 240, MOCK_DEFAULTS.time_min) };
}

const SETTINGS = { shuffle_options: true, show_answers: true, partial_credit: true, pass_percent: 0 };
const ROW_HEADER = ['Түрі', 'Сұрақ мәтіні', 'Нұсқа 1', 'Нұсқа 2', 'Нұсқа 3', 'Нұсқа 4', 'Дұрыс жауап', 'Ұпай', 'Түсініктеме'];

/** The variants as questions of the cabinet model, with stable ids (variant × 100 + place). */
function buildVariants() {
  return VARIANTS.map((v) => {
    const { questions, errors } = rowsToQuestions([ROW_HEADER, ...v.questions.map((x) => x.row)]);
    if (errors.length || questions.length !== v.questions.length) {
      throw new Error(`Сынақ тест ${v.number}-нұсқа: ${errors[0]?.message || 'сұрақ саны сәйкес емес'}`);
    }
    const items = questions.map((q, i) => {
      const id = v.number * 100 + i + 1;
      const { row: _row, ...rest } = q;
      const question = { ...rest, id, options: q.options.map((o, j) => ({ ...o, id: id * 10 + j + 1 })) };
      if (q.type === 'matching') question.data = { pairs: q.data.pairs.map((p, j) => ({ ...p, key: `p${j + 1}` })) };
      if (q.type === 'ordering') question.data = { items: q.data.items.map((it, j) => ({ ...it, key: `e${j + 1}` })) };
      return { q: question, level: v.questions[i].level, period: v.questions[i].period };
    });
    return { number: v.number, items, byId: new Map(items.map((x) => [x.q.id, x])) };
  });
}
let built = null;
export const mockVariants = () => (built ||= buildVariants());
const variantOf = (n) => mockVariants().find((v) => v.number === Number(n));

const countBy = (list, key) => list.reduce((m, x) => ((m[x[key]] = (m[x[key]] || 0) + 1), m), {});
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const maxOf = (items) => items.reduce((s, x) => s + x.q.points, 0);

async function periodList() {
  const snap = await published();
  return snap.periods.slice().sort((a, b) => a.number - b.number).map((p) => ({ number: p.number, title: p.title, slug: p.slug }));
}

/** Grades a variant: A and B right or wrong, C with 2 / 1 / 0 points. Sums per level and period. */
export function gradeVariant(variant, answers, periods = []) {
  const ids = variant.items.map((x) => x.q.id);
  const result = grade({ questions: variant.items.map((x) => x.q) }, ids, answers, SETTINGS);
  for (const it of result.items) {
    const meta = variant.byId.get(it.id);
    it.level = meta.level;
    it.period = meta.period;
    if (meta.level === 'C') {
      const part = it.points ? it.earned / it.points : 0;
      it.earned = it.is_correct ? it.points : part >= 0.5 ? 1 : 0;
    } else it.earned = it.is_correct ? it.points : 0;
  }
  const score = result.items.reduce((s, i) => s + i.earned, 0);
  const max = result.items.reduce((s, i) => s + i.points, 0);
  const sum = (list) => ({
    correct: list.filter((i) => i.is_correct).length,
    total: list.length,
    score: list.reduce((s, i) => s + i.earned, 0),
    max_score: list.reduce((s, i) => s + i.points, 0),
  });
  const titles = new Map(periods.map((p) => [p.number, p]));
  const numbers = [...new Set(result.items.map((i) => i.period))].sort((a, b) => a - b);
  return {
    ...result,
    score,
    max_score: max,
    percent: max ? Math.round((score / max) * 100) : 0,
    by_level: LEVELS.map((l) => ({ level: l, title: LEVEL_TITLES[l], ...sum(result.items.filter((i) => i.level === l)) })),
    by_period: numbers.map((n) => ({
      number: n,
      title: titles.get(n)?.title || PERIOD_NAMES[n] || `${n}-кезең`,
      slug: titles.get(n)?.slug || null,
      ...sum(result.items.filter((i) => i.period === n)),
    })),
  };
}

/** A variant's make-up: questions per level and per period. */
function variantShape(v) {
  return { number: v.number, questions: v.items.length, max_score: maxOf(v.items), levels: countBy(v.items, 'level'), periods: countBy(v.items, 'period') };
}

export async function mockInfo(userId) {
  const settings = await mockSettings();
  const runs = await all(
    'SELECT id, variant, correct, total, score, max_score, by_period, by_level, duration_sec, created_at FROM mock_runs WHERE user_id = ? ORDER BY id DESC LIMIT 50',
    userId,
  );
  const list = runs.map((r) => ({ ...r, by_period: parse(r.by_period, []), by_level: parse(r.by_level, []) }));
  return {
    settings,
    periods: await periodList(),
    variants: mockVariants().map((v) => {
      const mine = list.filter((r) => r.variant === v.number);
      const best = mine.reduce((m, r) => (!m || r.score > m.score ? r : m), null);
      return { ...variantShape(v), tries: mine.length, best: best && { id: best.id, score: best.score, max_score: best.max_score, percent: pct(best.score, best.max_score) } };
    }),
    runs: list,
  };
}

export async function startMock(userId, body) {
  const v = variantOf(body?.variant);
  if (!v) fail(400, 'Сынақ тесттің нұсқасын таңдаңыз.');
  const settings = await mockSettings();
  const nonce = crypto.randomBytes(12).toString('base64url');
  const token = await makeToken({ m: 2, u: userId, v: v.number, s: Date.now(), n: nonce, l: settings.time_min * 60 });
  return {
    token,
    variant: v.number,
    units: v.items.map((x) => ({ ...forStudent(x.q, SETTINGS), level: x.level })),
    question_count: v.items.length,
    max_score: maxOf(v.items),
    time_limit_sec: settings.time_min * 60,
    question_time_sec: 0,
  };
}

export async function submitMock(userId, body) {
  const session = await readToken(body?.token);
  if (!session || session.m !== 2 || session.u !== userId) fail(400, 'Сынақ сессиясы жарамсыз. Сынақты қайта бастаңыз.');
  const v = variantOf(session.v);
  if (!v) fail(400, 'Сынақ тесттің нұсқасы табылмады. Сынақты қайта бастаңыз.');
  const elapsed = Math.max(0, Math.round((Date.now() - session.s) / 1000));
  if (session.l && elapsed > session.l + MOCK_GRACE_SEC) fail(400, 'Сынақ уақыты әлдеқашан аяқталған. Сынақты қайта бастаңыз.');
  const answers = body?.answers && typeof body.answers === 'object' ? body.answers : {};
  const r = gradeVariant(v, answers, await periodList());
  const stored = Object.fromEntries(r.stored.map(({ question, answer }) => [question.id, answer]));
  const already = await get('SELECT id FROM mock_runs WHERE nonce = ?', session.n);
  let id = already?.id;
  if (!id) {
    const res = await run(
      `INSERT INTO mock_runs (user_id, nonce, variant, question_ids, answers, correct, total, score, max_score, by_period, by_level, duration_sec)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(nonce) DO NOTHING`,
      userId, session.n, v.number, JSON.stringify(v.items.map((x) => x.q.id)), JSON.stringify(stored), r.correct, r.total, r.score, r.max_score,
      JSON.stringify(r.by_period), JSON.stringify(r.by_level), Math.min(elapsed, 6 * 3600),
    );
    id = res.lastInsertRowid ? Number(res.lastInsertRowid) : (await get('SELECT id FROM mock_runs WHERE nonce = ?', session.n))?.id;
  }
  return mockResult(userId, id, v.number, r, elapsed);
}

async function mockResult(userId, id, variant, r, duration) {
  const prev = await get(
    'SELECT MAX(score) AS best, COUNT(*) AS n FROM mock_runs WHERE user_id = ? AND id < ? AND variant IS ?',
    userId, id, variant,
  );
  return {
    id,
    variant,
    correct: r.correct,
    total: r.total,
    score: r.score,
    max_score: r.max_score,
    percent: r.percent,
    duration_sec: duration,
    by_period: r.by_period,
    by_level: r.by_level || [],
    previous_best: prev?.n ? prev.best : null,
    items: r.items,
  };
}

export async function mockRun(userId, id) {
  const row = await get('SELECT * FROM mock_runs WHERE id = ? AND user_id = ?', id, userId);
  if (!row) fail(404, 'Сынақ нәтижесі табылмады.');
  const v = variantOf(row.variant);
  // An exam sat before the variants (random questions) keeps only its score.
  const r = v ? gradeVariant(v, parse(row.answers, {}), await periodList()) : { items: [], by_level: [] };
  const saved = { ...r, correct: row.correct, total: row.total, score: row.score, max_score: row.max_score, by_period: parse(row.by_period, []) };
  saved.percent = pct(row.score, row.max_score);
  if (v) saved.by_level = r.by_level;
  return { ...(await mockResult(userId, row.id, row.variant ?? null, saved, row.duration_sec)), created_at: row.created_at };
}

// ─── Карточкалар ──────────────────────────────────────────────────
// Leitner boxes: «Білемін» moves a card one box up and puts its next review further away;
// «Қайталау» sends it back to box 1, to be asked again in this session. Box 4 and up counts as learned.
export const CARD_KINDS = ['date', 'person'];
const BOX_DAYS = [0, 1, 2, 4, 8, 16];
export const LEARNED_BOX = 4;

let seeding = null;
// 'cards_seeded_v2': the set made from the textbooks (each card with its book and page). It takes the
// place of the first set: cards of that set the organizer never edited are removed with their progress;
// cards the organizer added or edited stay. Every statement checks the key, so two cold starts at once
// add the set only once.
const SEED_KEY = 'cards_seeded_v2';
const NOT_SEEDED = `NOT EXISTS (SELECT 1 FROM settings WHERE key = '${SEED_KEY}')`;
const FIRST_SET = `SELECT id FROM fact_cards WHERE source = '' AND updated_at = created_at
  AND created_at = (SELECT MIN(created_at) FROM fact_cards) AND EXISTS (SELECT 1 FROM settings WHERE key = 'cards_seeded')`;

/** Adds the textbook set of cards once. */
export function ensureCards() {
  seeding ||= (async () => {
    if (await get(`SELECT 1 AS ok FROM settings WHERE key = '${FIX_KEY}'`)) return;
    if (await get(`SELECT 1 AS ok FROM settings WHERE key = '${SEED_KEY}'`)) return fixCards();
    const rows = [...DATE_CARDS.map((c) => ['date', ...c]), ...PERSON_CARDS.map((c) => ['person', ...c])];
    await batch([
      [`DELETE FROM card_progress WHERE card_id IN (${FIRST_SET}) AND ${NOT_SEEDED}`],
      [`DELETE FROM fact_cards WHERE id IN (${FIRST_SET}) AND ${NOT_SEEDED}`],
      ...rows.map(([kind, period, front, back, note, source], i) => [
        `INSERT INTO fact_cards (kind, period_number, front, back, note, source, position) SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${NOT_SEEDED}`,
        kind, period, front, back, note, source, i + 1,
      ]),
      ["INSERT INTO settings (key, value) VALUES ('cards_seeded', '1') ON CONFLICT(key) DO NOTHING"],
      [`INSERT INTO settings (key, value) VALUES ('${SEED_KEY}', '1') ON CONFLICT(key) DO NOTHING`],
      // A new database gets the corrected set at once.
      ...FIXES.map(([key]) => [`INSERT INTO settings (key, value) VALUES ('${key}', '1') ON CONFLICT(key) DO NOTHING`]),
    ]);
  })().catch((err) => {
    seeding = null;
    throw err;
  });
  return seeding;
}

// Corrections to the textbook set, applied in order: 'cards_fixed_v3' (Есет Көтібарұлы and others),
// 'cards_fixed_v4' (a short note of textbook facts on every card). Only cards still as they were
// seeded change (an organizer's edit stays); the students' progress on them is kept.
const FIXES = [
  ['cards_fixed_v3', CARD_FIXES_V3],
  ['cards_fixed_v4', CARD_FIXES_V4],
];
const FIX_KEY = FIXES[FIXES.length - 1][0];
async function fixCards() {
  for (const [key, fixes] of FIXES) {
    if (await get('SELECT 1 AS ok FROM settings WHERE key = ?', key)) continue;
    await batch([
      ...fixes.map(([kind, oldFront, oldBack, oldNote, front, back, note, source]) => [
        `UPDATE fact_cards SET front = ?, back = ?, note = ?, source = ?
         WHERE kind = ? AND front = ? AND back = ? AND note = ? AND updated_at = created_at
           AND NOT EXISTS (SELECT 1 FROM settings WHERE key = '${key}')`,
        front, back, note, source, kind, oldFront, oldBack, oldNote,
      ]),
      [`INSERT INTO settings (key, value) VALUES ('${key}', '1') ON CONFLICT(key) DO NOTHING`],
    ]);
  }
}

const cardOut = (c) => ({ id: c.id, kind: c.kind, front: c.front, back: c.back, note: c.note, source: c.source || '', period_number: c.period_number });

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
  const source = s(body?.source, 300);
  if (!front) fail(400, kind === 'date' ? 'Датаны жазыңыз.' : 'Тұлғаның атын жазыңыз.');
  if (!back) fail(400, kind === 'date' ? 'Оқиғаны жазыңыз.' : 'Тұлға кім екенін жазыңыз.');
  const period = body?.period_number === null || body?.period_number === '' ? null : int(body?.period_number, 1, 9, null);
  return { kind, front, back, note, source, period_number: period, published: body?.published === false ? 0 : 1 };
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
  const mock = await get(
    'SELECT COUNT(*) AS n, COUNT(DISTINCT variant) AS variants, MAX(CASE WHEN max_score > 0 THEN score * 1.0 / max_score END) AS best FROM mock_runs WHERE user_id = ?',
    userId,
  );
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
    mockVariants: mock.variants || 0,
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
    ['mock_1', 'ҰБТ-ға қадам', 'Бірінші сынақ тестті тапсыр', 'exam', stats.mocks, 1],
    ['mock_80', 'Жоғары балл', 'Сынақ тесттен 80% және одан жоғары жина', 'exam', Math.round(stats.mockBest * 100), 80],
    ['mock_all', 'Он нұсқа', 'Сынақ тесттің 10 нұсқасының бәрін тапсыр', 'tests', stats.mockVariants, 10],
    ['mock_100', 'Толық балл', 'Сынақ тесттен ең жоғары балл жина', 'crown', Math.round(stats.mockBest * 100), 100],
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
practiceRouter.post('/mock/start', wrap(async (req, res) => res.json(await startMock(req.user.id, req.body))));
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
      'INSERT INTO fact_cards (kind, front, back, note, source, period_number, published, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      c.kind, c.front, c.back, c.note, c.source, c.period_number, c.published, pos,
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
      "UPDATE fact_cards SET kind = ?, front = ?, back = ?, note = ?, source = ?, period_number = ?, published = ?, updated_at = datetime('now') WHERE id = ?",
      c.kind, c.front, c.back, c.note, c.source, c.period_number, c.published, id,
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
    const runs = await all(
      `SELECT m.id, m.variant, m.correct, m.total, m.score, m.max_score, m.duration_sec, m.created_at, u.display_name, u.email
       FROM mock_runs m JOIN users u ON u.id = m.user_id ORDER BY m.id DESC LIMIT 200`,
    );
    const stats = await all(
      'SELECT variant, COUNT(*) AS n, AVG(CASE WHEN max_score > 0 THEN score * 100.0 / max_score END) AS avg FROM mock_runs WHERE variant IS NOT NULL GROUP BY variant',
    );
    const byVariant = new Map(stats.map((r) => [r.variant, r]));
    res.json({
      settings: await mockSettings(),
      defaults: MOCK_DEFAULTS,
      periods: await periodList(),
      variants: mockVariants().map((v) => ({
        ...variantShape(v),
        tries: byVariant.get(v.number)?.n || 0,
        average_percent: byVariant.has(v.number) ? Math.round(byVariant.get(v.number).avg || 0) : null,
      })),
      runs,
    });
  }),
);
/** One variant with its correct answers, for the organizer to read through. */
orgPracticeRouter.get(
  '/mock/variants/:n(\\d+)',
  wrap(async (req, res) => {
    const v = variantOf(req.params.n);
    if (!v) fail(404, 'Нұсқа табылмады.');
    const r = gradeVariant(v, {}, await periodList());
    res.json({ ...variantShape(v), items: r.items.map((it) => ({ ...it, earned: it.points, is_correct: true, answered: true })) });
  }),
);
orgPracticeRouter.put(
  '/mock',
  wrap(async (req, res) => {
    const s = { time_min: int(req.body?.time_min, 10, 240, MOCK_DEFAULTS.time_min), variants: 1 };
    await run("INSERT INTO settings (key, value) VALUES ('mock', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(s));
    res.json({ settings: { time_min: s.time_min } });
  }),
);

orgPracticeRouter.use((err, _req, res, next) => {
  if (!err.status) return next(err);
  res.status(err.status).json({ error: err.message });
});
