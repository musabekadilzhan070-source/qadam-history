import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qadam-quiz-'));
process.env.DB_FILE = path.join(tmp, 'test.sqlite');
// Test-only PIN; the real one is set as an environment variable on the server.
process.env.ORGANIZER_PIN = '908172';
delete process.env.TURSO_DATABASE_URL;
const { app, whenReady } = await import('../server/app.js');
await whenReady();

let server;
let base;
before(async () => {
  server = app.listen(0);
  server.keepAliveTimeout = 120_000;
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function client() {
  let cookie = '';
  return async (method, url, body) => {
    const headers = { 'Content-Type': 'application/json' };
    if (method !== 'GET') headers['X-Qadam'] = '1';
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
}

async function student() {
  const call = client();
  const email = `q${Math.random().toString(36).slice(2, 8)}@mail.kz`;
  const reg = await call('POST', '/api/auth/register', { display_name: 'Оқушы', email, password: 'secret9', password_confirm: 'secret9' });
  assert.equal(reg.status, 201);
  return call;
}

async function organizer() {
  const call = client();
  assert.equal((await call('POST', '/api/org/login', { pin: '908172' })).status, 200);
  return call;
}

/** A classic test with every question format. */
const ALL_FORMATS = (topicId) => ({
  topic_id: topicId,
  title: 'Қазақ хандығы',
  grade: 8,
  publisher: 'Атамұра',
  questions: [
    { type: 'single', text: 'Хандықтың негізін салушылар?', explanation: 'Керей мен Жәнібек.', options: [{ text: 'Керей мен Жәнібек', is_correct: true }, { text: 'Есім мен Тәуке' }, { text: 'Абылай' }] },
    { type: 'multiple', text: 'Ханды белгілеңдер', options: [{ text: 'Қасым', is_correct: true }, { text: 'Тәуке', is_correct: true }, { text: 'Кенесары' }, { text: 'Наполеон' }] },
    { type: 'matching', text: 'Сәйкестендір', data: { pairs: [{ left: 'Қасым', right: 'Қасқа жолы' }, { left: 'Есім', right: 'Ескі жолы' }, { left: 'Тәуке', right: 'Жеті жарғы' }] } },
    { type: 'ordering', text: 'Ретке қой', data: { items: [{ text: 'Хандықтың құрылуы', date: '1465' }, { text: 'Жеті жарғы', date: '1680' }, { text: 'Аңырақай', date: '1730' }] } },
    { type: 'open', text: 'Хандық құрылған жыл?', data: { answers: ['1465'] } },
    {
      type: 'context',
      text: 'Деректі оқы',
      data: { body: 'Мәтін...' },
      children: [
        { type: 'single', text: 'Мәтін қай ғасыр туралы?', options: [{ text: 'XV', is_correct: true }, { text: 'XIX' }] },
        { type: 'single', text: 'Мәтінде кім аталады?', options: [{ text: 'Керей', is_correct: true }, { text: 'Абай' }] },
      ],
    },
  ],
});

let org;
let classic;
let quizId;

test('every classic test gets one quiz copy: same questions, answers, contexts, class, textbook and books', async () => {
  org = await organizer();
  const state = (await org('GET', '/api/org/state')).body;
  const topic = state.topics[0];
  const made = await org('POST', '/api/org/tests', ALL_FORMATS(topic.id));
  assert.equal(made.status, 201, JSON.stringify(made.body));
  classic = made.body;
  assert.equal((await org('POST', `/api/org/tests/${classic.id}/publish`)).status, 200);

  const before = (await org('GET', '/api/org/state')).body;
  const classicCount = before.tests.length;
  assert.ok(classicCount > 1);
  assert.equal(before.quizzes.length, 0);
  assert.equal((await org('GET', '/api/org/quizzes/copy')).body.pending, before.tests.filter((x) => x.topic_id).length);

  const copy = await org('POST', '/api/org/quizzes/copy');
  assert.equal(copy.status, 200, JSON.stringify(copy.body));
  assert.equal(copy.body.copied, before.tests.filter((x) => x.topic_id).length);
  assert.deepEqual(copy.body.mismatches, []);
  assert.ok(copy.body.backup_id > 0);

  const after = (await org('GET', '/api/org/state')).body;
  assert.equal(after.tests.length, classicCount, 'the classic tests stay as they were');
  assert.equal(after.quizzes.length, copy.body.copied);
  for (const q of after.quizzes) {
    const src = after.tests.find((x) => x.id === q.source_test_id);
    assert.ok(src, 'each quiz points at its classic test');
    assert.equal(q.title, `${src.title} (QUIZ)`);
    assert.equal(q.topic_id, src.topic_id);
    assert.equal(q.grade, src.grade);
    assert.equal(q.publisher, src.publisher);
    assert.equal(q.question_count, src.question_count);
    assert.equal(q.format, 'quiz');
    assert.match(q.share_id, /^[0-9a-f]{16}$/, 'a quiz has its own link, like a classic test');
    assert.notEqual(q.share_id, src.share_id);
  }
  const quiz = after.quizzes.find((x) => x.source_test_id === classic.id);
  quizId = quiz.id;
  assert.equal(quiz.live, true, 'the copy of a live test is live');

  // Question by question: text, options with the correct ones, pairs, chronology, contexts.
  const a = (await org('GET', `/api/org/tests/${classic.id}`)).body;
  const b = (await org('GET', `/api/org/tests/${quizId}`)).body;
  const shape = (t) =>
    t.questions.map((q) => ({
      type: q.type,
      text: q.text,
      explanation: q.explanation,
      points: q.points,
      data: q.data,
      options: q.options.map((o) => [o.text, o.is_correct, o.image_id]),
      children: q.children?.map((c) => ({ type: c.type, text: c.text, options: c.options.map((o) => [o.text, o.is_correct]) })),
    }));
  assert.deepEqual(shape(b), shape(a));
  assert.ok(b.questions.every((q) => !a.questions.some((x) => x.id === q.id)), 'the copy has its own rows');

  // Running the copy again makes nothing new.
  const again = await org('POST', '/api/org/quizzes/copy');
  assert.equal(again.body.copied, 0);
  assert.equal((await org('GET', '/api/org/state')).body.quizzes.length, after.quizzes.length);
});

test('a deleted quiz copy is not made again, and editing the classic test leaves the quiz as it was', async () => {
  const state = (await org('GET', '/api/org/state')).body;
  const other = state.quizzes.find((x) => x.id !== quizId);
  assert.equal((await org('DELETE', `/api/org/tests/${other.id}`)).status, 200);
  assert.equal((await org('POST', '/api/org/quizzes/copy')).body.copied, 0);

  const a = (await org('GET', `/api/org/tests/${classic.id}`)).body;
  a.questions[0].text = 'Өзгертілген сұрақ';
  assert.equal((await org('PUT', `/api/org/tests/${classic.id}`, a)).status, 200);
  const b = (await org('GET', `/api/org/tests/${quizId}`)).body;
  assert.equal(b.questions[0].text, 'Хандықтың негізін салушылар?');
});

test('students see quizzes apart from the classic tests', async () => {
  const call = await student();
  const overview = (await call('GET', '/api/overview')).body;
  assert.ok(overview.tests.every((t) => !/\(QUIZ\)$/.test(t.title)), 'the classic list has no quiz');
  const state = (await org('GET', '/api/org/state')).body;
  const topic = state.topics.find((t) => t.id === classic.topic_id);
  const period = state.periods.find((p) => p.id === topic.period_id);
  const page = (await call('GET', `/api/periods/${period.slug}`)).body;
  assert.ok(page.quiz_count >= 1);
  assert.ok(page.quizzes.some((q) => q.id === quizId && q.format === 'quiz'));
  assert.equal((await call('GET', `/api/tests/${quizId}`)).status, 404, 'a quiz does not open as a classic test');
  assert.equal((await call('GET', `/api/quizzes/${classic.id}`)).status, 404, 'a classic test does not open as a quiz');
});

/** The right answer to a question as the student got it (looked up in the organizer's copy). */
function rightAnswer(q, full) {
  const flat = full.questions.flatMap((x) => (x.type === 'context' ? x.children : [x]));
  const src = flat.find((x) => x.id === q.id);
  if (['single', 'multiple', 'image'].includes(src.type)) return src.options.filter((o) => o.is_correct).map((o) => o.id);
  if (src.type === 'matching') return Object.fromEntries(src.data.pairs.map((p) => [p.key, p.key]));
  if (src.type === 'ordering') return src.data.items.map((i) => i.key);
  if (src.type === 'open') return src.data.answers[0];
  throw new Error(src.type);
}
function wrongAnswer(q, full) {
  const flat = full.questions.flatMap((x) => (x.type === 'context' ? x.children : [x]));
  const src = flat.find((x) => x.id === q.id);
  if (src.type === 'multiple') return [src.options.find((o) => o.is_correct).id]; // only one of the two right ones
  if (['single', 'image'].includes(src.type)) return [src.options.find((o) => !o.is_correct).id];
  if (src.type === 'matching') {
    const keys = src.data.pairs.map((p) => p.key);
    return Object.fromEntries(keys.map((k, i) => [k, keys[(i + 1) % keys.length]]));
  }
  if (src.type === 'ordering') return [...src.data.items.map((i) => i.key)].reverse();
  if (src.type === 'open') return '1999';
  throw new Error(src.type);
}

test('a quiz ends only when every question is answered correctly; wrong ones come back at the end, in order', async () => {
  const call = await student();
  const full = (await org('GET', `/api/org/tests/${quizId}`)).body;
  const page = (await call('GET', `/api/quizzes/${quizId}`)).body;
  assert.equal(page.run, null);
  assert.equal(page.quiz.question_count, 7);
  let s = (await call('POST', `/api/quizzes/${quizId}/start`)).body;
  assert.equal(s.total, 7);
  assert.equal(s.phase, 'main');
  assert.equal(s.number, 1);
  assert.ok(!('options' in s.question && s.question.options.some((o) => 'is_correct' in o)), 'no answers are handed out');

  const order = [];
  // First pass: wrong on the 2nd (multiple, half right) and the 4th (ordering), right on the rest.
  for (let i = 0; i < 7; i += 1) {
    order.push(s.question.id);
    const wrong = i === 1 || i === 3;
    const r = await call('POST', `/api/quizzes/runs/${s.run_id}/answer`, { question_id: s.question.id, version: s.version, answer: (wrong ? wrongAnswer : rightAnswer)(s.question, full) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.correct, !wrong);
    if (wrong) assert.ok(r.body.feedback.correct_option_ids || r.body.feedback.correct_order, 'a wrong answer shows the correct one');
    s = r.body.state;
    if (i === 5) assert.ok(s.question.context, 'a context question comes with its context');
  }
  assert.equal(s.finished, false);
  assert.equal(s.phase, 'repeat');
  assert.equal(s.to_repeat, 2);
  assert.equal(s.question.id, order[1], 'the first wrong question comes back first');

  // A reload continues at the same question.
  const reloaded = (await call('GET', `/api/quizzes/${quizId}`)).body.run;
  assert.equal(reloaded.question.id, order[1]);
  assert.equal(reloaded.done, 5);

  // Wrong again on order[1]: it goes behind order[3].
  let r = await call('POST', `/api/quizzes/runs/${s.run_id}/answer`, { question_id: order[1], version: s.version, answer: wrongAnswer(s.question, full) });
  s = r.body.state;
  assert.equal(s.question.id, order[3]);
  // A second tap with the old version does not count.
  const stale = await call('POST', `/api/quizzes/runs/${s.run_id}/answer`, { question_id: order[1], version: s.version - 1, answer: rightAnswer({ id: order[1] }, full) });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.state.question.id, order[3]);

  r = await call('POST', `/api/quizzes/runs/${s.run_id}/answer`, { question_id: order[3], version: s.version, answer: rightAnswer(s.question, full) });
  s = r.body.state;
  assert.equal(s.question.id, order[1]);
  assert.equal(s.finished, false);
  r = await call('POST', `/api/quizzes/runs/${s.run_id}/answer`, { question_id: order[1], version: s.version, answer: rightAnswer(s.question, full) });
  s = r.body.state;
  assert.equal(s.finished, true);
  assert.equal(s.phase, 'done');
  assert.equal(s.percent, 100);
  assert.equal(s.first_correct, 5);
  assert.equal(s.repeated, 2);
  assert.equal(s.wrong_answers, 3);
  assert.equal(s.answers, 10);
  assert.equal(s.question, null);

  // Nothing more can be answered; the quiz can be started again as a new run.
  assert.equal((await call('POST', `/api/quizzes/runs/${s.run_id}/answer`, { question_id: order[0], answer: [1] })).status, 409);
  const again = (await call('POST', `/api/quizzes/${quizId}/start`)).body;
  assert.notEqual(again.run_id, s.run_id);
  assert.equal(again.done, 0);

  const mine = (await call('GET', '/api/quiz-results')).body;
  assert.equal(mine.summary.finished, 1);
  assert.equal(mine.summary.in_progress, 1);
  // Classic results stay as they were.
  assert.equal((await call('GET', '/api/results')).body.attempts.length, 0);

  const all = (await org('GET', `/api/org/quizzes/results?test=${quizId}`)).body.runs;
  const done = all.find((x) => x.run_id === s.run_id);
  assert.equal(done.first_correct, 5);
  assert.equal(done.repeated, 2);
  assert.equal(done.wrong_answers, 3);
  assert.equal(done.finished, true);
});

test('each student has their own run; an empty answer is not counted', async () => {
  const one = await student();
  const two = await student();
  const full = (await org('GET', `/api/org/tests/${quizId}`)).body;
  const a = (await one('POST', `/api/quizzes/${quizId}/start`)).body;
  const b = (await two('POST', `/api/quizzes/${quizId}/start`)).body;
  assert.notEqual(a.run_id, b.run_id);
  assert.equal((await one('POST', `/api/quizzes/runs/${a.run_id}/answer`, { question_id: a.question.id, answer: [] })).status, 400);
  assert.equal((await two('POST', `/api/quizzes/runs/${a.run_id}/answer`, { question_id: a.question.id, answer: rightAnswer(a.question, full) })).status, 404, 'nobody answers in another student\'s run');
  const r = (await one('POST', `/api/quizzes/runs/${a.run_id}/answer`, { question_id: a.question.id, answer: rightAnswer(a.question, full) })).body;
  assert.equal(r.state.done, 1);
  assert.equal((await two('GET', `/api/quizzes/${quizId}`)).body.run.done, 0);
  // Starting twice continues the same run.
  assert.equal((await one('POST', `/api/quizzes/${quizId}/start`)).body.run_id, a.run_id);
});

test('the organizer makes a new quiz by hand and puts it in a book apart from the classic tests', async () => {
  const state = (await org('GET', '/api/org/state')).body;
  const topic = state.topics.find((t) => t.id === classic.topic_id);
  const made = await org('POST', '/api/org/tests', { ...ALL_FORMATS(topic.id), title: 'Жаңа quiz', format: 'quiz' });
  assert.equal(made.status, 201);
  assert.equal(made.body.format, 'quiz');
  assert.equal((await org('POST', `/api/org/tests/${made.body.id}/publish`)).status, 200);
  const after = (await org('GET', '/api/org/state')).body;
  assert.ok(after.quizzes.some((x) => x.id === made.body.id && x.live));
  assert.ok(!after.tests.some((x) => x.id === made.body.id));
  const call = await student();
  assert.equal((await call('GET', `/api/quizzes/${made.body.id}`)).status, 200);
  // Hiding works as for a classic test.
  await org('POST', `/api/org/tests/${made.body.id}/hide`);
  assert.equal((await call('GET', `/api/quizzes/${made.body.id}`)).status, 404);
});

test('a quiz sent as a link: a name instead of an account, wrong questions come back, progress kept, results for the organizer', async () => {
  const state = (await org('GET', '/api/org/state')).body;
  const quiz = state.quizzes.find((x) => x.id === quizId);
  const slug = quiz.share_id;
  const full = (await org('GET', `/api/org/tests/${quizId}`)).body;
  const guest = client();
  // Closed until the organizer turns the link on.
  let info = (await guest('GET', `/api/link/${slug}`)).body;
  assert.equal(info.format, 'quiz');
  assert.equal(info.open, false);
  assert.equal((await guest('POST', `/api/link/${slug}/quiz/start`, { name: 'Әлихан Нұрлан' })).status, 403);
  const card = (await org('GET', `/api/org/links/${quizId}`)).body;
  assert.equal(card.format, 'quiz');
  assert.equal((await org('PUT', `/api/org/links/${quizId}`, { enabled: true, retakes: false })).status, 200);
  info = (await guest('GET', `/api/link/${slug}`)).body;
  assert.equal(info.open, true);
  assert.equal(info.question_count, 7);
  assert.equal(info.run, null);
  // The classic player never opens a quiz, and the quiz routes never open a classic test.
  assert.equal((await guest('POST', `/api/link/${slug}/start`, { name: 'Әлихан Нұрлан' })).status, 404);
  const classicSlug = state.tests.find((x) => x.id === classic.id).share_id;
  assert.equal((await guest('POST', `/api/link/${classicSlug}/quiz/start`, { name: 'Әлихан Нұрлан' })).status, 404);
  assert.equal((await guest('POST', `/api/link/${slug}/quiz/start`, { name: 'Ә' })).status, 400, 'a full name is needed');

  let s = (await guest('POST', `/api/link/${slug}/quiz/start`, { name: 'Әлихан Нұрлан' })).body;
  assert.equal(s.name, 'Әлихан Нұрлан');
  assert.equal(s.total, 7);
  // First question wrong: it comes back after the others.
  const firstId = s.question.id;
  let r = await guest('POST', `/api/link/${slug}/quiz/answer`, { run_id: s.run_id, question_id: s.question.id, version: s.version, answer: wrongAnswer(s.question, full) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.correct, false);
  s = r.body.state;
  // A reload continues the same run where it stopped.
  info = (await guest('GET', `/api/link/${slug}`)).body;
  assert.equal(info.run.run_id, s.run_id);
  assert.equal(info.run.question.id, s.question.id);
  // Another browser cannot answer in this run.
  const other = client();
  assert.equal((await other('POST', `/api/link/${slug}/quiz/answer`, { run_id: s.run_id, question_id: s.question.id, version: s.version, answer: rightAnswer(s.question, full) })).status, 404);
  const seen = [];
  while (s.phase !== 'done') {
    seen.push(s.question.id);
    r = await guest('POST', `/api/link/${slug}/quiz/answer`, { run_id: s.run_id, question_id: s.question.id, version: s.version, answer: rightAnswer(s.question, full) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    s = r.body.state;
  }
  assert.equal(seen.at(-1), firstId, 'the wrong question came back at the end');
  assert.equal(s.first_correct, 6);
  assert.equal(s.wrong_answers, 1);
  assert.equal(s.finished, true);
  // Retakes are off: the same browser cannot start again.
  info = (await guest('GET', `/api/link/${slug}`)).body;
  assert.equal(info.already_done, true);
  assert.equal((await guest('POST', `/api/link/${slug}/quiz/start`, { name: 'Әлихан Нұрлан' })).status, 409);
  // The organizer sees the run with the typed name, apart from the classic link results.
  const runs = (await org('GET', `/api/org/quizzes/results?test=${quizId}`)).body.runs;
  const mine = runs.find((x) => x.via === 'link' && x.run_id === s.run_id);
  assert.equal(mine.user.display_name, 'Әлихан Нұрлан');
  assert.equal(mine.finished, true);
  assert.equal(mine.wrong_answers, 1);
  const classicLinks = (await org('GET', '/api/org/links/results')).body.results;
  assert.ok(!classicLinks.some((x) => x.test_id === quizId));
});
