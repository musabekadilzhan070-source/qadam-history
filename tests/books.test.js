import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qadam-books-'));
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

test('books: chunked PDF upload, publishing rules, student access and cleanup', async () => {
  const org = await organizer();
  const pdf = bigPdf();
  // Validation: type, size, order.
  assert.equal((await org('POST', '/api/org/books/uploads', { name: 'a.docx', size: 10 })).status, 400);
  assert.equal((await org('POST', '/api/org/books/uploads', { name: 'a.pdf', size: 200 * CHUNK })).status, 400);
  const bad = await org('POST', '/api/org/books/uploads', { name: 'a.pdf', size: 20 });
  assert.equal((await org('PUT', `/api/org/books/uploads/${bad.body.file_id}/0`, Buffer.from('not a pdf at all!!!!'))).status, 400);

  const fileId = await uploadPdf(org, pdf);
  // Not finished: a book cannot use it yet.
  const cover = await org('POST', '/api/org/files?kind=image', PNG);
  const draft = { title: 'Қазақстан тарихы 7', grade: 7, publisher: 'Атамұра', cover_id: cover.body.id, pdf_id: fileId };
  assert.match((await org('POST', '/api/org/books', draft)).body.error, /толық жүктелмеді/);
  const done = await org('POST', `/api/org/books/uploads/${fileId}/finish`, { page_count: 12 });
  assert.equal(done.status, 200);
  assert.equal(done.body.size, pdf.length);

  assert.equal((await org('POST', '/api/org/books', { ...draft, grade: 4 })).status, 400);
  const created = await org('POST', '/api/org/books', { ...draft, published: true });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.published, true);
  assert.equal(created.body.page_count, 12);
  const bookId = created.body.id;

  // A book without a PDF cannot be published.
  const empty = await org('POST', '/api/org/books', { title: 'Бос кітап' });
  assert.equal((await org('POST', `/api/org/books/${empty.body.id}/publish`, { published: true })).status, 400);

  const s = await student();
  assert.equal((await client()('GET', '/api/books')).status, 401);
  const list = await s('GET', '/api/books');
  assert.deepEqual(list.body.books.map((b) => b.id), [bookId], 'only complete published books');
  const detail = await s('GET', `/api/books/${bookId}`);
  assert.equal(detail.body.pdf.chunks, 3);
  // The chunks put together are the uploaded file.
  const parts = [];
  for (let i = 0; i < 3; i += 1) parts.push((await s('GET', `/api/books/${bookId}/pdf/${fileId}/${i}`)).body);
  assert.ok(Buffer.concat(parts).equals(pdf));
  assert.equal((await s('GET', `/api/files/${fileId}`)).status, 404, 'book PDFs are not public files');
  assert.equal((await s('GET', `/api/books/${empty.body.id}`)).status, 404);

  // Last page is remembered per student.
  assert.equal((await s('POST', `/api/books/${bookId}/progress`, { page: 99 })).status, 400);
  assert.equal((await s('POST', `/api/books/${bookId}/progress`, { page: 5 })).status, 200);
  assert.equal((await s('GET', '/api/books')).body.books[0].last_page, 5);
  const other = await student();
  assert.equal((await other('GET', '/api/books')).body.books[0].last_page, null);

  // Replacing the PDF removes the old one from storage.
  const second = await uploadPdf(org, pdf);
  await org('POST', `/api/org/books/uploads/${second}/finish`, { page_count: 10 });
  const replaced = await org('PUT', `/api/org/books/${bookId}`, { ...draft, pdf_id: second, published: true });
  assert.equal(replaced.body.pdf_id, second);
  assert.equal((await s('GET', `/api/books/${bookId}/pdf/${fileId}/0`)).status, 404);

  // Hidden: students lose access at once.
  await org('POST', `/api/org/books/${bookId}/publish`, { published: false });
  assert.equal((await s('GET', `/api/books/${bookId}`)).status, 404);
  assert.equal((await s('GET', `/api/books/${bookId}/pdf/${second}/0`)).status, 404);

  // Delete: the book, its PDF chunks and its unused cover are gone.
  assert.equal((await org('DELETE', `/api/org/books/${bookId}`)).status, 200);
  assert.equal((await org('GET', '/api/org/books')).body.books.some((b) => b.id === bookId), false);
  const state = (await org('GET', '/api/org/state')).body;
  assert.equal(state.files.some((f) => f.id === cover.body.id), false);
  // Students and guests cannot use the organizer routes.
  assert.equal((await s('POST', '/api/org/books', draft)).status, 401);
});

test('daily report: own data only, reworks apart from tests, books opened vs pages read', async () => {
  const org = await organizer();
  const fileId = await uploadPdf(org, bigPdf());
  await org('POST', `/api/org/books/uploads/${fileId}/finish`, { page_count: 8 });
  const cover = await org('POST', '/api/org/files?kind=image', PNG);
  const book = (await org('POST', '/api/org/books', { title: 'Оқулық', cover_id: cover.body.id, pdf_id: fileId, published: true })).body;

  const s = await student();
  const empty = (await s('GET', '/api/report/daily')).body;
  assert.equal(empty.tests.length + empty.reworks.length + empty.books.length, 0);
  assert.equal(empty.activity.active_sec, 0);
  assert.match(empty.day, /^\d{4}-\d{2}-\d{2}$/);

  const testId = (await s('GET', '/api/tests')).body.tests[0].id;
  for (let k = 0; k < 2; k += 1) {
    const t = (await s('GET', `/api/tests/${testId}`)).body;
    var attempt = (await s('POST', `/api/tests/${testId}`, { token: t.token, answers: {} })).body;
  }
  const rw = (await s('GET', `/api/results/${attempt.attempt_id}/rework`)).body;
  await s('POST', `/api/results/${attempt.attempt_id}/rework`, { token: rw.token, answers: {} });
  await s('POST', `/api/books/${book.id}/open`);
  // Activity beats on page 3 (each covers up to two 15-second slots); a second tab adds nothing new.
  for (let k = 0; k < 2; k += 1) assert.equal((await s('POST', '/api/activity', { kind: 'book', book_id: book.id, page: 3, continuous: true })).status, 200);

  const r = (await s('GET', '/api/report/daily')).body;
  assert.equal(r.tests.length, 1);
  assert.equal(r.tests[0].times, 2);
  assert.equal(r.reworks.length, 1);
  assert.equal(r.reworks[0].times, 1);
  assert.equal(r.activity.tests_done, 2);
  assert.equal(r.activity.reworks_done, 1);
  assert.equal(r.books.length, 1);
  assert.equal(r.books[0].title, 'Оқулық');
  assert.ok(r.activity.active_sec >= 15 && r.activity.active_sec <= 30, String(r.activity.active_sec));
  // At most 30 s on the page: counted as read only when it reached 30 s.
  assert.equal(r.books[0].pages_read, r.books[0].reading_sec >= 30 ? 1 : 0);

  const other = await student();
  const theirs = (await other('GET', '/api/report/daily')).body;
  assert.equal(theirs.tests.length + theirs.reworks.length + theirs.books.length, 0);
  assert.equal((await other('GET', '/api/report/daily?day=2999-01-01')).status, 400);
  assert.equal((await client()('GET', '/api/report/daily')).status, 401);
  assert.equal((await other('POST', '/api/activity', { kind: 'book', book_id: 99999 })).status, 404);
});

test('Almaty days', async () => {
  const { dayOf, utcRangeOf } = await import('../server/almaty.js');
  assert.equal(dayOf(Date.parse('2026-10-31T18:59:59Z')), '2026-10-31');
  assert.equal(dayOf(Date.parse('2026-10-31T19:00:00Z')), '2026-11-01');
  assert.deepEqual(utcRangeOf('2026-11-01'), ['2026-10-31 19:00:00', '2026-11-01 19:00:00']);
});
