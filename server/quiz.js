import { all, get, batch } from './db.js';
import { published } from './publish.js';

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const isMultiple = (q) => q.options.filter((o) => o.is_correct).length > 1;

/** A published test with its topic, or null. */
export async function findTest(testId) {
  const snap = await published();
  const test = snap.tests.find((x) => x.id === testId);
  if (!test) return null;
  const topic = snap.topics.find((t) => t.id === test.topic_id);
  return { test, topic: { id: topic.id, slug: topic.slug, title: topic.title } };
}

/** First published test of a topic (old /topics/:slug/test links). */
export async function firstTestOfTopic(slug) {
  const snap = await published();
  const topic = snap.topics.find((t) => t.slug === slug);
  return topic ? snap.tests.find((x) => x.topic_id === topic.id)?.id ?? null : null;
}

/** Questions for the student. Correct answers never leave the server before grading. */
export function testForStudent(test) {
  return test.questions.map((q) => ({
    id: q.id,
    text: q.text,
    image_id: q.image_id,
    multiple: isMultiple(q),
    options: shuffle(q.options).map((o) => ({ id: o.id, text: o.text, image_id: o.image_id })),
  }));
}

function review(questions, chosenById) {
  return questions.map((q) => {
    const chosen = chosenById.get(q.id) || [];
    const right = q.options.filter((o) => o.is_correct).map((o) => o.id);
    const isCorrect = right.length > 0 && chosen.length === right.length && right.every((id) => chosen.includes(id));
    return {
      id: q.id,
      text: q.text,
      image_id: q.image_id ?? null,
      explanation: q.explanation,
      multiple: right.length > 1,
      options: q.options.map((o) => ({ id: o.id, text: o.text, image_id: o.image_id ?? null })),
      chosen_option_ids: chosen,
      correct_option_ids: right,
      is_correct: isCorrect,
    };
  });
}

/**
 * Grades answers ({questionId: optionId | optionId[]}) against the stored correct options.
 * For a signed-in student the attempt and each answer are saved.
 */
export async function gradeTest(test, answers, { userId, durationSec }) {
  const chosen = new Map();
  for (const q of test.questions) {
    const raw = answers?.[q.id] ?? answers?.[String(q.id)];
    const ids = [...new Set([].concat(raw ?? []).map(Number))].filter((id) => q.options.some((o) => o.id === id));
    if (ids.length) chosen.set(q.id, ids.sort((a, b) => a - b));
  }
  const items = review(test.questions, chosen);
  const correct = items.filter((i) => i.is_correct).length;
  const total = items.length;
  let attemptId = null;
  if (userId && total > 0) {
    // One write transaction: the attempt row, then its answers keyed to that row.
    const duration = Math.max(0, Math.min(Math.round(Number(durationSec) || 0), 6 * 60 * 60));
    const latest = '(SELECT MAX(id) FROM attempts WHERE user_id = ?)';
    const [inserted] = await batch([
      [
        'INSERT INTO attempts (user_id, topic_id, test_id, correct, total, duration_sec) VALUES (?, ?, ?, ?, ?, ?)',
        userId,
        test.topic_id,
        test.id,
        correct,
        total,
        duration,
      ],
      ...items.map((i) => [
        `INSERT INTO attempt_answers (attempt_id, question_id, option_id, option_ids, is_correct) VALUES (${latest}, ?, ?, ?, ?)`,
        userId,
        i.id,
        i.chosen_option_ids[0] ?? null,
        JSON.stringify(i.chosen_option_ids),
        i.is_correct ? 1 : 0,
      ]),
    ]);
    attemptId = inserted.lastInsertRowid;
  }
  return { attempt_id: attemptId, correct, total, percent: total ? Math.round((correct / total) * 100) : 0, items };
}

// Titles come from the draft tables so results stay readable after a test is hidden;
// LEFT JOINs keep an attempt even if its test or topic was deleted.
const ATTEMPT_SQL = `
  SELECT a.id, a.test_id, a.correct, a.total, a.duration_sec, a.created_at,
         x.title AS test_title,
         t.slug AS topic_slug, COALESCE(t.title, x.title, 'Өшірілген тест') AS topic_title,
         p.slug AS period_slug, COALESCE(p.title, '') AS period_title, COALESCE(p.position, 0) AS period_number
  FROM attempts a
  LEFT JOIN tests x ON x.id = a.test_id
  LEFT JOIN topics t ON t.id = COALESCE(x.topic_id, a.topic_id)
  LEFT JOIN periods p ON p.id = t.period_id`;

const withPercent = (a) => ({ ...a, percent: a.total ? Math.round((a.correct / a.total) * 100) : 0 });

export async function userResults(userId) {
  const attempts = (await all(`${ATTEMPT_SQL} WHERE a.user_id = ? ORDER BY a.created_at DESC, a.id DESC`, userId)).map(
    withPercent,
  );
  const summary = await get(
    `SELECT COUNT(*) AS attempts, COUNT(DISTINCT COALESCE(test_id, -topic_id)) AS tests_done,
            COALESCE(SUM(correct), 0) AS correct, COALESCE(SUM(total), 0) AS answered
     FROM attempts WHERE user_id = ?`,
    userId,
  );
  return {
    summary: {
      ...summary,
      average_percent: summary.answered ? Math.round((summary.correct / summary.answered) * 100) : null,
    },
    attempts,
  };
}

async function draftQuestions(testId) {
  const questions = await all('SELECT id, text, explanation, image_id FROM questions WHERE test_id = ? ORDER BY position, id', testId);
  const options = await all(
    `SELECT o.id, o.question_id, o.text, o.image_id, o.is_correct FROM options o
     JOIN questions q ON q.id = o.question_id WHERE q.test_id = ? ORDER BY o.position, o.id`,
    testId,
  );
  return questions.map((q) => ({ ...q, options: options.filter((o) => o.question_id === q.id) }));
}

/** One saved attempt with the student's answers, visible only to its owner. */
export async function attemptDetail(userId, attemptId) {
  const attempt = await get(`${ATTEMPT_SQL} WHERE a.id = ? AND a.user_id = ?`, attemptId, userId);
  if (!attempt) return null;
  const rows = await all('SELECT question_id, option_id, option_ids FROM attempt_answers WHERE attempt_id = ?', attemptId);
  const chosen = new Map(
    rows.map((r) => {
      let ids = [];
      try {
        ids = JSON.parse(r.option_ids || 'null') ?? (r.option_id ? [r.option_id] : []);
      } catch {
        ids = r.option_id ? [r.option_id] : [];
      }
      return [r.question_id, ids];
    }),
  );
  const fromSnapshot = (await published()).tests.find((x) => x.id === attempt.test_id)?.questions;
  const questions = fromSnapshot || (attempt.test_id ? await draftQuestions(attempt.test_id) : []);
  const answered = questions.filter((q) => chosen.has(q.id));
  return { ...withPercent(attempt), items: review(answered, chosen) };
}
