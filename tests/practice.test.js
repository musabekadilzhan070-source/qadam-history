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
const { longestStreak, mockVariants, gradeVariant } = await import('../server/practice.js');
const { VARIANTS } = await import('../server/seed/variants.js');
const { DATE_CARDS, PERSON_CARDS } = await import('../server/seed/cards.js');
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

/** The right answer of a question of the cabinet model, in the form a student sends. */
function rightAnswer(q) {
  if (q.type === 'matching') return Object.fromEntries(q.data.pairs.map((p) => [p.key, p.key]));
  if (q.type === 'ordering') return q.data.items.map((i) => i.key);
  return q.options.filter((o) => o.is_correct).map((o) => o.id);
}

test('the ten variants: 50 questions each (A 25, B 15, C 10), 60 points, no question twice, every row cited', () => {
  assert.equal(VARIANTS.length, 10);
  const texts = new Set();
  for (const v of mockVariants()) {
    assert.equal(v.items.length, 50);
    const n = (l) => v.items.filter((x) => x.level === l).length;
    assert.deepEqual([n('A'), n('B'), n('C')], [25, 15, 10]);
    assert.equal(v.items.reduce((s, x) => s + x.q.points, 0), 60);
    assert.ok(v.items.filter((x) => x.level !== 'C').every((x) => x.q.type === 'single' && x.q.options.length === 4));
    assert.ok(v.items.filter((x) => x.level === 'C').every((x) => ['multiple', 'matching', 'ordering'].includes(x.q.type)));
    for (const x of v.items) {
      assert.match(x.q.explanation, /Қазақстан тарихы, \d+-сынып.*бет/, x.q.text);
      const key = `${x.q.type}|${x.q.text}|${JSON.stringify(x.q.options.map((o) => o.text))}|${JSON.stringify(x.q.data)}`;
      assert.ok(!texts.has(key), `repeated: ${x.q.text}`);
      texts.add(key);
    }
  }
  assert.equal(texts.size, 500);
});

test('grading a variant: all right gives 60; C gives 2, 1 for one slip, 0 otherwise', () => {
  const v = mockVariants()[0];
  const all = Object.fromEntries(v.items.map((x) => [x.q.id, rightAnswer(x.q)]));
  const full = gradeVariant(v, all);
  assert.equal(full.score, 60);
  assert.equal(full.percent, 100);
  assert.deepEqual(full.by_level.map((l) => [l.level, l.score, l.max_score]), [['A', 25, 25], ['B', 15, 15], ['C', 20, 20]]);
  assert.equal(full.by_period.reduce((s, p) => s + p.total, 0), 50);

  const order = v.items.find((x) => x.q.type === 'ordering');
  if (order) {
    const keys = rightAnswer(order.q);
    const slip = [keys[1], keys[0], ...keys.slice(2)];
    const r = gradeVariant(v, { ...all, [order.q.id]: slip });
    assert.equal(r.score, 59, 'two neighbours swapped: 1 of 2 points');
    const wrong = gradeVariant(v, { ...all, [order.q.id]: [...keys].reverse() });
    assert.equal(wrong.score, 58);
  }
  const single = v.items.find((x) => x.level === 'A');
  const bad = single.q.options.find((o) => !o.is_correct).id;
  assert.equal(gradeVariant(v, { ...all, [single.q.id]: [bad] }).score, 59);
});

test('a student picks a variant, sits it and keeps the result per variant and level', async () => {
  const s = await student();
  const info = await s('GET', '/api/practice/mock');
  assert.equal(info.status, 200);
  assert.equal(info.body.settings.time_min, 100);
  assert.equal(info.body.variants.length, 10);
  assert.deepEqual(info.body.variants[0].levels, { A: 25, B: 15, C: 10 });
  assert.equal(info.body.variants[0].best, null);

  assert.equal((await s('POST', '/api/practice/mock/start', {})).status, 400);
  assert.equal((await s('POST', '/api/practice/mock/start', { variant: 11 })).status, 400);
  const paper = await s('POST', '/api/practice/mock/start', { variant: 3 });
  assert.equal(paper.status, 200, JSON.stringify(paper.body));
  assert.equal(paper.body.units.length, 50);
  assert.equal(paper.body.max_score, 60);
  assert.equal(paper.body.time_limit_sec, 100 * 60);
  assert.ok(paper.body.units.every((u) => ['A', 'B', 'C'].includes(u.level)));
  assert.ok(!JSON.stringify(paper.body.units).includes('is_correct'), 'no answers handed out');
  const order = paper.body.units.find((u) => u.type === 'ordering');
  if (order) assert.ok(order.items.every((i) => !('date' in i)), 'ordering dates are hidden');

  const v = mockVariants()[2];
  const answers = Object.fromEntries(v.items.map((x, i) => [x.q.id, i === 0 ? [] : rightAnswer(x.q)]));
  const r = await s('POST', '/api/practice/mock/submit', { token: paper.body.token, answers });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.variant, 3);
  assert.equal(r.body.total, 50);
  assert.equal(r.body.correct, 49);
  assert.equal(r.body.score, 59);
  assert.equal(r.body.by_level.find((l) => l.level === 'A').score, 24);
  assert.ok(r.body.items.every((i) => i.level));
  assert.equal(r.body.previous_best, null);

  const again = await s('POST', '/api/practice/mock/submit', { token: paper.body.token, answers });
  assert.equal(again.body.id, r.body.id, 'a double submit keeps one run');
  const after = (await s('GET', '/api/practice/mock')).body;
  assert.equal(after.runs.length, 1);
  assert.equal(after.variants[2].best.score, 59);
  assert.equal(after.variants[2].tries, 1);
  const detail = await s('GET', `/api/practice/mock/${r.body.id}`);
  assert.equal(detail.body.score, 59);
  assert.equal(detail.body.items.length, 50);
  assert.equal(detail.body.by_level.length, 3);

  const other = await student();
  assert.equal((await other('GET', `/api/practice/mock/${r.body.id}`)).status, 404);
  assert.equal((await other('POST', '/api/practice/mock/submit', { token: paper.body.token, answers })).status, 400);
  assert.equal((await other('POST', '/api/practice/mock/submit', { token: 'x.y', answers })).status, 400);
});

test('the organizer sets the time and reads a variant with its answers', async () => {
  const org = await organizer();
  const put = await org('PUT', '/api/org/practice/mock', { time_min: 90 });
  assert.equal(put.status, 200);
  assert.equal(put.body.settings.time_min, 90);
  const s = await student();
  assert.equal((await s('POST', '/api/practice/mock/start', { variant: 1 })).body.time_limit_sec, 90 * 60);
  const seen = (await org('GET', '/api/org/practice/mock')).body;
  assert.equal(seen.settings.time_min, 90);
  assert.equal(seen.variants.length, 10);
  assert.ok(seen.runs.length >= 1);
  const v = await org('GET', '/api/org/practice/mock/variants/1');
  assert.equal(v.status, 200);
  assert.equal(v.body.items.length, 50);
  assert.ok(v.body.items.filter((i) => i.correct_option_ids).every((i) => i.correct_option_ids.length >= 1));
  assert.equal((await org('GET', '/api/org/practice/mock/variants/12')).status, 404);
  assert.equal((await s('GET', '/api/org/practice/mock/variants/1')).status, 401);
  await org('PUT', '/api/org/practice/mock', { time_min: 100 });
});

test('cards: the textbook set is there with sources, Leitner boxes move, the organizer edits', async () => {
  const s = await student();
  const data = (await s('GET', '/api/practice/cards')).body;
  assert.equal(data.cards.length, DATE_CARDS.length + PERSON_CARDS.length);
  assert.ok(data.cards.some((c) => c.kind === 'date') && data.cards.some((c) => c.kind === 'person'));
  assert.ok(data.cards.every((c) => /^Қазақстан тарихы, \d+-сынып/.test(c.source)), 'every card names its book');
  const eset = data.cards.find((c) => c.front === 'Есет Көтібарұлы');
  assert.ok(!/Кіші жүздегі/.test(eset.back), 'Есет is not confused with Сырым Датұлы');
  // Every correction leads to a card of the current set.
  const { CARD_FIXES_V3 } = await import('../server/seed/card-fixes.js');
  for (const f of CARD_FIXES_V3) assert.ok(data.cards.some((c) => c.kind === f[0] && c.front === f[4] && c.back === f[5] && c.note === f[6]), f[4]);
  const card = data.cards.find((c) => c.front === '1465–1466 жылдар');
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
  const made = await org('POST', '/api/org/practice/cards', { kind: 'person', front: 'Тест тұлға', back: 'Кім', period_number: 2, source: 'Оқулық, 5-бет' });
  assert.equal(made.status, 201);
  assert.equal(made.body.card.source, 'Оқулық, 5-бет');
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
  assert.equal(b.badges.find((x) => x.key === 'mock_all').need, 10);

  const paper = (await s('POST', '/api/practice/mock/start', { variant: 5 })).body;
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
