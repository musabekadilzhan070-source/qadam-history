import { all, get, batch } from './db.js';

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function loadQuestions(topicId) {
  const questions = await all('SELECT id, text, explanation FROM questions WHERE topic_id = ? ORDER BY position, id', topicId);
  const options = await all(
    `SELECT o.id, o.question_id, o.text, o.is_correct FROM options o
     JOIN questions q ON q.id = o.question_id WHERE q.topic_id = ? ORDER BY o.position, o.id`,
    topicId,
  );
  return questions.map((q) => ({ ...q, options: options.filter((o) => o.question_id === q.id) }));
}

/** Questions for the student. Correct answers never leave the server before grading. */
export async function testForStudent(topicId) {
  return (await loadQuestions(topicId)).map((q) => ({
    id: q.id,
    text: q.text,
    options: shuffle(q.options).map((o) => ({ id: o.id, text: o.text })),
  }));
}

function review(questions, chosenById) {
  return questions.map((q) => {
    const chosen = chosenById.get(q.id) ?? null;
    const right = q.options.find((o) => o.is_correct);
    return {
      id: q.id,
      text: q.text,
      explanation: q.explanation,
      options: q.options.map((o) => ({ id: o.id, text: o.text })),
      chosen_option_id: chosen,
      correct_option_id: right ? right.id : null,
      is_correct: Boolean(right && chosen === right.id),
    };
  });
}

/**
 * Grades answers ({questionId: optionId}) against the stored correct options.
 * For a signed-in student the attempt and each answer are saved.
 */
export async function gradeTest(topicId, answers, { userId, durationSec }) {
  const questions = await loadQuestions(topicId);
  const chosen = new Map();
  for (const q of questions) {
    const raw = answers?.[q.id] ?? answers?.[String(q.id)];
    const optionId = Number(raw);
    if (q.options.some((o) => o.id === optionId)) chosen.set(q.id, optionId);
  }
  const items = review(questions, chosen);
  const correct = items.filter((i) => i.is_correct).length;
  const total = items.length;
  let attemptId = null;
  if (userId && total > 0) {
    // One write transaction: the attempt row, then its answers keyed to that row.
    const duration = Math.max(0, Math.min(Math.round(Number(durationSec) || 0), 6 * 60 * 60));
    const latest = '(SELECT MAX(id) FROM attempts WHERE user_id = ?)';
    const [inserted] = await batch([
      ['INSERT INTO attempts (user_id, topic_id, correct, total, duration_sec) VALUES (?, ?, ?, ?, ?)', userId, topicId, correct, total, duration],
      ...items.map((i) => [
        `INSERT INTO attempt_answers (attempt_id, question_id, option_id, is_correct) VALUES (${latest}, ?, ?, ?)`,
        userId,
        i.id,
        i.chosen_option_id,
        i.is_correct ? 1 : 0,
      ]),
    ]);
    attemptId = inserted.lastInsertRowid;
  }
  return { attempt_id: attemptId, correct, total, percent: total ? Math.round((correct / total) * 100) : 0, items };
}

const ATTEMPT_SQL = `
  SELECT a.id, a.correct, a.total, a.duration_sec, a.created_at,
         t.slug AS topic_slug, t.title AS topic_title,
         p.slug AS period_slug, p.title AS period_title, p.position AS period_number
  FROM attempts a JOIN topics t ON t.id = a.topic_id JOIN periods p ON p.id = t.period_id`;

const withPercent = (a) => ({ ...a, percent: a.total ? Math.round((a.correct / a.total) * 100) : 0 });

export async function userResults(userId) {
  const attempts = (await all(`${ATTEMPT_SQL} WHERE a.user_id = ? ORDER BY a.created_at DESC, a.id DESC`, userId)).map(
    withPercent,
  );
  const summary = await get(
    `SELECT COUNT(*) AS attempts, COUNT(DISTINCT topic_id) AS tests_done,
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

/** One saved attempt with the student's answers, visible only to its owner. */
export async function attemptDetail(userId, attemptId) {
  const attempt = await get(`${ATTEMPT_SQL} WHERE a.id = ? AND a.user_id = ?`, attemptId, userId);
  if (!attempt) return null;
  const topic = await get('SELECT topic_id FROM attempts WHERE id = ?', attemptId);
  const chosen = new Map(
    (await all('SELECT question_id, option_id FROM attempt_answers WHERE attempt_id = ?', attemptId)).map((r) => [
      r.question_id,
      r.option_id,
    ]),
  );
  const answered = (await loadQuestions(topic.topic_id)).filter((q) => chosen.has(q.id));
  return { ...withPercent(attempt), items: review(answered, chosen) };
}
