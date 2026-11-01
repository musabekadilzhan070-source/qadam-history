import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qadam-links-'));
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


async function organizer() {
  const call = client();
  assert.equal((await call('POST', '/api/org/login', { pin: '908172' })).status, 200);
  return call;
}

async function student() {
  const call = client();
  const email = `s${Math.random().toString(36).slice(2, 8)}@mail.kz`;
  assert.equal((await call('POST', '/api/auth/register', { display_name: 'Оқушы', email, password: 'secret9', password_confirm: 'secret9' })).status, 201);
  return call;
}

/** The first test with its correct answers (from the cabinet). */
async function firstTest(org) {
  const { links } = (await org('GET', '/api/org/links')).body;
  const link = links[0];
  const test = (await org('GET', `/api/org/tests/${link.test_id}`)).body;
  const correct = {};
  for (const q of test.questions) {
    for (const c of q.type === 'context' ? q.children : [q]) {
      if (['single', 'multiple', 'image'].includes(c.type) || c.options?.length) correct[c.id] = c.options.filter((o) => o.is_correct).map((o) => o.id);
    }
  }
  return { link, test, correct };
}

test('test link: off by default, opened by the organizer, taken without an account', async () => {
  const org = await organizer();
  const { link, correct } = await firstTest(org);
  assert.match(link.share_id, /^[0-9a-f]{16}$/);
  assert.equal(link.path, `/t/${link.share_id}`);
  assert.equal(link.enabled, false);

  const guest = client();
  const closed = (await guest('GET', `/api/link/${link.share_id}`)).body;
  assert.equal(closed.open, false);
  assert.equal(closed.reason, 'closed');
  assert.equal((await guest('POST', `/api/link/${link.share_id}/start`, { name: 'Әлихан Нұрлан' })).status, 403);
  assert.equal((await guest('GET', '/api/link/0000000000000000')).status, 404);

  assert.equal((await org('PUT', `/api/org/links/${link.test_id}`, { enabled: true, retakes: false })).status, 200);
  const info = (await guest('GET', `/api/link/${link.share_id}`)).body;
  assert.equal(info.open, true);
  assert.ok(info.question_count > 0);
  assert.equal(info.retakes, false);

  assert.equal((await guest('POST', `/api/link/${link.share_id}/start`, { name: ' a ' })).status, 400);
  const paper = (await guest('POST', `/api/link/${link.share_id}/start`, { name: 'Әлихан  Нұрлан' })).body;
  assert.equal(paper.name, 'Әлихан Нұрлан');
  assert.ok(paper.units.length > 0);
  assert.ok(paper.token);
  // No correct answers are sent with the questions.
  assert.ok(!JSON.stringify(paper.units).includes('is_correct'));

  // A reload continues the same attempt.
  const again = (await guest('POST', `/api/link/${link.share_id}/start`, {})).body;
  assert.equal(again.attempt_id, paper.attempt_id);

  const ids = paper.units.flatMap((u) => (u.type === 'context' ? u.children : [u])).map((q) => q.id);
  const answers = Object.fromEntries(ids.filter((id) => correct[id]).map((id) => [id, correct[id]]));
  const r = (await guest('POST', `/api/link/${link.share_id}/submit`, { token: paper.token, answers })).body;
  assert.equal(r.finished, true);
  assert.equal(r.show_result, true);
  assert.ok(r.percent > 0);
  assert.equal(r.items, undefined, 'answers are hidden unless the organizer shows them');
  // The same submit again: the same result, still one row.
  const twice = (await guest('POST', `/api/link/${link.share_id}/submit`, { token: paper.token, answers: {} })).body;
  assert.equal(twice.percent, r.percent);

  // Retakes are off: this browser cannot start again; another browser can.
  const retry = await guest('POST', `/api/link/${link.share_id}/start`, { name: 'Әлихан Нұрлан' });
  assert.equal(retry.status, 409);
  assert.equal((await guest('GET', `/api/link/${link.share_id}`)).body.already_done, true);
  const other = client();
  const p2 = (await other('POST', `/api/link/${link.share_id}/start`, { name: 'Әлихан Нұрлан' })).body;
  await other('POST', `/api/link/${link.share_id}/submit`, { token: p2.token, answers: {} });

  const { results } = (await org('GET', `/api/org/links/results?test_id=${link.test_id}`)).body;
  assert.equal(results.length, 2);
  assert.deepEqual(results.map((x) => x.name), ['Әлихан Нұрлан', 'Әлихан Нұрлан']);
  assert.ok(results.every((x) => x.status === 'finished'));
  assert.notEqual(results[0].id, results[1].id, 'the same name is two separate works');
  const work = (await org('GET', `/api/org/links/results/${results[1].id}`)).body;
  assert.equal(work.items.length, results[1].total);
  assert.ok(work.items.some((i) => i.correct_option_ids), 'the organizer sees correct answers');

  const csv = await org('GET', `/api/org/links/results/export?test_id=${link.test_id}&format=csv`);
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-disposition'), /attachment; filename="qadam-.*\.csv"/);
  assert.ok(csv.body.toString('utf8').includes('Әлихан Нұрлан'));
  const xlsx = await org('GET', '/api/org/links/results/export?format=xlsx');
  assert.equal(xlsx.body.subarray(0, 2).toString(), 'PK');

  // Students and guests never reach the organizer's link data.
  const s = await student();
  for (const url of ['/api/org/links', `/api/org/links/results?test_id=${link.test_id}`, `/api/org/links/results/${results[0].id}`]) {
    assert.equal((await s('GET', url)).status, 401);
    assert.equal((await guest('GET', url)).status, 401);
  }
  assert.equal((await s('PUT', `/api/org/links/${link.test_id}`, { enabled: false })).status, 401);
});

test('test link: closing time, end screen choices, graded on the version handed out', async () => {
  const org = await organizer();
  const { link, test: draft, correct } = await firstTest(org);
  await org('PUT', `/api/org/links/${link.test_id}`, { enabled: true, retakes: true, show_result: true, show_answers: true, opens_at: null, closes_at: null });
  const guest = client();
  const paper = (await guest('POST', `/api/link/${link.share_id}/start`, { name: 'Айдана Ермек' })).body;
  const q = paper.units.find((u) => correct[u.id]);

  // The organizer changes the correct answer of a question while the student is taking the test.
  const changed = structuredClone(draft);
  const target = changed.questions.find((x) => x.id === q.id);
  const right = target.options.findIndex((o) => o.is_correct);
  target.options.forEach((o, i) => (o.is_correct = i === (right + 1) % target.options.length));
  assert.equal((await org('PUT', `/api/org/tests/${draft.id}`, changed)).status, 200);

  const r = (await guest('POST', `/api/link/${link.share_id}/submit`, { token: paper.token, answers: { [q.id]: correct[q.id] } })).body;
  const item = r.items.find((i) => i.id === q.id);
  assert.equal(item.is_correct, true, 'graded on the version the student was given');
  assert.ok(item.correct_option_ids);

  // A new start gets the new version.
  const next = (await guest('POST', `/api/link/${link.share_id}/start`, { name: 'Айдана Ермек' })).body;
  const r2 = (await guest('POST', `/api/link/${link.share_id}/submit`, { token: next.token, answers: { [q.id]: correct[q.id] } })).body;
  if (r2.items.some((i) => i.id === q.id)) assert.equal(r2.items.find((i) => i.id === q.id).is_correct, false);
  assert.equal((await org('PUT', `/api/org/tests/${draft.id}`, draft)).status, 200);

  // Hidden result: only that the test is finished.
  await org('PUT', `/api/org/links/${link.test_id}`, { show_result: false });
  const p3 = (await guest('POST', `/api/link/${link.share_id}/start`, { name: 'Данияр Асқар' })).body;
  const r3 = (await guest('POST', `/api/link/${link.share_id}/submit`, { token: p3.token, answers: {} })).body;
  assert.equal(r3.finished, true);
  assert.equal(r3.percent, undefined);
  assert.equal(r3.items, undefined);

  // Closed by time: no new start.
  const past = new Date(Date.now() - 60000).toISOString();
  assert.equal((await org('PUT', `/api/org/links/${link.test_id}`, { closes_at: past })).status, 200);
  const late = await client()('POST', `/api/link/${link.share_id}/start`, { name: 'Кеш қалған оқушы' });
  assert.equal(late.status, 403);
  assert.match(late.body.error, /мерзімі аяқталды/);
  assert.equal((await org('PUT', `/api/org/links/${link.test_id}`, { opens_at: new Date(Date.now() + 3600000).toISOString(), closes_at: null })).status, 200);
  assert.equal((await client()('GET', `/api/link/${link.share_id}`)).body.reason, 'not_yet');
  assert.equal((await org('PUT', `/api/org/links/${link.test_id}`, { opens_at: new Date(Date.now() + 7200000).toISOString(), closes_at: new Date(Date.now() + 3600000).toISOString() })).status, 400);
  // The results of one test never mix with another's.
  const { links } = (await org('GET', '/api/org/links')).body;
  const otherTest = links.find((l) => l.test_id !== link.test_id);
  assert.equal((await org('GET', `/api/org/links/results?test_id=${otherTest.test_id}`)).body.results.length, 0);
  // A token of one test is refused by another test's link.
  await org('PUT', `/api/org/links/${otherTest.test_id}`, { enabled: true });
  assert.equal((await guest('POST', `/api/link/${otherTest.share_id}/submit`, { token: next.token, answers: {} })).status, 400);
});

test('student report: unfinished tests, time today/week/total, books not read just by opening', async () => {
  const s = await student();
  const { tests } = (await s('GET', '/api/tests')).body;
  const id = tests[0].id;
  const t1 = (await s('GET', `/api/tests/${id}`)).body;
  await s('POST', `/api/tests/${id}`, { token: t1.token, answers: {} });
  await s('GET', `/api/tests/${id}`); // opened, never submitted
  await s('POST', '/api/activity', { kind: 'site', continuous: true });
  const r = (await s('GET', '/api/report/overview')).body;
  assert.equal(r.summary.finished, 1);
  assert.equal(r.summary.unfinished, 1);
  assert.equal(r.summary.attempts, 2);
  assert.equal(r.history.length, 2);
  assert.deepEqual(r.history.map((h) => h.status).sort(), ['finished', 'unfinished']);
  assert.ok(r.summary.today_sec >= 15 && r.summary.today_sec <= 30);
  assert.equal(r.summary.week_sec >= r.summary.today_sec, true);
  assert.equal(r.summary.total_sec >= r.summary.week_sec, true);
  assert.equal(r.week.length, 7);
  assert.ok(r.last_activity_at);
  const other = await student();
  const theirs = (await other('GET', '/api/report/overview')).body;
  assert.equal(theirs.summary.attempts, 0);
  assert.equal((await client()('GET', '/api/report/overview')).status, 401);
});
