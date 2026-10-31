import { all } from './db.js';
import { published } from './publish.js';
import { gradable, settingsOf } from './questions.js';
import { defaultTopicEmblem } from './emblem-defaults.js';

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
    question_count: tests.reduce((s, x) => s + servedCount(x), 0),
    test_count: tests.length,
    first_test_id: tests[0]?.id ?? null,
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
  return {
    ...periodStats(snap, period, best, userId),
    topics: snap.topics.filter((t) => t.period_id === period.id).map((t) => topicSummary(snap, t, best)),
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

export async function totals() {
  const snap = await published();
  return {
    periods: snap.periods.length,
    topics: snap.topics.length,
    tests: snap.tests.length,
    questions: snap.tests.reduce((s, x) => s + servedCount(x), 0),
  };
}
