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
  const call = client();
  await call('POST', '/api/auth/register', { username: 'oqushy9', display_name: 'Оқушы', password: 'secret9' });
  assert.equal((await call('GET', '/api/org/state')).status, 401);
  assert.equal((await call('POST', '/api/org/topics', { title: 'X', period_id: 1 })).status, 401);
});

test('drafts stay hidden until published; publishing shows them to students', async () => {
  const org = await organizer();
  const student = client();
  const { body: st } = await org('GET', '/api/org/state');
  const period = st.periods[0];

  const created = await org('POST', '/api/org/topics', { title: 'Жаңа тақырып', period_id: period.id, summary: 'Қысқаша', body: 'Мәтін', published: true });
  assert.equal(created.status, 201);
  assert.equal((await student('GET', `/api/topics/${created.body.slug}`)).status, 404);

  const test1 = await org('POST', '/api/org/tests', { title: 'Жаңа тест', topic_id: created.body.id, published: true });
  const saved = await org('PUT', `/api/org/tests/${test1.body.id}`, {
    title: 'Жаңа тест',
    topic_id: created.body.id,
    published: true,
    questions: [
      { text: 'Бір жауап', options: [{ text: 'А', is_correct: true }, { text: 'Б' }] },
      { text: 'Екі жауап', options: [{ text: 'А', is_correct: true }, { text: 'Б', is_correct: true }, { text: 'В' }] },
      { text: 'Жауабы белгіленбеген', options: [{ text: 'А' }, { text: 'Б' }] },
    ],
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.questions.length, 3);
  const state = (await org('GET', '/api/org/state')).body;
  assert.equal(state.tests.find((x) => x.id === test1.body.id).missing_correct, 1);
  assert.equal(state.status.has_unpublished, true);

  assert.equal((await org('POST', '/api/org/publish', { note: 'сынақ' })).status, 200);
  const topic = await student('GET', `/api/topics/${created.body.slug}`);
  assert.equal(topic.status, 200);
  assert.equal(topic.body.tests.length, 1);
  const quiz = (await student('GET', `/api/tests/${test1.body.id}`)).body;
  // The question without a correct answer is left out for students.
  assert.equal(quiz.questions.length, 2);
  assert.deepEqual(quiz.questions.map((q) => q.multiple), [false, true]);

  const q2 = saved.body.questions[1];
  const both = q2.options.filter((o) => o.is_correct).map((o) => o.id);
  const graded = await student('POST', `/api/tests/${test1.body.id}`, { answers: { [q2.id]: both } });
  assert.equal(graded.body.correct, 1);
  const half = await student('POST', `/api/tests/${test1.body.id}`, { answers: { [q2.id]: [both[0]] } });
  assert.equal(half.body.correct, 0);

  // Hide and publish again: students lose the topic.
  await org('PUT', `/api/org/topics/${created.body.id}`, { title: 'Жаңа тақырып', period_id: period.id, published: false });
  await org('POST', '/api/org/publish', {});
  assert.equal((await student('GET', `/api/topics/${created.body.slug}`)).status, 404);
});

test('questions need two options; tests need a topic', async () => {
  const org = await organizer();
  const { body: st } = await org('GET', '/api/org/state');
  const x = st.tests[0];
  const bad = await org('PUT', `/api/org/tests/${x.id}`, { title: 'T', topic_id: x.topic_id, questions: [{ text: 'Q', options: [{ text: 'A' }] }] });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /екі/);
  assert.equal((await org('POST', '/api/org/tests', { title: 'Тақырыпсыз' })).status, 400);
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

  const pdf = await org('POST', '/api/org/files?kind=pdf', PDF, { 'X-File-Name': 'doc.pdf' });
  assert.equal(pdf.status, 201);
  const replaced = await org('PUT', `/api/org/files/${img.body.id}/content`, PNG);
  assert.equal(replaced.body.version, 2);

  // A material with the PDF, then the in-use warning on delete.
  const mat = await org('POST', '/api/org/materials', { title: 'Құжат', pdf_id: pdf.body.id, published: true });
  assert.equal(mat.status, 201);
  const inUse = await org('DELETE', `/api/org/files/${pdf.body.id}`);
  assert.equal(inUse.status, 409);
  assert.equal(inUse.body.used_by.length, 1);
  assert.equal((await org('DELETE', `/api/org/files/${pdf.body.id}?force=1`)).status, 200);
  assert.equal((await fetch(`${base}/api/files/${pdf.body.id}`)).status, 404);
});

test('deleting a topic keeps or removes its tests; students keep their results', async () => {
  const org = await organizer();
  const student = client();
  await student('POST', '/api/auth/register', { username: 'oqushy8', display_name: 'Оқушы', password: 'secret8' });
  const { body: st } = await org('GET', '/api/org/state');
  const topic = st.topics.find((t) => st.tests.some((x) => x.topic_id === t.id));
  const testId = st.tests.find((x) => x.topic_id === topic.id).id;
  const quiz = (await student('GET', `/api/tests/${testId}`)).body;
  const done = await student('POST', `/api/tests/${testId}`, { answers: { [quiz.questions[0].id]: quiz.questions[0].options[0].id } });
  assert.equal(done.body.saved, true);

  assert.equal((await org('DELETE', `/api/org/topics/${topic.id}?mode=keep`)).status, 200);
  const after = (await org('GET', '/api/org/state')).body;
  assert.ok(!after.topics.some((t) => t.id === topic.id));
  const kept = after.tests.find((x) => x.id === testId);
  assert.equal(kept.topic_id, null);
  await org('POST', '/api/org/publish', {});
  assert.equal((await student('GET', `/api/topics/${topic.slug}`)).status, 404);
  const results = (await student('GET', '/api/results')).body;
  assert.equal(results.attempts.length, 1);

  // Roll back to the version before the delete: the topic comes back with its slug.
  const pubs = (await org('GET', '/api/org/publications')).body.publications;
  assert.equal((await org('POST', `/api/org/publications/${pubs[1].id}/restore`)).status, 200);
  await org('POST', '/api/org/publish', { note: 'қайтару' });
  assert.equal((await student('GET', `/api/topics/${topic.slug}`)).status, 200);
  assert.equal((await student('GET', '/api/results')).body.attempts.length, 1);
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

test('khans and historical figures', async () => {
  const org = await organizer();
  const { body: st } = await org('GET', '/api/org/state');
  const topic = st.topics.find((t) => t.published);
  const p = await org('POST', '/api/org/persons', {
    name: 'Абылай хан',
    reign: '1771–1781',
    biography: 'Өмірбаяны',
    facts: ['Бірінші дерек', ''],
    topic_id: topic.id,
    published: true,
  });
  assert.equal(p.status, 201);
  await org('POST', '/api/org/publish', {});
  const page = (await client()('GET', `/api/topics/${topic.slug}`)).body;
  assert.equal(page.persons.length, 1);
  assert.deepEqual(page.persons[0].facts, ['Бірінші дерек']);
});
