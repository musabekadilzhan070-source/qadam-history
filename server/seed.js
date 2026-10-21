import { get, batch } from './db.js';
import { PERIODS } from './seed/content.js';

/**
 * Loads the four periods with their topics and tests into an empty database.
 * Nothing is overwritten: if any period exists, the seed is skipped.
 */
export async function seedIfEmpty() {
  if (await get('SELECT 1 AS ok FROM periods LIMIT 1')) return false;
  // Explicit ids let the whole seed go in one atomic batch.
  const ids = { period: 0, topic: 0, test: 0, question: 0, option: 0 };
  const statements = [];
  PERIODS.forEach((period, pi) => {
    const periodId = ++ids.period;
    statements.push([
      'INSERT INTO periods (id, slug, position, title, range_label, summary) VALUES (?, ?, ?, ?, ?, ?)',
      periodId,
      period.slug,
      pi + 1,
      period.title,
      period.range,
      period.summary,
    ]);
    period.topics.forEach((topic, ti) => {
      const topicId = ++ids.topic;
      statements.push([
        `INSERT INTO topics (id, period_id, slug, position, title, range_label, summary, body, key_points)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        topicId,
        periodId,
        topic.slug,
        ti + 1,
        topic.title,
        topic.range,
        topic.summary,
        topic.body.trim(),
        JSON.stringify(topic.keyPoints),
      ]);
      if (!topic.questions.length) return;
      const testId = ++ids.test;
      statements.push(['INSERT INTO tests (id, topic_id, position, title, published) VALUES (?, ?, 1, ?, 1)', testId, topicId, topic.title]);
      topic.questions.forEach((q, qi) => {
        const questionId = ++ids.question;
        statements.push([
          'INSERT INTO questions (id, topic_id, test_id, position, text, explanation) VALUES (?, ?, ?, ?, ?, ?)',
          questionId,
          topicId,
          testId,
          qi + 1,
          q.text,
          q.explanation,
        ]);
        q.options.forEach((text, oi) => {
          statements.push([
            'INSERT INTO options (id, question_id, position, text, is_correct) VALUES (?, ?, ?, ?, ?)',
            ++ids.option,
            questionId,
            oi + 1,
            text,
            oi === q.answer ? 1 : 0,
          ]);
        });
      });
    });
  });
  try {
    await batch(statements);
  } catch (err) {
    // Another server instance may have seeded at the same moment.
    if (await get('SELECT 1 AS ok FROM periods LIMIT 1')) return false;
    throw err;
  }
  return true;
}
