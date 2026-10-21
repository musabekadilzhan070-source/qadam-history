import { get, run, transaction } from './db.js';
import { PERIODS } from './seed/content.js';

/**
 * Loads the four periods with their topics and tests into an empty database.
 * Nothing is overwritten: if any period exists, the seed is skipped.
 */
export function seedIfEmpty() {
  if (get('SELECT 1 FROM periods LIMIT 1')) return false;
  transaction(() => {
    PERIODS.forEach((period, pi) => {
      const { lastInsertRowid: periodId } = run(
        'INSERT INTO periods (slug, position, title, range_label, summary) VALUES (?, ?, ?, ?, ?)',
        period.slug,
        pi + 1,
        period.title,
        period.range,
        period.summary,
      );
      period.topics.forEach((topic, ti) => {
        const { lastInsertRowid: topicId } = run(
          `INSERT INTO topics (period_id, slug, position, title, range_label, summary, body, key_points)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          periodId,
          topic.slug,
          ti + 1,
          topic.title,
          topic.range,
          topic.summary,
          topic.body.trim(),
          JSON.stringify(topic.keyPoints),
        );
        topic.questions.forEach((q, qi) => {
          const { lastInsertRowid: questionId } = run(
            'INSERT INTO questions (topic_id, position, text, explanation) VALUES (?, ?, ?, ?)',
            topicId,
            qi + 1,
            q.text,
            q.explanation,
          );
          q.options.forEach((text, oi) => {
            run(
              'INSERT INTO options (question_id, position, text, is_correct) VALUES (?, ?, ?, ?)',
              questionId,
              oi + 1,
              text,
              oi === q.answer ? 1 : 0,
            );
          });
        });
      });
    });
  });
  return true;
}
