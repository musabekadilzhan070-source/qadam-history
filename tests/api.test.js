import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qadam-test-'));
process.env.DB_FILE = path.join(tmp, 'test.sqlite');
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
  return async (method, path, body) => {
    const headers = { 'Content-Type': 'application/json' };
    if (method !== 'GET') headers['X-Qadam'] = '1';
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
}

test('overview counts come from the database', async () => {
  const call = client();
  const { body } = await call('GET', '/api/overview');
  assert.equal(body.periods.length, 4);
  assert.deepEqual(body.periods.map((p) => p.title), ['Ежелгі заман', 'Орта ғасыр', 'Жаңа заман', 'Қазіргі заман']);
  const sum = body.periods.reduce((s, p) => s + p.question_count, 0);
  assert.equal(sum, body.totals.questions);
  for (const p of body.periods) assert.ok(p.topic_count > 0 && p.test_count > 0);
});

test('period and topic pages resolve, unknown slugs 404', async () => {
  const call = client();
  const period = await call('GET', '/api/periods/orta-gasyr');
  assert.equal(period.status, 200);
  assert.ok(period.body.topics.length > 0);
  const topic = await call('GET', `/api/topics/${period.body.topics[0].slug}`);
  assert.equal(topic.status, 200);
  assert.ok(topic.body.body.length > 100);
  assert.equal((await call('GET', '/api/periods/nope')).status, 404);
  assert.equal((await call('GET', '/api/topics/nope')).status, 404);
});

async function topicTestId(call) {
  const { body } = await call('GET', '/api/topics/kazak-handygynyn-kuryluy/test');
  return body.test_id;
}

test('test questions never include correct answers', async () => {
  const call = client();
  const id = await topicTestId(call);
  assert.ok(id);
  const { body } = await call('GET', `/api/tests/${id}`);
  assert.equal(body.questions.length, 5);
  assert.ok(body.questions.every((q) => q.multiple === false));
  assert.doesNotMatch(JSON.stringify(body), /is_correct|correct_option/);
});

test('guest grading works but is not saved; signed-in attempts are saved and private', async () => {
  const guest = client();
  const id = await topicTestId(guest);
  const { body: t } = await guest('GET', `/api/tests/${id}`);
  const answers = Object.fromEntries(t.questions.map((q) => [q.id, q.options[0].id]));
  const graded = await guest('POST', `/api/tests/${id}`, { answers, duration_sec: 42 });
  assert.equal(graded.status, 200);
  assert.equal(graded.body.saved, false);
  assert.equal(graded.body.total, 5);
  assert.equal(graded.body.items.length, 5);

  // Find the right answers from the review, then score 100%.
  const right = Object.fromEntries(graded.body.items.map((i) => [i.id, i.correct_option_ids]));
  const student = client();
  const reg = await student('POST', '/api/auth/register', { username: 'oqushy1', display_name: 'Оқушы Бір', password: 'secret1' });
  assert.equal(reg.status, 201);
  const full = await student('POST', `/api/tests/${id}`, { answers: right });
  assert.equal(full.body.saved, true);
  assert.equal(full.body.percent, 100);

  const results = await student('GET', '/api/results');
  assert.equal(results.body.summary.attempts, 1);
  assert.equal(results.body.attempts[0].percent, 100);
  const detail = await student('GET', `/api/results/${full.body.attempt_id}`);
  assert.equal(detail.status, 200);
  assert.ok(detail.body.items.every((i) => i.is_correct));

  const other = client();
  await other('POST', '/api/auth/register', { username: 'oqushy2', display_name: 'Оқушы Екі', password: 'secret2' });
  assert.equal((await other('GET', `/api/results/${full.body.attempt_id}`)).status, 404);
  assert.equal((await guest('GET', '/api/results')).status, 401);
});

test('login, profile update, password change and logout', async () => {
  const call = client();
  await call('POST', '/api/auth/register', { username: 'oqushy3', display_name: 'Оқушы Үш', password: 'secret3' });
  assert.equal((await call('POST', '/api/auth/register', { username: 'OQUSHY3', display_name: 'Х', password: 'secret3' })).status, 400);
  assert.equal((await call('PATCH', '/api/me', { display_name: 'Жаңа Есім' })).body.user.display_name, 'Жаңа Есім');
  assert.equal((await call('POST', '/api/me/password', { current_password: 'wrong', new_password: 'newpass1' })).status, 400);
  assert.equal((await call('POST', '/api/me/password', { current_password: 'secret3', new_password: 'newpass1' })).status, 200);
  await call('POST', '/api/auth/logout');
  assert.equal((await call('GET', '/api/me')).body.user, null);
  assert.equal((await call('POST', '/api/auth/login', { username: 'oqushy3', password: 'secret3' })).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { username: 'oqushy3', password: 'newpass1' })).status, 200);
});

test('state-changing requests need the CSRF header', async () => {
  const res = await fetch(`${base}/api/auth/logout`, { method: 'POST' });
  assert.equal(res.status, 403);
});

test('removed game routes do not exist', async () => {
  const call = client();
  for (const path of ['/api/live', '/api/games', '/api/timeline', '/api/map']) {
    assert.equal((await call('GET', path)).status, 404);
  }
});
