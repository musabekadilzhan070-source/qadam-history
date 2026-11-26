import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qadam-quick-'));
process.env.DB_FILE = path.join(tmp, 'test.sqlite');
process.env.ORGANIZER_PIN = '908172';
delete process.env.TURSO_DATABASE_URL;
const { app, whenReady } = await import('../server/app.js');
const { quickNote, quickLevel, pickQuick } = await import('../server/quick.js');
const { published } = await import('../server/publish.js');
await whenReady();

let server;
let base;
before(() => {
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('levels, notes and the 3-4-3 pick', () => {
  assert.equal(quickLevel({ text: 'Кенесары қай жылы хан сайланды?' }, '1841 жыл'), 'A');
  assert.equal(quickLevel({ text: 'Көтерілістің жеңілу себебі неде?' }, 'Бірліктің жоқтығы'), 'C');
  assert.equal(quickLevel({ text: 'Ереже бойынша жер қалай бөлінді?' }, 'Қыстау және жайлау'), 'B');
  assert.equal(quickNote('1841 жыл. Қазақстан тарихы, 8-сынып, 89-бет.', '1841 жыл'), '', 'a note that repeats the answer is dropped');
  assert.equal(
    quickNote('Үш жүздің өкілдері оны ақ киізге көтеріп хан сайлады. Қазақстан тарихы, 10-сынып, 165-бет.', '1841 жыл', 'Кенесары қай жылы хан сайланды?'),
    'Үш жүздің өкілдері оны ақ киізге көтеріп хан сайлады.',
  );
  const pool = [...Array(5)].map((_, i) => ({ level: 'A', i })).concat([...Array(5)].map((_, i) => ({ level: 'B', i })), [{ level: 'C', i: 0 }]);
  const pick = pickQuick(pool);
  assert.equal(pick.length, 10);
  assert.equal(pickQuick(pool.slice(0, 6)).length, 6, 'a test of ten questions or fewer is shown whole');
  assert.equal(pick.map((q) => q.level).join(''), 'AAAABBBBBC', 'A first, then B, then C; a short level is filled from the others');
});

test('a signed-in student gets ten questions with answers', async () => {
  const jar = [];
  const res = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Qadam': '1' },
    body: JSON.stringify({ display_name: 'Жылдам', email: 'quick@example.com', password: 'secret123', password2: 'secret123' }),
  });
  jar.push(res.headers.get('set-cookie').split(';')[0]);
  const snap = await published();
  const id = snap.tests.find((x) => x.questions.length >= 5).id;
  const got = await fetch(`${base}/api/quick/${id}`, { headers: { Cookie: jar[0] } });
  assert.equal(got.status, 200);
  const data = await got.json();
  assert.ok(data.questions.length > 0 && data.questions.length <= 10);
  assert.ok(data.questions.every((q) => q.answer && ['A', 'B', 'C'].includes(q.level)));
  assert.equal((await fetch(`${base}/api/quick/999999`, { headers: { Cookie: jar[0] } })).status, 404);
  assert.equal((await fetch(`${base}/api/quick/${id}`)).status, 401);
});
