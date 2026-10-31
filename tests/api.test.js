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

async function signedIn(email = `u${Math.random().toString(36).slice(2, 8)}@mail.kz`) {
  const call = client();
  const reg = await call('POST', '/api/auth/register', { display_name: 'Оқушы', email, password: 'secret1', password_confirm: 'secret1' });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  return call;
}

test('content needs a signed-in account', async () => {
  const guest = client();
  for (const path of ['/api/overview', '/api/periods/orta-gasyr', '/api/tests', '/api/tests/1', '/api/feedback']) {
    assert.equal((await guest('GET', path)).status, 401, path);
  }
  assert.equal((await guest('GET', '/api/site')).status, 200);
});

test('overview counts come from the database', async () => {
  const call = await signedIn();
  const { body } = await call('GET', '/api/overview');
  assert.equal(body.periods.length, 4);
  assert.deepEqual(body.periods.map((p) => p.title), ['Ежелгі заман', 'Орта ғасыр', 'Жаңа заман', 'Қазіргі заман']);
  const sum = body.periods.reduce((s, p) => s + p.question_count, 0);
  assert.equal(sum, body.totals.questions);
  for (const p of body.periods) assert.ok(p.topic_count > 0 && p.test_count > 0);
  assert.ok(body.tests.length > 0);
});

test('period pages resolve, unknown slugs 404, every topic has an emblem and a test link', async () => {
  const call = await signedIn();
  const period = await call('GET', '/api/periods/orta-gasyr');
  assert.equal(period.status, 200);
  assert.ok(period.body.topics.length > 0);
  assert.ok(period.body.topics.every((t) => t.icon?.kind === 'emblem'));
  assert.ok(period.body.topics.every((t) => t.first_test_id));
  assert.equal(period.body.topics[0].body, undefined);
  assert.equal((await call('GET', '/api/periods/nope')).status, 404);
});

test('topic reading pages and materials are gone from the student API', async () => {
  const call = await signedIn();
  assert.equal((await call('GET', '/api/topics')).status, 404);
  assert.equal((await call('GET', '/api/topics/kazak-handygynyn-kuryluy')).status, 404);
});

test('materials are gone from the student API', async () => {
  const call = await signedIn();
  assert.equal((await call('GET', '/api/materials')).status, 404);
  assert.equal((await call('GET', '/api/materials/1')).status, 404);
});

async function topicTestId(call) {
  const { body } = await call('GET', '/api/topics/kazak-handygynyn-kuryluy/test');
  return body.test_id;
}

test('test questions never include correct answers', async () => {
  const call = await signedIn();
  const id = await topicTestId(call);
  assert.ok(id);
  const { body } = await call('GET', `/api/tests/${id}`);
  assert.equal(body.units.length, 5);
  assert.equal(body.question_count, 5);
  assert.ok(body.token);
  assert.ok(body.units.every((q) => q.multiple === false));
  assert.doesNotMatch(JSON.stringify(body), /is_correct|correct_option/);
});

test('attempts are graded with a session token, saved and private', async () => {
  const student = await signedIn('oqushy1@mail.kz');
  const id = await topicTestId(student);
  const { body: t } = await student('GET', `/api/tests/${id}`);
  const answers = Object.fromEntries(t.units.map((q) => [q.id, q.options[0].id]));
  assert.equal((await student('POST', `/api/tests/${id}`, { answers })).status, 400, 'no token');
  assert.equal((await student('POST', `/api/tests/${id}`, { answers, token: t.token + 'x' })).status, 400, 'forged token');
  const graded = await student('POST', `/api/tests/${id}`, { answers, token: t.token });
  assert.equal(graded.status, 200);
  assert.equal(graded.body.total, 5);
  assert.equal(graded.body.items.length, 5);

  // Find the right answers from the review, then score 100%.
  const right = Object.fromEntries(graded.body.items.map((i) => [i.id, i.correct_option_ids]));
  const { body: t2 } = await student('GET', `/api/tests/${id}`);
  const full = await student('POST', `/api/tests/${id}`, { answers: right, token: t2.token });
  assert.equal(full.body.saved, true);
  assert.equal(full.body.percent, 100);
  assert.equal(full.body.passed, true);

  const results = await student('GET', '/api/results');
  assert.equal(results.body.summary.attempts, 2);
  assert.equal(results.body.attempts[0].percent, 100);
  const detail = await student('GET', `/api/results/${full.body.attempt_id}`);
  assert.equal(detail.status, 200);
  assert.ok(detail.body.items.every((i) => i.is_correct));

  const other = await signedIn('oqushy2@mail.kz');
  assert.equal((await other('GET', `/api/results/${full.body.attempt_id}`)).status, 404);
  assert.equal((await client()('GET', '/api/results')).status, 401);
});

test('registration checks email, passwords and duplicates', async () => {
  const call = client();
  const reg = (b) => call('POST', '/api/auth/register', { display_name: 'Әділ Жан', password: 'secret1', password_confirm: 'secret1', ...b });
  assert.match((await reg({ email: 'adil@gmail' })).body.error, /форматы қате/);
  assert.match((await reg({ email: 'adil@gmail.com', password_confirm: 'other11' })).body.error, /сәйкес келмейді/);
  assert.match((await reg({ email: 'adil@gmail.com', password: '123', password_confirm: '123' })).body.error, /кемінде 6/);
  assert.match((await reg({ email: 'adil@gmail.com', display_name: 'A' })).body.error, /Аты-жөніңізді/);
  assert.equal((await reg({ email: 'Adil@Gmail.com' })).status, 201);
  assert.equal((await client()('POST', '/api/auth/register', { display_name: 'Басқа', email: 'adil@gmail.com', password: 'secret1', password_confirm: 'secret1' })).status, 409);
});

test('login with email or login, profile update, password change and logout', async () => {
  const call = client();
  await call('POST', '/api/auth/register', { email: 'oqushy3@mail.kz', display_name: 'Оқушы Үш', password: 'secret3', password_confirm: 'secret3' });
  assert.equal((await call('PATCH', '/api/me', { display_name: 'Жаңа Есім' })).body.user.display_name, 'Жаңа Есім');
  assert.equal((await call('POST', '/api/me/password', { current_password: 'wrong', new_password: 'newpass1' })).status, 400);
  assert.equal((await call('POST', '/api/me/password', { current_password: 'secret3', new_password: 'newpass1' })).status, 200);
  await call('POST', '/api/auth/logout');
  assert.equal((await call('GET', '/api/me')).body.user, null);
  assert.equal((await call('POST', '/api/auth/login', { login: 'oqushy3@mail.kz', password: 'secret3' })).status, 401);
  assert.match((await call('POST', '/api/auth/login', { login: 'oqushy3@mail', password: 'newpass1' })).body.error, /форматы қате/);
  const ok = await call('POST', '/api/auth/login', { login: 'OQUSHY3@mail.kz', password: 'newpass1' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.email, 'oqushy3@mail.kz');
});

test('older accounts with a plain login still sign in', async () => {
  const call = client();
  assert.equal((await call('POST', '/api/auth/register', { username: 'eski_login', display_name: 'Ескі Аккаунт', password: 'secret4' })).status, 201);
  await call('POST', '/api/auth/logout');
  assert.equal((await call('POST', '/api/auth/login', { username: 'eski_login', password: 'secret4' })).status, 200);
});

test('password reset by email answers clearly when mail is not set up', async () => {
  const call = client();
  assert.equal((await call('GET', '/api/auth/options')).body.email_reset, false);
  const res = await call('POST', '/api/auth/forgot', { email: 'oqushy1@mail.kz' });
  assert.equal(res.status, 503);
  assert.match(res.body.error, /организатор/);
  assert.equal((await call('POST', '/api/auth/reset', { token: 'nope', password: 'secret9', password_confirm: 'secret9' })).status, 400);
});

test('state-changing requests need the CSRF header', async () => {
  const res = await fetch(`${base}/api/auth/logout`, { method: 'POST' });
  assert.equal(res.status, 403);
});

test('removed game routes do not exist', async () => {
  const call = await signedIn();
  for (const path of ['/api/live', '/api/games', '/api/timeline', '/api/map']) {
    assert.equal((await call('GET', path)).status, 404);
  }
});

test('working on mistakes serves only wrong questions and keeps the original result', async () => {
  const student = await signedIn();
  const id = await topicTestId(student);
  const { body: t } = await student('GET', `/api/tests/${id}`);
  const first = await student('POST', `/api/tests/${id}`, { answers: {}, token: t.token });
  const right = Object.fromEntries(first.body.items.map((i) => [i.id, i.correct_option_ids]));
  // Answer two right, the rest wrong.
  const { body: t2 } = await student('GET', `/api/tests/${id}`);
  const ids = t2.units.map((q) => q.id);
  const partial = await student('POST', `/api/tests/${id}`, { answers: { [ids[0]]: right[ids[0]], [ids[1]]: right[ids[1]] }, token: t2.token });
  assert.equal(partial.body.correct, 2);

  const rw = await student('GET', `/api/results/${partial.body.attempt_id}/rework`);
  assert.equal(rw.status, 200);
  assert.equal(rw.body.question_count, 3);
  assert.deepEqual(rw.body.units.map((u) => u.id).sort(), ids.slice(2).sort());
  assert.doesNotMatch(JSON.stringify(rw.body.units), /is_correct|correct_option/);
  // A test token is not a rework token, and a rework token is bound to its attempt.
  assert.equal((await student('POST', `/api/results/${partial.body.attempt_id}/rework`, { answers: {}, token: t2.token })).status, 400);
  assert.equal((await student('POST', `/api/results/${first.body.attempt_id}/rework`, { answers: {}, token: rw.body.token })).status, 400);

  const done = await student('POST', `/api/results/${partial.body.attempt_id}/rework`, { answers: right, token: rw.body.token });
  assert.equal(done.status, 200);
  assert.equal(done.body.kind, 'rework');
  assert.equal(done.body.total, 3);
  assert.equal(done.body.percent, 100);

  const original = await student('GET', `/api/results/${partial.body.attempt_id}`);
  assert.equal(original.body.correct, 2);
  assert.equal(original.body.reworks.length, 1);
  assert.equal(original.body.can_rework, true);
  // Nothing wrong in a perfect rework: no rework of it.
  const again = await student('GET', `/api/results/${done.body.attempt_id}/rework`);
  assert.equal(again.status, 400);
  assert.match(again.body.error, /Жарайсың/);

  const results = await student('GET', '/api/results');
  assert.equal(results.body.summary.attempts, 2, 'reworks are not test attempts');
  assert.equal(results.body.summary.reworks, 1);
  assert.equal(results.body.attempts.length, 3, 'every attempt is kept');
  const tests = await student('GET', '/api/tests');
  assert.equal(tests.body.tests.find((x) => x.id === id).attempts, 2);

  const other = await signedIn();
  assert.equal((await other('GET', `/api/results/${partial.body.attempt_id}/rework`)).status, 404);
});
