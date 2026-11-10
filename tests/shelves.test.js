import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qadam-shelves-'));
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



async function organizer() {
  const call = client();
  const res = await call('POST', '/api/org/login', { pin: '908172' });
  assert.equal(res.status, 200);
  return call;
}

const CHUNK = 1024 * 1024;
// A PDF larger than one request may be: 2.5 chunks.
const bigPdf = () => {
  const head = Buffer.from('%PDF-1.4\n');
  const tail = Buffer.from('\ntrailer<<>>\n%%EOF\n');
  return Buffer.concat([head, Buffer.alloc(Math.round(CHUNK * 2.5), 0x20), tail]);
};

async function uploadPdf(org, buf, name = 'kitap.pdf') {
  const start = await org('POST', '/api/org/books/uploads', { name, size: buf.length });
  assert.equal(start.status, 201, JSON.stringify(start.body));
  for (let i = 0; i < start.body.chunks; i += 1) {
    const r = await org('PUT', `/api/org/books/uploads/${start.body.file_id}/${i}`, buf.subarray(i * CHUNK, (i + 1) * CHUNK));
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  return start.body.file_id;
}


const Q = [{ type: 'single', text: 'Сұрақ?', points: 1, options: [{ text: 'А', is_correct: true }, { text: 'Б' }] }];

async function book(org, title, grade, publisher, published = true) {
  const fileId = await uploadPdf(org, PDF);
  assert.equal((await org('POST', `/api/org/books/uploads/${fileId}/finish`, { page_count: 3 })).status, 200);
  const cover = await org('POST', '/api/org/files?kind=image', PNG);
  const r = await org('POST', '/api/org/books', { title, grade, publisher, cover_id: cover.body.id, pdf_id: fileId, published });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.id;
}

async function newTest(org, topicId, title, publish = true) {
  const r = await org('POST', '/api/org/tests', { title, topic_id: topicId, questions: Q });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  if (publish) assert.equal((await org('POST', `/api/org/tests/${r.body.id}/publish`)).status, 200);
  return r.body.id;
}

test('period books: organizer links books and tests; students see only what is approved', async () => {
  const org = await organizer();
  const { body: st } = await org('GET', '/api/org/state');
  const [pA, pB] = st.periods;
  const topicA = st.topics.find((t) => t.period_id === pA.id && t.published);
  const topicB = st.topics.find((t) => t.period_id === pB.id && t.published);
  assert.ok(topicA && topicB, 'seeded topics in two periods');

  const t1 = await newTest(org, topicA.id, 'Атамұра тесті');
  const t2 = await newTest(org, topicA.id, 'Мектеп тесті');
  const tDraft = await newTest(org, topicA.id, 'Жоба тест', false);
  const tB = await newTest(org, topicB.id, 'Басқа кезең тесті');
  const atamura = await book(org, 'Қазақстан тарихы 8 (Атамұра)', 8, 'Атамұра');
  const mektep = await book(org, 'Қазақстан тарихы 8 (Мектеп)', 8, 'Мектеп');
  const hidden = await book(org, 'Жасырын кітап', 9, 'Мектеп', false);

  const pupil = await student();
  const before = (await pupil('GET', `/api/periods/${pA.slug}`)).body;
  assert.deepEqual(before.books, [], 'no books on the period: empty list, topics as before');
  assert.ok(before.topics.length);

  // Only the organizer can change it, and only with valid data.
  assert.equal((await client()('GET', '/api/org/period-books')).status, 401);
  assert.equal((await org('POST', '/api/org/period-books', { period_id: pA.id, book_id: 99999 })).status, 400);
  assert.equal((await org('POST', '/api/org/period-books', { period_id: 99999, book_id: atamura })).status, 400);
  assert.equal((await org('POST', '/api/org/period-books', { period_id: pA.id, book_id: atamura, test_ids: [tB] })).status, 400, 'a test of another period');

  const eA = (await org('POST', '/api/org/period-books', { period_id: pA.id, book_id: atamura, test_ids: [t1, tDraft] })).body;
  assert.deepEqual(eA.test_ids.sort(), [t1, tDraft].sort());
  assert.equal((await org('POST', '/api/org/period-books', { period_id: pA.id, book_id: atamura })).status, 409, 'same book twice on a period');
  const eM = (await org('POST', '/api/org/period-books', { period_id: pA.id, book_id: mektep })).body;
  const eH = (await org('POST', '/api/org/period-books', { period_id: pA.id, book_id: hidden, test_ids: [t1] })).body;
  // The same book on another period is its own entry.
  const eB = (await org('POST', '/api/org/period-books', { period_id: pB.id, book_id: atamura, test_ids: [tB] })).body;
  assert.equal(eB.period_id, pB.id);

  // Students: a book without tests (Мектеп) and an unpublished book are not shown; a draft test is not shown.
  let p = (await pupil('GET', `/api/periods/${pA.slug}`)).body;
  assert.deepEqual(p.books.map((b) => b.id), [eA.id]);
  assert.equal(p.books[0].test_count, 1);
  assert.equal(p.books[0].grade, 8);
  assert.equal(p.books[0].publisher, 'Атамұра');
  assert.ok(p.books[0].cover_id);
  let page = (await pupil('GET', `/api/periods/${pA.slug}/books/${eA.id}`)).body;
  assert.deepEqual(page.tests.map((x) => x.id), [t1]);
  assert.equal(page.book.title, 'Қазақстан тарихы 8 (Атамұра)');
  assert.equal(page.book.book_id, atamura);
  assert.equal((await pupil('GET', `/api/periods/${pA.slug}/books/${eM.id}`)).status, 404, 'a book without tests');
  assert.equal((await pupil('GET', `/api/periods/${pA.slug}/books/${eH.id}`)).status, 404, 'an unpublished book');
  assert.equal((await pupil('GET', `/api/periods/${pA.slug}/books/${eB.id}`)).status, 404, 'an entry of another period');
  assert.equal((await client()('GET', `/api/periods/${pA.slug}/books/${eA.id}`)).status, 401);

  // From the test editor: t2 goes to the Мектеп book; a book of another period is refused.
  assert.equal((await org('PUT', `/api/org/period-books/test/${t2}`, { entry_ids: [eB.id] })).status, 400);
  const linked = await org('PUT', `/api/org/period-books/test/${t2}`, { entry_ids: [eM.id, eA.id] });
  assert.equal(linked.status, 200);
  assert.ok(linked.body.entries.every((e) => e.period_id === pA.id));
  p = (await pupil('GET', `/api/periods/${pA.slug}`)).body;
  assert.deepEqual(p.books.map((b) => [b.id, b.test_count]), [[eA.id, 2], [eM.id, 1]]);
  page = (await pupil('GET', `/api/periods/${pA.slug}/books/${eM.id}`)).body;
  assert.deepEqual(page.tests.map((x) => x.id), [t2]);
  assert.deepEqual(page.other_books.map((b) => b.id), [eA.id]);

  // Editing period A did not touch period B.
  const pb = (await pupil('GET', `/api/periods/${pB.slug}`)).body;
  assert.deepEqual(pb.books.map((b) => [b.id, b.test_count]), [[eB.id, 1]]);

  // Order, replace (tests stay), set tests.
  assert.equal((await org('POST', '/api/org/period-books/reorder', { ids: [eM.id, eA.id, eB.id] })).status, 400, 'two periods');
  assert.equal((await org('POST', '/api/org/period-books/reorder', { ids: [eM.id, eH.id, eA.id] })).status, 200);
  p = (await pupil('GET', `/api/periods/${pA.slug}`)).body;
  assert.deepEqual(p.books.map((b) => b.id), [eM.id, eA.id]);
  assert.equal((await org('PUT', `/api/org/period-books/${eH.id}`, { book_id: mektep })).status, 409);
  const replaced = await org('PUT', `/api/org/period-books/${eH.id}`, { book_id: (await book(org, 'Жаңа кітап', 8, 'Атамұра')) });
  assert.equal(replaced.status, 200);
  assert.deepEqual(replaced.body.test_ids, [t1], 'tests stay when the book is replaced');
  const set = await org('PUT', `/api/org/period-books/${eA.id}`, { test_ids: [t2] });
  assert.deepEqual(set.body.test_ids, [t2]);

  // A hidden test disappears from the book; results and tests themselves are untouched.
  await pupil('POST', `/api/tests/${t2}/attempts`, {});
  assert.equal((await org('POST', `/api/org/tests/${t2}/hide`)).status, 200);
  p = (await pupil('GET', `/api/periods/${pA.slug}`)).body;
  assert.deepEqual(p.books.map((b) => b.id), [eH.id], 'books left with no visible test are hidden');

  // Removing an entry keeps the book and the test; deleting a book or a test cleans its links.
  assert.equal((await org('DELETE', `/api/org/period-books/${eM.id}`)).status, 200);
  assert.equal((await org('GET', `/api/org/books/${mektep}`)).status, 200);
  assert.equal((await org('DELETE', `/api/org/books/${atamura}`)).status, 200);
  let { body: left } = await org('GET', '/api/org/period-books');
  assert.ok(!left.entries.some((e) => e.book_id === atamura), 'entries of a deleted book are gone');
  assert.equal((await org('DELETE', `/api/org/tests/${t1}`)).status, 200);
  ({ body: left } = await org('GET', '/api/org/period-books'));
  assert.ok(!left.entries.some((e) => e.test_ids.includes(t1)), 'links of a deleted test are gone');
});

test('existing books are linked to periods once, by grade and publisher', async () => {
  const { linkExistingBooksOnce } = await import('../server/shelves.js');
  const org = await organizer();
  const { body: st } = await org('GET', '/api/org/state');
  const period = st.periods[2];
  const topic = st.topics.find((t) => t.period_id === period.id);
  const r = await org('POST', '/api/org/tests', { title: '10 Мектеп тесті', topic_id: topic.id, grade: 10, publisher: 'Мектеп', questions: Q });
  assert.equal(r.status, 201);
  assert.equal(r.body.grade, 10);
  const other = await newTest(org, topic.id, 'Тегі жоқ тест');
  const bookId = await book(org, 'Қазақстан тарихы 10', 10, 'Мектеп');

  await linkExistingBooksOnce();
  let { body } = await org('GET', '/api/org/period-books');
  const mine = body.entries.filter((e) => e.book_id === bookId);
  assert.equal(mine.length, 1, 'one entry, only on the period that has matching tests');
  assert.equal(mine[0].period_id, period.id);
  assert.deepEqual(mine[0].test_ids, [r.body.id]);
  assert.ok(!mine[0].test_ids.includes(other));

  // Once only: what the organizer removes stays removed.
  await org('DELETE', `/api/org/period-books/${mine[0].id}`);
  await linkExistingBooksOnce();
  ({ body } = await org('GET', '/api/org/period-books'));
  assert.ok(!body.entries.some((e) => e.book_id === bookId));
});
