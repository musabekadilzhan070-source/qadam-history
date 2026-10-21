import { all } from './db.js';
import { published } from './publish.js';

// Everything here reads the published snapshot, so drafts never reach students.

// Reading time from the material's word count, ~130 words a minute.
const readMinutes = (body) => Math.max(1, Math.round(String(body).split(/\s+/).filter(Boolean).length / 130));

async function bestByTest(userId) {
  if (!userId) return new Map();
  const rows = await all(
    `SELECT test_id, MAX(CAST(correct AS REAL) / total) AS best, COUNT(*) AS attempts
     FROM attempts WHERE user_id = ? AND test_id IS NOT NULL GROUP BY test_id`,
    userId,
  );
  return new Map(rows.map((r) => [r.test_id, { best: Math.round(r.best * 100), attempts: r.attempts }]));
}

const testCard = (x, best) => {
  const b = best.get(x.id);
  return { id: x.id, title: x.title, question_count: x.questions.length, best_percent: b ? b.best : null, attempts: b ? b.attempts : 0 };
};

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
    question_count: tests.reduce((s, x) => s + x.questions.length, 0),
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
    icon: t.icon,
    question_count: tests.reduce((s, x) => s + x.questions.length, 0),
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

export async function getTopic(slug, userId) {
  const snap = await published();
  const topic = snap.topics.find((t) => t.slug === slug);
  if (!topic) return null;
  const period = snap.periods.find((p) => p.id === topic.period_id);
  const siblings = snap.topics.filter((t) => t.period_id === topic.period_id);
  const i = siblings.findIndex((t) => t.id === topic.id);
  const best = await bestByTest(userId);
  const tests = snap.tests.filter((x) => x.topic_id === topic.id);
  return {
    ...topicSummary(snap, topic, best),
    body: topic.body,
    key_points: topic.key_points,
    read_minutes: readMinutes(topic.body),
    period_slug: period.slug,
    period_title: period.title,
    period_number: period.number,
    tests: tests.map((x) => testCard(x, best)),
    materials: snap.materials.filter((m) => m.topic_id === topic.id),
    persons: snap.persons.filter((p) => p.topic_id === topic.id),
    prev: siblings[i - 1] ? { slug: siblings[i - 1].slug, title: siblings[i - 1].title } : null,
    next: siblings[i + 1] ? { slug: siblings[i + 1].slug, title: siblings[i + 1].title } : null,
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

/** Reading list: every topic's summary, key facts and reading time, plus extra materials. */
export async function listMaterials() {
  const snap = await published();
  const materials = [];
  for (const p of snap.periods) {
    for (const t of snap.topics.filter((tt) => tt.period_id === p.id)) {
      materials.push({
        slug: t.slug,
        title: t.title,
        range_label: t.range_label,
        summary: t.summary,
        key_points: t.key_points,
        read_minutes: readMinutes(t.body),
        period_slug: p.slug,
        period_title: p.title,
        period_number: p.number,
        extras: snap.materials.filter((m) => m.topic_id === t.id).map(({ body, ...m }) => ({ ...m, read_minutes: readMinutes(body) })),
      });
    }
  }
  const general = snap.materials.filter((m) => m.topic_id === null).map(({ body, ...m }) => ({ ...m, read_minutes: readMinutes(body) }));
  return { materials, general };
}

export async function getMaterial(id) {
  const snap = await published();
  const m = snap.materials.find((x) => x.id === id);
  if (!m) return null;
  const topic = snap.topics.find((t) => t.id === m.topic_id) || null;
  return { ...m, read_minutes: readMinutes(m.body), topic: topic && { slug: topic.slug, title: topic.title } };
}

export async function totals() {
  const snap = await published();
  return {
    periods: snap.periods.length,
    topics: snap.topics.length,
    tests: snap.tests.length,
    questions: snap.tests.reduce((s, x) => s + x.questions.length, 0),
  };
}
