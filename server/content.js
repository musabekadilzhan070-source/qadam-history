import { all, get } from './db.js';
import { LIVE_BOOK } from './books.js';
import { published } from './publish.js';
import { gradable, settingsOf } from './questions.js';
import { defaultTopicEmblem } from './emblem-defaults.js';
import { liveQuizzes, quizCard, quizProgress } from './quizgame.js';

// Everything here reads the published snapshot, so drafts never reach students.

async function bestByTest(userId) {
  if (!userId) return new Map();
  const rows = await all(
    `SELECT test_id, MAX(CAST(correct AS REAL) / total) AS best, COUNT(*) AS attempts
     FROM attempts WHERE user_id = ? AND test_id IS NOT NULL AND kind = 'test' GROUP BY test_id`,
    userId,
  );
  return new Map(rows.map((r) => [r.test_id, { best: Math.round(r.best * 100), attempts: r.attempts }]));
}

/** Questions a student gets from a test: every gradable question, or the organizer's limit. */
const servedCount = (x) => {
  const all = gradable(x.questions).length;
  const limit = settingsOf(x.settings).question_limit;
  return limit ? Math.min(limit, all) : all;
};

const testCard = (x, best) => {
  const b = best.get(x.id);
  const st = settingsOf(x.settings);
  return {
    id: x.id,
    title: x.title,
    description: x.description || '',
    cover_image_id: x.cover_image_id ?? null,
    grade: x.grade ?? null,
    publisher: x.publisher || '',
    subject: x.subject || '',
    book_year: x.book_year ?? null,
    book_authors: x.book_authors || '',
    book_pages: x.book_pages || '',
    question_count: servedCount(x),
    time_limit_min: st.time_limit_min || (st.question_time_sec ? Math.ceil((st.question_time_sec * servedCount(x)) / 60) : 0),
    best_percent: b ? b.best : null,
    attempts: b ? b.attempts : 0,
  };
};

const topicIcon = (t) => t.icon || defaultTopicEmblem(t.slug);

/** Best result over a topic's tests, for the topic lists. */
function topicProgress(tests, best) {
  const done = tests.map((x) => best.get(x.id)).filter(Boolean);
  return {
    best_percent: done.length ? Math.max(...done.map((d) => d.best)) : null,
    attempts: done.reduce((s, d) => s + d.attempts, 0),
  };
}

function periodStats(snap, period, best, userId) {
  const topics = snap.topics.filter((t) => t.period_id === period.id);
  const ids = new Set(topics.map((t) => t.id));
  const tests = snap.tests.filter((x) => ids.has(x.topic_id));
  return {
    ...period,
    topic_count: topics.length,
    test_count: tests.length,
    question_count: tests.reduce((s, x) => s + servedCount(x), 0),
    tests_done: userId ? tests.filter((x) => best.has(x.id)).length : null,
    quiz_count: liveQuizzes(snap).filter((x) => ids.has(x.topic_id)).length,
  };
}

const topicSummary = (snap, t, best) => {
  const tests = snap.tests.filter((x) => x.topic_id === t.id);
  return {
    id: t.id,
    slug: t.slug,
    title: t.title,
    range_label: t.range_label,
    summary: t.summary,
    image_id: t.image_id,
    icon: topicIcon(t),
    grade: t.grade ?? null,
    publisher: t.publisher || '',
    question_count: tests.reduce((s, x) => s + servedCount(x), 0),
    test_count: tests.length,
    first_test_id: tests[0]?.id ?? null,
    first_quiz_id: liveQuizzes(snap).find((x) => x.topic_id === t.id)?.id ?? null,
    ...topicProgress(tests, best),
  };
};

export async function siteInfo() {
  const snap = await published();
  return { texts: snap.texts, icons: snap.icons };
}

/** Every period with real counts: topics, tests and questions. */
export async function listPeriods(userId) {
  const snap = await published();
  const best = await bestByTest(userId);
  return snap.periods.map((p) => periodStats(snap, p, best, userId));
}

export async function getPeriod(slug, userId) {
  const snap = await published();
  const period = snap.periods.find((p) => p.slug === slug);
  if (!period) return null;
  const best = await bestByTest(userId);
  const progress = await quizProgress(userId);
  const topics = snap.topics.filter((t) => t.period_id === period.id);
  const periodOf = { slug: period.slug, title: period.title, number: period.number };
  return {
    ...periodStats(snap, period, best, userId),
    topics: topics.map((t) => topicSummary(snap, t, best)),
    books: (await periodShelf(snap, period)).map(({ tests, quizzes, ...b }) => ({
      ...b,
      test_count: tests.length,
      tests_done: userId ? tests.filter((x) => best.has(x.id)).length : null,
      quiz_count: quizzes.length,
      quizzes_done: quizzes.filter((x) => progress.get(x.id)?.finished).length,
    })),
    // The period's quizzes in its order, for a period without books.
    quizzes: topics.flatMap((t) => liveQuizzes(snap).filter((x) => x.topic_id === t.id).map((x) => quizCard(x, progress, t, periodOf))),
  };
}

// ─── Books of a period ───────────────────────────────────────────
// The books the organizer put on a period, each with its tests. A book is shown only while it is
// published (cover and PDF complete) and has at least one published test of this period.

const bookView = (b) => ({
  id: b.entry_id,
  book_id: b.id,
  title: b.title,
  grade: b.grade ?? null,
  publisher: b.publisher || '',
  cover_id: b.cover_id,
  cover_version: b.cover_version,
});

async function periodShelf(snap, period) {
  const rows = await all(
    `SELECT pb.id AS entry_id, ${LIVE_BOOK.columns} FROM period_books pb JOIN books b ON b.id = pb.book_id
       LEFT JOIN files c ON c.id = b.cover_id LEFT JOIN files p ON p.id = b.pdf_id
     WHERE pb.period_id = ? AND ${LIVE_BOOK.where} ORDER BY pb.position, pb.id`,
    period.id,
  );
  if (!rows.length) return [];
  const links = await all(
    `SELECT entry_id, test_id, position FROM period_book_tests WHERE entry_id IN (${rows.map(() => '?').join(',')})`,
    ...rows.map((r) => r.entry_id),
  );
  // In the period's own order (topics, then tests), only what students may see.
  const topicIds = new Set(snap.topics.filter((t) => t.period_id === period.id).map((t) => t.id));
  const tests = snap.tests.filter((x) => topicIds.has(x.topic_id));
  const quizzes = liveQuizzes(snap).filter((x) => topicIds.has(x.topic_id));
  return rows
    .map((r) => {
      // The organizer's order in the book first; tests without a place follow in period order.
      const pos = new Map(links.filter((l) => l.entry_id === r.entry_id).map((l) => [l.test_id, l.position || Infinity]));
      const inBook = (list) => {
        const mine = list.filter((x) => pos.has(x.id));
        const at = new Map(mine.map((x, i) => [x.id, i]));
        return mine.sort((a, b) => pos.get(a.id) - pos.get(b.id) || at.get(a.id) - at.get(b.id));
      };
      return { ...bookView(r), tests: inBook(tests), quizzes: inBook(quizzes) };
    })
    .filter((b) => b.tests.length || b.quizzes.length);
}

/** A period's book and its tests (the page a student opens after choosing the book). */
export async function getPeriodBook(slug, entryId, userId) {
  const snap = await published();
  const period = snap.periods.find((p) => p.slug === slug);
  if (!period) return null;
  const shelf = await periodShelf(snap, period);
  const book = shelf.find((b) => b.id === entryId);
  if (!book) return null;
  const best = await bestByTest(userId);
  const progress = await quizProgress(userId);
  const topicOf = new Map(snap.topics.map((t) => [t.id, t]));
  const periodOf = { slug: period.slug, title: period.title, number: period.number };
  return {
    period: { ...periodStats(snap, period, best, userId) },
    book: { ...book, tests: undefined, quizzes: undefined },
    other_books: shelf.filter((b) => b.id !== entryId).map(({ tests, quizzes, ...b }) => ({ ...b, test_count: tests.length, quiz_count: quizzes.length })),
    quizzes: book.quizzes.map((x) => quizCard(x, progress, topicOf.get(x.topic_id), periodOf)),
    tests: book.tests.map((x) => {
      const t = topicOf.get(x.topic_id);
      return {
        ...testCard(x, best),
        slug: t.slug,
        topic_title: t.title,
        topic_icon: topicIcon(t),
        summary: t.summary,
        period_slug: period.slug,
        period_title: period.title,
        period_number: period.number,
      };
    }),
  };
}

/** All published tests in period and topic order. */
export async function listTests(userId) {
  const snap = await published();
  const best = await bestByTest(userId);
  const out = [];
  for (const p of snap.periods) {
    for (const t of snap.topics.filter((tt) => tt.period_id === p.id)) {
      for (const x of snap.tests.filter((xx) => xx.topic_id === t.id)) {
        out.push({
          ...testCard(x, best),
          slug: t.slug,
          topic_title: t.title,
          topic_icon: topicIcon(t),
          summary: t.summary,
          period_slug: p.slug,
          period_title: p.title,
          period_number: p.number,
        });
      }
    }
  }
  return out;
}

/** Every published quiz, in period and topic order, for the «Quiz» page. */
export async function listQuizzes(userId) {
  const snap = await published();
  const progress = await quizProgress(userId);
  const out = [];
  for (const p of snap.periods) {
    const periodOf = { slug: p.slug, title: p.title, number: p.number };
    for (const t of snap.topics.filter((tt) => tt.period_id === p.id)) {
      for (const x of liveQuizzes(snap).filter((xx) => xx.topic_id === t.id)) out.push(quizCard(x, progress, t, periodOf));
    }
  }
  return out;
}

export async function totals() {
  const snap = await published();
  return {
    periods: snap.periods.length,
    topics: snap.topics.length,
    tests: snap.tests.length,
    questions: snap.tests.reduce((s, x) => s + servedCount(x), 0),
  };
}
