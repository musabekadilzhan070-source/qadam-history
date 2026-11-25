import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qadam-practice-'));
process.env.DB_FILE = path.join(tmp, 'test.sqlite');
// Test-only PIN; the real one is set as an environment variable on the server.
process.env.ORGANIZER_PIN = '908172';
delete process.env.TURSO_DATABASE_URL;
const { app, whenReady } = await import('../server/app.js');
const { longestStreak, pickMock } = await import('../server/practice.js');
const { published } = await import('../server/publish.js');
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
  const email = `p${Math.random().toString(36).slice(2, 8)}@mail.kz`;
  const reg = await call('POST', '/api/auth/register', { display_name: 'Оқушы', email, password: 'secret9', password_confirm: 'secret9' });
  assert.equal(reg.status, 201);
  return call;
}

async function organizer() {
  const call = client();
  assert.equal((await call('POST', '/api/org/login', { pin: '908172' })).status, 200);
  return call;
}

test('a mock exam mixes single-choice questions of every period, grades them and keeps the result', async () => {
  const s = await student();
  const info = await s('GET', '/api/practice/mock');
  assert.equal(info.status, 200);
  assert.deepEqual(info.body.settings, { question_count: 20, time_min: 40 });
  assert.ok(info.body.pool > 0);
  assert.equal(info.body.runs.length, 0);

  const paper = await s('POST', '/api/practice/mock/start');
  assert.equal(paper.status, 200, JSON.stringify(paper.body));
  const n = paper.body.units.length;
  assert.equal(n, Math.min(20, info.body.pool));
  assert.equal(paper.body.time_limit_sec, 40 * 60);
  assert.ok(paper.body.units.every((u) => ['single', 'image'].includes(u.type) && u.options.length >= 2 && !('is_correct' in u.options[0])));
  assert.equal(new Set(paper.body.units.map((u) => u.id)).size, n, 'no question twice');

  // Answer every question correctly by reading the published snapshot (as the grader does).
  const snap = await published();
  const all = new Map(snap.tests.flatMap((t) => t.questions).map((q) => [q.id, q]));
  const answers = Object.fromEntries(paper.body.units.map((u, i) => [u.id, i === 0 ? [] : [all.get(u.id).options.find((o) => o.is_correct).id]]));
  const r = await s('POST', '/api/practice/mock/submit', { token: paper.body.token, answers });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.total, n);
  assert.equal(r.body.correct, n - 1, 'the skipped first question is wrong');
  assert.equal(r.body.score, n - 1);
  assert.equal(r.body.by_period.reduce((a, p) => a + p.total, 0), n);
  assert.ok(r.body.items.every((i) => i.correct_option_ids.length === 1));
  assert.equal(r.body.previous_best, null);

  // A double submit keeps one run.
  const again = await s('POST', '/api/practice/mock/submit', { token: paper.body.token, answers });
  assert.equal(again.body.id, r.body.id);
  const list = (await s('GET', '/api/practice/mock')).body.runs;
  assert.equal(list.length, 1);
  const detail = await s('GET', `/api/practice/mock/${r.body.id}`);
  assert.equal(detail.body.score, n - 1);
  assert.equal(detail.body.items.length, n);

  // Another student cannot open it, nor submit with someone else's paper.
  const other = await student();
  assert.equal((await other('GET', `/api/practice/mock/${r.body.id}`)).status, 404);
  assert.equal((await other('POST', '/api/practice/mock/submit', { token: paper.body.token, answers })).status, 400);
  assert.equal((await other('POST', '/api/practice/mock/submit', { token: 'x.y', answers })).status, 400);
});

test('picking spreads the questions over the periods and prefers fresh ones', async () => {
  const snap = await published();
  const picked = pickMock(snap, 8);
  const periods = new Set(picked.map((x) => x.periodId));
  assert.ok(periods.size >= Math.min(4, snap.periods.length) - 1);
  const first = new Set(picked.map((x) => x.q.id));
  const next = pickMock(snap, 8, first);
  const repeated = next.filter((x) => first.has(x.q.id)).length;
  const pool = snap.tests.flatMap((t) => t.questions).length;
  if (pool >= 16) assert.ok(repeated < 8);
});

test('the organizer sets the number of questions and the time', async () => {
  const org = await organizer();
  const put = await org('PUT', '/api/org/practice/mock', { question_count: 6, time_min: 12 });
  assert.equal(put.status, 200);
  const s = await student();
  const paper = (await s('POST', '/api/practice/mock/start')).body;
  assert.equal(paper.units.length, 6);
  assert.equal(paper.time_limit_sec, 12 * 60);
  const seen = (await org('GET', '/api/org/practice/mock')).body;
  assert.equal(seen.settings.question_count, 6);
  assert.ok(seen.runs.length >= 1);
  await org('PUT', '/api/org/practice/mock', { question_count: 20, time_min: 40 });
});

test('cards: the first set is there, Leitner boxes move, the organizer edits', async () => {
  const s = await student();
  const data = (await s('GET', '/api/practice/cards')).body;
  assert.ok(data.cards.length >= 90);
  assert.ok(data.cards.some((c) => c.kind === 'date') && data.cards.some((c) => c.kind === 'person'));
  const card = data.cards.find((c) => c.front === '1465 жыл');
  assert.equal(card.back, 'Қазақ хандығының құрылуы');

  let p = (await s('POST', `/api/practice/cards/${card.id}/review`, { known: true })).body;
  assert.equal(p.box, 1);
  p = (await s('POST', `/api/practice/cards/${card.id}/review`, { known: true })).body;
  assert.equal(p.box, 2);
  p = (await s('POST', `/api/practice/cards/${card.id}/review`, { known: false })).body;
  assert.equal(p.box, 1);
  assert.equal(p.wrong, 1);
  assert.equal(p.right, 2);
  assert.equal((await s('GET', '/api/practice/cards')).body.progress[card.id].box, 1);

  const org = await organizer();
  const made = await org('POST', '/api/org/practice/cards', { kind: 'person', front: 'Тест тұлға', back: 'Кім', period_number: 2 });
  assert.equal(made.status, 201);
  assert.equal((await org('POST', '/api/org/practice/cards', { kind: 'date', front: '', back: 'x' })).status, 400);
  const id = made.body.card.id;
  assert.ok((await s('GET', '/api/practice/cards')).body.cards.some((c) => c.id === id));
  await org('PUT', `/api/org/practice/cards/${id}`, { kind: 'person', front: 'Тест тұлға', back: 'Кім', period_number: 2, published: false });
  assert.ok(!(await s('GET', '/api/practice/cards')).body.cards.some((c) => c.id === id), 'a hidden card is not shown');
  assert.equal((await s('POST', `/api/practice/cards/${id}/review`, { known: true })).status, 404);
  await org('DELETE', `/api/org/practice/cards/${id}`);
  assert.ok(!(await org('GET', '/api/org/practice/cards')).body.cards.some((c) => c.id === id));
  assert.equal((await s('POST', `/api/org/practice/cards`, { kind: 'date', front: 'a', back: 'b' })).status, 401);
});

test('badges are earned once, with the date, and shown as new until seen', async () => {
  const s = await student();
  let b = (await s('GET', '/api/practice/badges')).body;
  assert.equal(b.earned, 0);
  assert.ok(b.badges.find((x) => x.key === 'first_test'));
  assert.equal(b.badges.find((x) => x.key === 'mock_1').have, 0);

  const paper = (await s('POST', '/api/practice/mock/start')).body;
  await s('POST', '/api/practice/mock/submit', { token: paper.token, answers: {} });
  b = (await s('GET', '/api/practice/badges')).body;
  const mock = b.badges.find((x) => x.key === 'mock_1');
  assert.ok(mock.earned_at);
  assert.ok(b.fresh.some((x) => x.key === 'mock_1'));
  assert.ok(b.badges.find((x) => x.key === 'streak_3').have >= 1);
  await s('POST', '/api/practice/badges/seen');
  b = (await s('GET', '/api/practice/badges')).body;
  assert.equal(b.fresh.length, 0);
  assert.ok(b.badges.find((x) => x.key === 'mock_1').earned_at, 'an earned badge stays');
});

test('the longest streak counts consecutive days', () => {
  assert.equal(longestStreak(new Set()), 0);
  assert.equal(longestStreak(new Set(['2026-01-01'])), 1);
  assert.equal(longestStreak(new Set(['2026-01-01', '2026-01-02', '2026-01-04', '2026-01-05', '2026-01-06'])), 3);
  assert.equal(longestStreak(new Set(['2026-02-28', '2026-03-01'])), 2);
});
