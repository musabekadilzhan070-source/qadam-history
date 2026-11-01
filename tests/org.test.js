import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qadam-org-'));
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
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function client() {
  let cookie = '';
  const call = async (method, url, body, extra = {}) => {
    const raw = Buffer.isBuffer(body);
    const headers = { 'Content-Type': raw ? 'application/octet-stream' : 'application/json', ...extra };
    if (method !== 'GET') headers['X-Qadam'] = '1';
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(base + url, { method, headers, body: raw ? body : body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
  };
  return call;
}

// Smallest valid PNG (1×1) and PDF headers: the server checks the real bytes, not the name.
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

async function student(email = `s${Math.random().toString(36).slice(2, 8)}@mail.kz`) {
  const call = client();
  const reg = await call('POST', '/api/auth/register', { display_name: 'Оқушы', email, password: 'secret9', password_confirm: 'secret9' });
  assert.equal(reg.status, 201);
  return call;
}

/** A topic as students see it in its period's list (the reading page is gone). */
async function topicInPeriod(call, state, topic) {
  const period = state.periods.find((p) => p.id === topic.period_id);
  return (await call('GET', `/api/periods/${period.slug}`)).body.topics.find((t) => t.id === topic.id) || null;
}

async function organizer() {
  const call = client();
  const res = await call('POST', '/api/org/login', { pin: '908172' });
  assert.equal(res.status, 200);
  return call;
}

test('wrong PIN is refused, the PIN never reaches the page, logout ends the session', async () => {
  const call = client();
  assert.equal((await call('GET', '/api/org/state')).status, 401);
  const wrong = await call('POST', '/api/org/login', { pin: '111111' });
  assert.equal(wrong.status, 401);
  assert.match(wrong.body.error, /PIN/);
  assert.equal((await call('POST', '/api/org/login', { pin: '908172' })).status, 200);
  assert.equal((await call('GET', '/api/org/me')).body.organizer, true);
  assert.equal((await call('GET', '/api/org/state')).status, 200);
  await call('POST', '/api/org/logout');
  assert.equal((await call('GET', '/api/org/me')).body.organizer, false);
  assert.equal((await call('GET', '/api/org/state')).status, 401);

  const page = await fetch(`${base}/organizer`);
  assert.equal(page.status, 200);
  assert.doesNotMatch(await page.text(), /908172/);
});

test('a student account cannot open the cabinet', async () => {
  const call = await student();
  assert.equal((await call('GET', '/api/org/state')).status, 401);
  assert.equal((await call('POST', '/api/org/topics', { title: 'X', period_id: 1 })).status, 401);
  assert.equal((await call('POST', '/api/org/tests/1/publish')).status, 401);
});

const key = (n) => `k${n}`;
// One question of every format, with a context block of two questions.
const ALL_TYPES = (imageId) => [
  { type: 'single', text: 'Бір жауап', points: 1, options: [{ text: 'А', is_correct: true }, { text: 'Б' }, { text: 'В' }] },
  { type: 'multiple', text: 'Бірнеше жауап', points: 2, options: [{ text: 'А', is_correct: true }, { text: 'Б', is_correct: true }, { text: 'В' }] },
  { type: 'image', text: 'Суретте кім?', image_id: imageId, options: [{ text: 'Абылай', is_correct: true }, { text: 'Кенесары' }] },
  {
    type: 'matching',
    text: 'Сәйкестендіріңіз',
    points: 3,
    data: { pairs: [{ key: key(1), left: 'Керей', right: '1465' }, { key: key(2), left: 'Абылай', right: '1771' }, { key: key(3), left: 'Кенесары', right: '1837' }] },
  },
  {
    type: 'ordering',
    text: 'Ретімен қойыңыз',
    points: 2,
    data: { items: [{ key: key(4), text: 'Қазақ хандығы', date: '1465' }, { key: key(5), text: 'Аңырақай', date: '1730' }, { key: key(6), text: 'Алаш', date: '1917' }] },
  },
  { type: 'open', text: 'Қазақ хандығының негізін қалаған хандар?', data: { answers: ['Керей мен Жәнібек', 'Жәнібек пен Керей'], ignore_case: true, ignore_spaces: true } },
  {
    type: 'context',
    text: 'Аңырақай шайқасы',
    image_id: imageId,
    data: { body: '1730 жылы қазақ жасағы жоңғарларды жеңді.' },
    children: [
      { type: 'single', text: 'Шайқас жылы?', options: [{ text: '1730', is_correct: true }, { text: '1723' }] },
      { type: 'open', text: 'Кімге қарсы шайқас?', data: { answers: ['жоңғарлар'] } },
    ],
  },
];

/** The right answer for every question of a builder test (as returned by the cabinet). */
function rightAnswers(test) {
  const out = {};
  const one = (q) => {
    if (['single', 'multiple', 'image'].includes(q.type)) out[q.id] = q.options.filter((o) => o.is_correct).map((o) => o.id);
    if (q.type === 'matching') out[q.id] = Object.fromEntries(q.data.pairs.map((p) => [p.key, p.key]));
    if (q.type === 'ordering') out[q.id] = q.data.items.map((i) => i.key);
    if (q.type === 'open') out[q.id] = `  ${q.data.answers[0].toUpperCase()} `;
    (q.children || []).forEach(one);
  };
  test.questions.forEach(one);
  return out;
}

test('test builder: every format is saved, checked, previewed and published', async () => {
  const org = await organizer();
  const pupil = await student();
  const { body: st } = await org('GET', '/api/org/state');
  const topic = st.topics.find((t) => t.published);
  const img = await org('POST', '/api/org/files?kind=image', PNG);

  const created = await org('POST', '/api/org/tests', { title: 'Барлық формат', topic_id: topic.id });
  assert.equal(created.status, 201);
  const id = created.body.id;
  assert.equal(created.body.live_state, 'hidden');

  // An unfinished draft can be saved; publishing lists what is wrong.
  const draft = await org('PUT', `/api/org/tests/${id}`, {
    title: 'Барлық формат',
    topic_id: topic.id,
    questions: [
      { type: 'single', text: '', options: [{ text: 'А' }, { text: 'Б' }] },
      { type: 'matching', text: 'Жұп', data: { pairs: [{ left: 'А', right: '' }] } },
      { type: 'ordering', text: 'Рет', data: { items: [{ text: 'Бір' }] } },
      { type: 'context', text: 'Мәтінсіз контекст', data: { body: '' }, children: [] },
    ],
  });
  assert.equal(draft.status, 200);
  const refused = await org('POST', `/api/org/tests/${id}/publish`);
  assert.equal(refused.status, 400);
  const problems = refused.body.problems.join('\n');
  assert.match(problems, /1-сұрақ: сұрақ мәтіні бос/);
  assert.match(problems, /1-сұрақ: дұрыс жауап белгіленбеген/);
  assert.match(problems, /2-сұрақ: .*жұп/);
  assert.match(problems, /3-сұрақ: кемінде екі оқиға/);
  assert.match(problems, /контекст мәтіні енгізілмеген/);
  assert.equal((await pupil('GET', `/api/tests/${id}`)).status, 404);

  // The full test with description, cover and settings.
  const saved = await org('PUT', `/api/org/tests/${id}`, {
    title: 'Барлық формат',
    description: 'Жеті форматтың бәрі',
    cover_image_id: img.body.id,
    topic_id: topic.id,
    settings: { time_limit_min: 20, pass_percent: 60, partial_credit: true, shuffle_options: true },
    questions: ALL_TYPES(img.body.id),
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const t = saved.body;
  assert.deepEqual(t.questions.map((q) => q.type), ['single', 'multiple', 'image', 'matching', 'ordering', 'open', 'context']);
  assert.equal(t.questions[6].children.length, 2);
  assert.deepEqual(t.problems, []);
  assert.equal(t.settings.time_limit_min, 20);

  // Reordering keeps every question and its answers (ids stay the same).
  const reordered = [...t.questions].reverse();
  const again = (await org('PUT', `/api/org/tests/${id}`, { ...t, questions: reordered })).body;
  assert.deepEqual(again.questions.map((q) => q.id), reordered.map((q) => q.id));
  assert.deepEqual(again.questions.at(-1).options.map((o) => o.is_correct), [true, false, false]);
  const t2 = (await org('PUT', `/api/org/tests/${id}`, t)).body;

  // Preview as a student: nothing is stored.
  const before = (await org('GET', '/api/org/students')).body.students.reduce((n, s) => n + s.attempts, 0);
  const paper = await org('POST', '/api/org/preview', { test: t2 });
  assert.equal(paper.status, 200);
  assert.equal(paper.body.question_count, 8);
  assert.doesNotMatch(JSON.stringify(paper.body.units), /is_correct|"answers"|"date"/);
  const ctx = paper.body.units.find((u) => u.type === 'context');
  assert.equal(ctx.children.length, 2);
  assert.equal(ctx.body, '1730 жылы қазақ жасағы жоңғарларды жеңді.');
  const preview = await org('POST', '/api/org/preview', { test: t2, answers: rightAnswers(t2), served: paper.body.served });
  assert.equal(preview.body.percent, 100);
  assert.equal(preview.body.max_score, 1 + 2 + 1 + 3 + 2 + 1 + 1 + 1);
  const after = (await org('GET', '/api/org/students')).body.students.reduce((n, s) => n + s.attempts, 0);
  assert.equal(after, before);

  // Publish: students get it at once, without the organizer publishing the whole site.
  const pub = await org('POST', `/api/org/tests/${id}/publish`);
  assert.equal(pub.status, 200);
  assert.equal(pub.body.live_state, 'live');
  const home = (await pupil('GET', '/api/overview')).body;
  assert.ok(home.tests.some((x) => x.id === id && x.description === 'Жеті форматтың бәрі' && x.time_limit_min === 20));
  const start = (await pupil('GET', `/api/tests/${id}`)).body;
  assert.equal(start.time_limit_sec, 20 * 60);
  const matching = start.units.find((u) => u.type === 'matching');
  assert.equal(matching.left.length, 3);
  assert.equal(matching.right.length, 3);
  const ordering = start.units.find((u) => u.type === 'ordering');
  assert.notDeepEqual(ordering.items.map((i) => i.key), [key(4), key(5), key(6)]);

  const answers = rightAnswers(t2);
  const matchingQ = t2.questions.find((q) => q.type === 'matching');
  answers[matchingQ.id] = { [key(1)]: key(1), [key(2)]: key(3), [key(3)]: key(2) }; // one of three right
  const res = await pupil('POST', `/api/tests/${id}`, { answers, token: start.token });
  assert.equal(res.status, 200);
  assert.equal(res.body.saved, true);
  assert.equal(res.body.correct, 7);
  assert.equal(res.body.score, 10); // partial credit: 1 of 3 pairs = 1 of 3 points
  assert.equal(res.body.max_score, 12);
  const review = (await pupil('GET', `/api/results/${res.body.attempt_id}`)).body;
  assert.equal(review.items.length, 8);
  assert.ok(review.items.find((i) => i.type === 'matching').pairs.some((p) => !p.ok));
  assert.ok(review.items.filter((i) => i.context).length === 2);

  // Edits stay in the draft until published again.
  const edited = (await org('PUT', `/api/org/tests/${id}`, { ...t2, title: 'Жаңа атау' })).body;
  assert.equal(edited.live_state, 'changed');
  assert.equal((await pupil('GET', `/api/tests/${id}`)).body.title, 'Барлық формат');
  await org('POST', `/api/org/tests/${id}/publish`);
  assert.equal((await pupil('GET', `/api/tests/${id}`)).body.title, 'Жаңа атау');

  // Duplicate, hide, delete.
  const copy = await org('POST', `/api/org/tests/${id}/duplicate`);
  assert.equal(copy.status, 201);
  assert.equal(copy.body.title, 'Жаңа атау (көшірме)');
  assert.equal(copy.body.questions.length, 7);
  assert.equal(copy.body.live_state, 'hidden');
  assert.ok(copy.body.questions.every((q, i) => q.id !== t2.questions[i].id));
  assert.equal((await org('POST', `/api/org/tests/${id}/hide`)).body.live_state, 'hidden');
  assert.equal((await pupil('GET', `/api/tests/${id}`)).status, 404);
  assert.equal((await org('DELETE', `/api/org/tests/${copy.body.id}`)).status, 200);
  assert.equal((await org('GET', `/api/org/tests/${copy.body.id}`)).status, 404);
  // The student's result stays.
  assert.equal((await pupil('GET', '/api/results')).body.attempts.length, 1);
});

test('time limit is checked on the server and the question limit picks a subset', async () => {
  const org = await organizer();
  const pupil = await student();
  const { body: st } = await org('GET', '/api/org/state');
  const topic = st.topics.find((t) => t.published);
  const questions = Array.from({ length: 6 }, (_, i) => ({ type: 'single', text: `С${i}`, options: [{ text: 'А', is_correct: true }, { text: 'Б' }] }));
  const x = (await org('POST', '/api/org/tests', { title: 'Шектеу', topic_id: topic.id, questions, settings: { question_limit: 4, question_time_sec: 30 } })).body;
  await org('POST', `/api/org/tests/${x.id}/publish`);
  const start = (await pupil('GET', `/api/tests/${x.id}`)).body;
  assert.equal(start.units.length, 4);
  assert.equal(start.question_time_sec, 30);
  assert.equal(start.time_limit_sec, 120);
  // A token from long ago (forged start time) is refused even with a valid signature format.
  const [b] = start.token.split('.');
  const old = JSON.parse(Buffer.from(b, 'base64url').toString());
  const forged = Buffer.from(JSON.stringify({ ...old, s: old.s - 3600e3 })).toString('base64url') + '.' + start.token.split('.')[1];
  assert.equal((await pupil('POST', `/api/tests/${x.id}`, { answers: {}, token: forged })).status, 400);
  const ok = await pupil('POST', `/api/tests/${x.id}`, { answers: {}, token: start.token });
  assert.equal(ok.body.total, 4);
});

test('tests need a topic and a title', async () => {
  const org = await organizer();
  assert.equal((await org('POST', '/api/org/tests', { title: 'Тақырыпсыз' })).status, 400);
  const { body: st } = await org('GET', '/api/org/state');
  assert.equal((await org('POST', '/api/org/tests', { title: '', topic_id: st.topics[0].id })).status, 400);
});

test('emblem library: built-in emblems, own uploads, assigning to a topic', async () => {
  const org = await organizer();
  const pupil = await student();
  const { EMBLEMS, EMBLEM_CATEGORIES } = await import('../public/assets/js/emblems.js');
  assert.ok(EMBLEMS.length >= 120);
  assert.equal(EMBLEM_CATEGORIES.length, 18);
  assert.equal(new Set(EMBLEMS.map((e) => e.name)).size, EMBLEMS.length);
  for (const [k] of EMBLEM_CATEGORIES) assert.ok(EMBLEMS.some((e) => e.category === k), k);

  const { body: st } = await org('GET', '/api/org/state');
  const [a, b] = st.topics.filter((t) => t.published);
  const icon = { kind: 'emblem', name: 'k-shanyrak' };
  assert.equal((await org('PUT', `/api/org/topics/${a.id}`, { ...a, icon })).status, 200);
  assert.equal((await org('PUT', `/api/org/topics/${a.id}`, { ...a, icon: { kind: 'emblem', name: 'nope' } })).status, 400);
  await org('POST', '/api/org/publish', {});
  const pa = await topicInPeriod(pupil, st, a);
  const pb = await topicInPeriod(pupil, st, b);
  assert.equal(pa.icon.name, 'k-shanyrak');
  assert.notEqual(pb.icon.name, 'k-shanyrak');

  const file = await org('POST', '/api/org/files?kind=icon', PNG);
  assert.equal((await org('POST', '/api/org/emblems', { name: 'Менің эмблемам', category: 'bad', file_id: file.body.id })).status, 400);
  const own = await org('POST', '/api/org/emblems', { name: 'Менің эмблемам', category: 'khanate', file_id: file.body.id });
  assert.equal(own.status, 201);
  const listed = (await org('GET', '/api/org/state')).body.emblems;
  assert.equal(listed[0].name, 'Менің эмблемам');
  assert.equal((await org('PUT', `/api/org/emblems/${own.body.id}`, { name: 'Атауы өзгерді', category: 'alash' })).status, 200);
  assert.equal((await org('DELETE', `/api/org/emblems/${own.body.id}`)).status, 200);
});

test('organizer can give a student a temporary password', async () => {
  const org = await organizer();
  const pupil = await student('unutqan@mail.kz');
  const s = (await org('GET', '/api/org/students')).body.students.find((x) => x.email === 'unutqan@mail.kz');
  const { body } = await org('POST', `/api/org/students/${s.id}/password`);
  assert.match(body.password, /^[a-z0-9]{10}$/);
  assert.equal((await pupil('GET', '/api/me')).body.user, null, 'old sessions end');
  const again = client();
  assert.equal((await again('POST', '/api/auth/login', { login: 'unutqan@mail.kz', password: body.password })).status, 200);
});

test('uploads are checked by content, stored in the database and served back', async () => {
  const org = await organizer();
  const fake = await org('POST', '/api/org/files?kind=image', Buffer.from('not an image'), { 'X-File-Name': 'a.png' });
  assert.equal(fake.status, 400);
  const pdfAsImage = await org('POST', '/api/org/files?kind=image', PDF, { 'X-File-Name': 'a.png' });
  assert.equal(pdfAsImage.status, 400);
  const big = await org('POST', '/api/org/files?kind=icon', Buffer.concat([PNG, Buffer.alloc(400 * 1024)]));
  assert.equal(big.status, 400);

  const img = await org('POST', '/api/org/files?kind=image', PNG, { 'X-File-Name': encodeURIComponent('Хан.png') });
  assert.equal(img.status, 201);
  assert.equal(img.body.name, 'Хан.png');
  const served = await fetch(`${base}/api/files/${img.body.id}`);
  assert.equal(served.headers.get('content-type'), 'image/png');
  assert.ok(Buffer.from(await served.arrayBuffer()).equals(PNG));
  const replaced = await org('PUT', `/api/org/files/${img.body.id}/content`, PNG);
  assert.equal(replaced.body.version, 2);

  // A topic picture, then the in-use warning on delete.
  const { body: st } = await org('GET', '/api/org/state');
  const t = st.topics[0];
  await org('PUT', `/api/org/topics/${t.id}`, { ...t, image_id: img.body.id });
  const inUse = await org('DELETE', `/api/org/files/${img.body.id}`);
  assert.equal(inUse.status, 409);
  assert.equal(inUse.body.used_by.length, 1);
  assert.equal((await org('DELETE', `/api/org/files/${img.body.id}?force=1`)).status, 200);
  assert.equal((await fetch(`${base}/api/files/${img.body.id}`)).status, 404);
});

test('deleting a topic keeps or removes its tests; students keep their results', async () => {
  const org = await organizer();
  const pupil = await student();
  const { body: st } = await org('GET', '/api/org/state');
  const topic = st.topics.find((t) => t.slug === 'turik-kaganaty');
  const testId = st.tests.find((x) => x.topic_id === topic.id).id;
  const quiz = (await pupil('GET', `/api/tests/${testId}`)).body;
  const done = await pupil('POST', `/api/tests/${testId}`, { answers: { [quiz.units[0].id]: quiz.units[0].options[0].id }, token: quiz.token });
  assert.equal(done.body.saved, true);

  assert.equal((await org('DELETE', `/api/org/topics/${topic.id}?mode=keep`)).status, 200);
  const after = (await org('GET', '/api/org/state')).body;
  assert.ok(!after.topics.some((t) => t.id === topic.id));
  const kept = after.tests.find((x) => x.id === testId);
  assert.equal(kept.topic_id, null);
  await org('POST', '/api/org/publish', {});
  assert.equal(await topicInPeriod(pupil, after, topic), null);
  const results = (await pupil('GET', '/api/results')).body;
  assert.equal(results.attempts.length, 1);

  // Roll back to the version before the delete: the topic comes back with its slug.
  const pubs = (await org('GET', '/api/org/publications')).body.publications;
  assert.equal((await org('POST', `/api/org/publications/${pubs[1].id}/restore`)).status, 200);
  await org('POST', '/api/org/publish', { note: 'қайтару' });
  assert.ok(await topicInPeriod(pupil, after, topic));
  assert.equal((await pupil('GET', '/api/results')).body.attempts.length, 1);
});

test('site texts and icons reach the student side after publishing', async () => {
  const org = await organizer();
  const img = await org('POST', '/api/org/files?kind=image', PNG);
  assert.equal((await org('PUT', '/api/org/texts', { texts: { banner_title: 'Жаңа баннер', banner_image_id: img.body.id } })).status, 200);
  assert.equal(
    (await org('PUT', '/api/org/icons', { icons: { 'nav.home': { kind: 'builtin', name: 'book', size: 30 }, 'period.1': { kind: 'file', id: img.body.id } } })).status,
    200,
  );
  assert.equal((await org('PUT', '/api/org/icons', { icons: { 'nav.home': { kind: 'builtin', name: 'nope' } } })).status, 400);
  await org('POST', '/api/org/publish', {});
  const site = (await client()('GET', '/api/site')).body;
  assert.equal(site.texts.banner_title, 'Жаңа баннер');
  assert.equal(site.icons['nav.home'].name, 'book');
  assert.equal(site.icons['nav.home'].size, 30);
  assert.equal(site.icons['period.1'].id, img.body.id);
});

test('topic grade and publisher: required for a new topic, one of 12 pairs, kept, shown to students', async () => {
  const org = await organizer();
  const ic = (x) => (typeof x.icon === 'string' ? JSON.parse(x.icon) : x.icon);
  const { body: st } = await org('GET', '/api/org/state');
  const period = st.periods[0].id;
  // A new topic cannot be saved without them, nor with a pair outside the list.
  assert.equal((await org('POST', '/api/org/topics', { title: 'Сыныпсыз тақырып', period_id: period })).status, 400);
  assert.equal((await org('POST', '/api/org/topics', { title: 'Қате', period_id: period, grade: 5, publisher: 'Атамұра' })).status, 400);
  assert.equal((await org('POST', '/api/org/topics', { title: 'Қате', period_id: period, grade: 8, publisher: 'Алматыкітап' })).status, 400);
  const ids = [];
  for (const grade of [6, 7, 8, 9, 10, 11]) {
    for (const publisher of ['Атамұра', 'Мектеп']) {
      const r = await org('POST', '/api/org/topics', { title: `${grade} ${publisher} тақырыбы`, period_id: period, grade, publisher, published: true, icon: { kind: 'emblem', name: 'k-shanyrak', size: 36 } });
      assert.equal(r.status, 201, `${grade} ${publisher}`);
      ids.push([r.body.id, grade, publisher]);
    }
  }
  let { body: s2 } = await org('GET', '/api/org/state');
  for (const [id, grade, publisher] of ids) {
    const t = s2.topics.find((x) => x.id === id);
    assert.deepEqual([t.grade, t.publisher, ic(t).size], [grade, publisher, 36]);
  }
  // Editing changes it; a request without it (publishing from the list) keeps it.
  const [first] = ids;
  const t = s2.topics.find((x) => x.id === first[0]);
  assert.equal((await org('PUT', `/api/org/topics/${t.id}`, { ...t, icon: ic(t), grade: 9, publisher: 'Мектеп' })).status, 200);
  assert.equal((await org('PUT', `/api/org/topics/${t.id}`, { ...t, icon: ic(t), grade: null, publisher: '', published: false })).status, 200);
  ({ body: s2 } = await org('GET', '/api/org/state'));
  const after = s2.topics.find((x) => x.id === t.id);
  assert.deepEqual([after.grade, after.publisher, after.published], [9, 'Мектеп', 0]);
  // Emblem size: 16–128 px, outside values are set to the nearest limit.
  for (const [size, want] of [[16, 16], [128, 128], [200, 128], [3, 16], [36.6, 37]]) {
    await org('PUT', `/api/org/topics/${t.id}`, { ...after, icon: { kind: 'emblem', name: 'k-shanyrak', size } });
    ({ body: s2 } = await org('GET', '/api/org/state'));
    assert.equal(ic(s2.topics.find((x) => x.id === t.id)).size, want, `size ${size}`);
  }
  // Students see the pair on the topic list after publishing.
  await org('POST', '/api/org/publish', {});
  const pupil = await student();
  const slug = (await pupil('GET', '/api/overview')).body.periods.find((p) => p.id === period).slug;
  const page = (await pupil('GET', `/api/periods/${slug}`)).body;
  const shown = page.topics.find((x) => x.id === ids[1][0]);
  assert.deepEqual([shown.grade, shown.publisher], [6, 'Мектеп']);
});
