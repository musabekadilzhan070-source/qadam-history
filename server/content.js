import { all, get } from './db.js';

const parseJson = (text, fallback) => {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
};

// Reading time from the material's word count, ~130 words a minute.
const readMinutes = (body) => Math.max(1, Math.round(String(body).split(/\s+/).filter(Boolean).length / 130));

const TOPIC_STATS_SQL = `
  SELECT t.id, t.period_id, t.slug, t.position, t.title, t.range_label, t.summary,
         (SELECT COUNT(*) FROM questions q WHERE q.topic_id = t.id) AS question_count
  FROM topics t`;

function bestByTopic(userId) {
  if (!userId) return new Map();
  const rows = all(
    `SELECT topic_id, MAX(CAST(correct AS REAL) / total) AS best, COUNT(*) AS attempts
     FROM attempts WHERE user_id = ? GROUP BY topic_id`,
    userId,
  );
  return new Map(rows.map((r) => [r.topic_id, { best: Math.round(r.best * 100), attempts: r.attempts }]));
}

function withProgress(topic, best) {
  const b = best.get(topic.id);
  return { ...topic, best_percent: b ? b.best : null, attempts: b ? b.attempts : 0 };
}

/** Every period with real counts: topics, tests (topics that have questions) and questions. */
export function listPeriods(userId) {
  const periods = all('SELECT id, slug, position, title, range_label, summary FROM periods ORDER BY position, id');
  const topics = all(`${TOPIC_STATS_SQL} ORDER BY t.position, t.id`);
  const best = bestByTopic(userId);
  return periods.map((p) => {
    const own = topics.filter((t) => t.period_id === p.id);
    const tests = own.filter((t) => t.question_count > 0);
    return {
      ...p,
      number: p.position,
      topic_count: own.length,
      test_count: tests.length,
      question_count: own.reduce((sum, t) => sum + t.question_count, 0),
      tests_done: userId ? tests.filter((t) => best.has(t.id)).length : null,
    };
  });
}

export function getPeriod(slug, userId) {
  const period = listPeriods(userId).find((p) => p.slug === slug);
  if (!period) return null;
  const best = bestByTopic(userId);
  const topics = all(`${TOPIC_STATS_SQL} WHERE t.period_id = ? ORDER BY t.position, t.id`, period.id).map((t) =>
    withProgress(t, best),
  );
  return { ...period, topics };
}

export function getTopic(slug, userId) {
  const topic = get(
    `SELECT t.*, p.slug AS period_slug, p.title AS period_title, p.position AS period_number,
            (SELECT COUNT(*) FROM questions q WHERE q.topic_id = t.id) AS question_count
     FROM topics t JOIN periods p ON p.id = t.period_id WHERE t.slug = ?`,
    slug,
  );
  if (!topic) return null;
  const siblings = all('SELECT slug, title FROM topics WHERE period_id = ? ORDER BY position, id', topic.period_id);
  const i = siblings.findIndex((s) => s.slug === slug);
  const best = bestByTopic(userId);
  const { body, key_points, ...rest } = topic;
  return {
    ...withProgress(rest, best),
    body,
    key_points: parseJson(key_points, []),
    read_minutes: readMinutes(body),
    prev: siblings[i - 1] || null,
    next: siblings[i + 1] || null,
  };
}

/** All tests (one per topic with questions), grouped by period order. */
export function listTests(userId) {
  const best = bestByTopic(userId);
  return all(
    `SELECT t.id, t.slug, t.title, t.range_label, t.summary,
            p.slug AS period_slug, p.title AS period_title, p.position AS period_number,
            (SELECT COUNT(*) FROM questions q WHERE q.topic_id = t.id) AS question_count
     FROM topics t JOIN periods p ON p.id = t.period_id
     ORDER BY p.position, t.position, t.id`,
  )
    .filter((t) => t.question_count > 0)
    .map((t) => withProgress(t, best));
}

/** Reading list: every topic's summary, key facts and reading time. */
export function listMaterials() {
  return all(
    `SELECT t.slug, t.title, t.range_label, t.summary, t.body, t.key_points,
            p.slug AS period_slug, p.title AS period_title, p.position AS period_number
     FROM topics t JOIN periods p ON p.id = t.period_id ORDER BY p.position, t.position, t.id`,
  ).map(({ body, key_points, ...t }) => ({ ...t, read_minutes: readMinutes(body), key_points: parseJson(key_points, []) }));
}

export function totals() {
  return get(
    `SELECT (SELECT COUNT(*) FROM periods) AS periods,
            (SELECT COUNT(*) FROM topics) AS topics,
            (SELECT COUNT(DISTINCT topic_id) FROM questions) AS tests,
            (SELECT COUNT(*) FROM questions) AS questions`,
  );
}
