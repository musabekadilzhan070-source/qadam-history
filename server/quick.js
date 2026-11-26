import express from 'express';
import { published } from './publish.js';

// «Жылдам тест»: ten questions of a test shown one by one, as in a short video. A countdown runs,
// then the answer and a line from the textbook appear; the student counts the answers they knew.
// Only single-answer questions with a short answer and no picture are used: they read well aloud.

export const QUICK_SIZE = 10;
const PLAN = { A: 3, B: 4, C: 3 };
const MAX_ANSWER = 90;

const WHY = /неге|себеб|маңыз|салдар|мақсат|ерекшел|нәтиже|ықпал|рөл|қалай әсер|не үшін|түсіндір/i;
const FACT = /қай жылы|қашан|кім |кім\?|кімнің|қай қала|қай жерде|қай өзен|қанша|неше|аталды|атауы/i;

/** A, B or C: facts to recall, a fact to understand, a reason or a consequence. */
export function quickLevel(q, answer) {
  if (WHY.test(q.text)) return 'C';
  if (FACT.test(q.text) || /^\d{3,4}/.test(answer)) return 'A';
  return 'B';
}

/** The explanation without its book reference, cut to its first sentence or two. */
export function quickNote(explanation, answer, question = '') {
  let s = String(explanation || '').replace(/\s*Қазақстан тарихы,[^]*$/u, '').replace(/\s*Оқулықтағы тест:[^]*$/u, '').trim();
  if (!s) return '';
  const sentences = s.match(/[^.!?]+[.!?]?/gu) || [s];
  let note = sentences[0].trim();
  if (note.length < 60 && sentences[1]) note += ' ' + sentences[1].trim();
  if (note.length > 170) note = note.slice(0, 167).replace(/\s+\S*$/u, '') + '…';
  // A note that only repeats the answer adds nothing.
  const plain = (x) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  if (plain(note) === plain(answer)) return '';
  // Nor does one that only says the question back with the answer in it.
  const stem = (w) => w.slice(0, 5);
  const seen = new Set(`${question} ${answer}`.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(stem));
  const fresh = note.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3 && !seen.has(stem(w)));
  return fresh.length < 3 ? '' : note;
}

const bookOf = (explanation) => (String(explanation || '').match(/Қазақстан тарихы,[^]*$/u)?.[0] || '').replace(/\.$/, '');

function candidates(test) {
  const out = [];
  const walk = (qs) => {
    for (const q of qs || []) {
      if (q.type === 'context') walk(q.children);
      if (q.type !== 'single' || q.image_id) continue;
      const right = (q.options || []).filter((o) => o.is_correct);
      if (right.length !== 1 || right[0].image_id) continue;
      const answer = String(right[0].text || '').trim();
      if (!answer || answer.length > MAX_ANSWER || /барлығы|жоғарыдағы|дұрыс жауап жоқ/i.test(answer)) continue;
      out.push({ id: q.id, text: q.text, answer, level: quickLevel(q, answer), note: quickNote(q.explanation, answer, q.text), source: bookOf(q.explanation) });
    }
  };
  walk(test.questions);
  return out;
}

const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/** Ten questions, A then B then C; a level short of questions is filled from the others. */
export function pickQuick(pool, size = QUICK_SIZE) {
  const by = { A: [], B: [], C: [] };
  for (const q of shuffle([...pool])) by[q.level].push(q);
  const picked = { A: [], B: [], C: [] };
  for (const lv of ['A', 'B', 'C']) picked[lv] = by[lv].splice(0, PLAN[lv]);
  let missing = size - picked.A.length - picked.B.length - picked.C.length;
  for (const lv of ['B', 'A', 'C']) {
    while (missing > 0 && by[lv].length) {
      picked[lv].push(by[lv].shift());
      missing--;
    }
  }
  return [...picked.A, ...picked.B, ...picked.C];
}

export async function quickTest(testId) {
  const snap = await published();
  const test = snap.tests.find((x) => x.id === testId);
  if (!test) return null;
  const topic = snap.topics.find((t) => t.id === test.topic_id);
  const period = snap.periods.find((p) => p.id === topic.period_id);
  // «7-тақырып»: the place of the test among the tests of the same book (grade and publisher) in the period.
  const sameBook = (x) => (x.grade ?? null) === (test.grade ?? null) && (x.publisher || '') === (test.publisher || '');
  const periodTests = [];
  for (const t of snap.topics.filter((tt) => tt.period_id === period.id)) {
    for (const x of snap.tests.filter((xx) => xx.topic_id === t.id && sameBook(xx))) periodTests.push(x.id);
  }
  // The next test with enough questions, in the order of the tests page.
  const order = [];
  for (const p of snap.periods.slice().sort((a, b) => a.number - b.number)) {
    for (const t of snap.topics.filter((tt) => tt.period_id === p.id).sort((a, b) => a.position - b.position || a.id - b.id)) {
      for (const x of snap.tests.filter((xx) => xx.topic_id === t.id)) order.push({ x, t });
    }
  }
  const at = order.findIndex((o) => o.x.id === test.id);
  const next = order.slice(at + 1).find((o) => candidates(o.x).length >= 5);
  return {
    test: { id: test.id, title: test.title },
    topic: { title: topic.title, number: periodTests.indexOf(test.id) + 1 },
    period: { title: period.title, number: period.number },
    questions: pickQuick(candidates(test)).map(({ id, ...q }) => q),
    next: next ? { id: next.x.id, title: next.t.title } : null,
  };
}

export const quickRouter = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

quickRouter.get(
  '/:id(\\d+)',
  wrap(async (req, res) => {
    const data = await quickTest(Number(req.params.id));
    if (!data) return res.status(404).json({ error: 'Тест табылмады.' });
    res.json(data);
  }),
);
