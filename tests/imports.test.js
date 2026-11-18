import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qadam-imports-'));
process.env.DB_FILE = path.join(tmp, 'test.sqlite');
// Test-only PIN; the real one is set as an environment variable on the server.
process.env.ORGANIZER_PIN = '908172';
delete process.env.TURSO_DATABASE_URL;
delete process.env.QADAM_IMPORTS;
delete process.env.VERCEL_ENV;
const { app, whenReady } = await import('../server/app.js');
await whenReady();
const { runImportsOnce, titleKey } = await import('../server/imports.js');
const { rowsToQuestions } = await import('../server/transfer.js');
const { get, all } = await import('../server/db.js');
const pack = (await import('../server/imports/history-8-modern.js')).default;

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

test('titles match without the § prefix, case and Latin/Cyrillic look-alikes', () => {
  assert.equal(titleKey('§7–8. ХVІІІ ғасырдың басындағы қазақ-орыс қарым-қатынасы'), titleKey('XVIII ғасырдың басындағы қазақ-орыс қарым-қатынасы'));
  assert.notEqual(titleKey('Абай Құнанбайұлы'), titleKey('Шоқан Уәлиханов'));
});

test('8th-grade pack: new topics go to Жаңа заман and go live, imported ones are skipped and moved', async () => {
  const org = client();
  assert.equal((await org('POST', '/api/org/login', { pin: '908172' })).status, 200);
  const { body: st } = await org('GET', '/api/org/state');
  const modern = st.periods.find((p) => p.slug === 'zhana-zaman');
  const middle = st.periods.find((p) => p.slug === 'orta-gasyr');

  // Already imported, but in another period: §11–12 with most of its questions.
  const abylai = pack.find((p) => p.section === '§11–12');
  const t1 = await org('POST', '/api/org/topics', { period_id: middle.id, title: `${abylai.section}. ${abylai.title}`, grade: 8, publisher: 'Мектеп', published: true });
  assert.equal(t1.status, 201, JSON.stringify(t1.body));
  const qs = rowsToQuestions(abylai.rows).questions.slice(0, 30);
  const x1 = await org('POST', '/api/org/tests', { topic_id: t1.body.id, title: 'Абылай хан', questions: qs });
  assert.equal(x1.status, 201, JSON.stringify(x1.body));
  assert.equal((await org('POST', `/api/org/tests/${x1.body.id}/publish`)).status, 200);
  // A topic with the same title (Latin XVIII) but no questions yet: the test is added to it.
  const folk = pack.find((p) => p.section === '§13–14');
  const t2 = await org('POST', '/api/org/topics', { period_id: modern.id, title: 'XVIII ғасырдағы халық ауыз әдебиеті', grade: 8, publisher: 'Мектеп', published: true });
  assert.equal(t2.status, 201);
  // Something else in the draft that is not published must stay unpublished.
  const draft = await org('POST', '/api/org/topics', { period_id: middle.id, title: 'Жоба тақырып', grade: 7, publisher: 'Атамұра', published: true });

  const topicsBefore = (await get('SELECT COUNT(*) AS n FROM topics')).n;
  process.env.QADAM_IMPORTS = '1';
  try {
    await runImportsOnce(['history-8-modern-2026-11']);
  } finally {
    delete process.env.QADAM_IMPORTS;
  }
  const row = await get("SELECT status, report FROM content_imports WHERE key = 'history-8-modern-2026-11'");
  assert.equal(row.status, 'done');
  const report = JSON.parse(row.report);
  assert.equal(report.imported.length, 26);
  assert.deepEqual(report.skipped, [`${abylai.section}. ${abylai.title}`]);
  assert.deepEqual(report.moved, [`${abylai.section}. ${abylai.title}`]);
  assert.equal(report.publisher, 'Мектеп', 'publisher taken from the topics already on the site');
  assert.equal(report.live, 26);
  assert.equal((await get('SELECT COUNT(*) AS n FROM topics')).n, topicsBefore + 25, '§13–14 reused its topic');
  assert.equal((await get('SELECT period_id FROM topics WHERE id = ?', t1.body.id)).period_id, modern.id);
  assert.equal((await all('SELECT id FROM tests WHERE topic_id = ?', t2.body.id)).length, 1);

  // Students see every topic of the pack under Жаңа заман, each with its test.
  const pupil = client();
  assert.equal((await pupil('POST', '/api/auth/register', { display_name: 'Оқушы', email: 'imp@mail.kz', password: 'secret9', password_confirm: 'secret9' })).status, 201);
  const period = (await pupil('GET', '/api/periods/zhana-zaman')).body;
  const titles = new Set(period.topics.map((t) => titleKey(t.title)));
  for (const p of pack) assert.ok(titles.has(titleKey(p.title)), p.title);
  const { body: list } = await pupil('GET', '/api/tests');
  const all8 = (list.tests || list).filter((x) => pack.some((p) => titleKey(p.title) === titleKey(x.title)));
  assert.equal(all8.length, 26);
  const total = pack.filter((p) => p !== abylai).reduce((n, p) => n + rowsToQuestions(p.rows).questions.length, 0);
  assert.equal(total, 904 - 39);
  assert.equal(all8.reduce((n, x) => n + x.question_count, 0), total, 'every question is live');
  const middleTopics = (await pupil('GET', '/api/periods/orta-gasyr')).body.topics.map((t) => t.id);
  assert.ok(!middleTopics.includes(t1.body.id), 'moved topic is no longer in Орта ғасыр');
  assert.ok(!middleTopics.includes(draft.body.id), 'unrelated draft topic stays unpublished');

  // Runs once: a second start changes nothing.
  process.env.QADAM_IMPORTS = '1';
  try {
    await runImportsOnce(['history-8-modern-2026-11']);
  } finally {
    delete process.env.QADAM_IMPORTS;
  }
  assert.equal((await get('SELECT COUNT(*) AS n FROM topics')).n, topicsBefore + 25);
});

test('8th-grade Мектеп pack: its own topics next to the Атамұра ones, with the batyr helmet emblem', async () => {
  const mektep = (await import('../server/imports/history-8-mektep.js')).default;
  const org = client();
  assert.equal((await org('POST', '/api/org/login', { pin: '908172' })).status, 200);
  const { body: st } = await org('GET', '/api/org/state');
  const modern = st.periods.find((p) => p.slug === 'zhana-zaman');
  // As on the site: the first pack's topics are «8-сынып | Атамұра» (the test above tagged them Мектеп).
  const { run } = await import('../server/db.js');
  await run("UPDATE topics SET publisher = 'Атамұра' WHERE publisher = 'Мектеп'");
  await run("UPDATE tests SET publisher = 'Атамұра' WHERE publisher = 'Мектеп'");
  // An Атамұра topic with the same title as a Мектеп one must not be taken for it.
  const same = mektep.find((p) => p.section === '§14');
  const atam = await org('POST', '/api/org/topics', { period_id: modern.id, title: same.title, grade: 8, publisher: 'Атамұра', published: true });
  assert.equal(atam.status, 201);
  // Already imported earlier (tagged «8-сынып | Мектеп» with most of its questions): skipped.
  const done = mektep.find((p) => p.section === '§5');
  const t = await org('POST', '/api/org/topics', { period_id: modern.id, title: done.title, grade: 8, publisher: 'Мектеп', published: true });
  const x = await org('POST', '/api/org/tests', { topic_id: t.body.id, title: done.title, questions: rowsToQuestions(done.rows).questions });
  assert.equal(x.status, 201, JSON.stringify(x.body));
  assert.equal((await org('POST', `/api/org/tests/${x.body.id}/publish`)).status, 200);

  const topicsBefore = (await get('SELECT COUNT(*) AS n FROM topics')).n;
  process.env.QADAM_IMPORTS = '1';
  try {
    await runImportsOnce(['history-8-mektep-2026-11']);
  } finally {
    delete process.env.QADAM_IMPORTS;
  }
  const row = await get("SELECT status, report FROM content_imports WHERE key = 'history-8-mektep-2026-11'");
  assert.equal(row.status, 'done', row.report);
  const report = JSON.parse(row.report);
  assert.equal(report.publisher, 'Мектеп', row.report);
  assert.equal(report.imported.length, mektep.length - 1);
  assert.deepEqual(report.skipped, [`${done.section}. ${done.title}`]);
  assert.equal(report.live, mektep.length - 1);
  assert.equal((await get('SELECT COUNT(*) AS n FROM topics')).n, topicsBefore + mektep.length - 1);
  assert.equal((await all('SELECT id FROM tests WHERE topic_id = ?', atam.body.id)).length, 0, 'the Атамұра topic got nothing');

  const made = await all("SELECT title, grade, publisher, icon, period_id FROM topics WHERE publisher = 'Мектеп' AND grade = 8 AND id <> ?", t.body.id);
  const fresh = made.filter((m) => m.icon.includes('r-batyr-helmet'));
  assert.equal(fresh.length, mektep.length - 1);
  for (const m of fresh) {
    assert.deepEqual(JSON.parse(m.icon), { kind: 'emblem', name: 'r-batyr-helmet', size: 36 });
    assert.equal(m.period_id, modern.id);
  }
  const tests = await all("SELECT x.id, x.grade, x.publisher FROM tests x JOIN topics t ON t.id = x.topic_id WHERE t.publisher = 'Мектеп' AND t.icon LIKE '%r-batyr-helmet%'");
  assert.equal(tests.length, mektep.length - 1);
  assert.ok(tests.every((x) => x.grade === 8 && x.publisher === 'Мектеп'));

  // Students: live, with the emblem; every question served.
  const pupil = client();
  assert.equal((await pupil('POST', '/api/auth/register', { display_name: 'Оқушы', email: 'mek@mail.kz', password: 'secret9', password_confirm: 'secret9' })).status, 201);
  const period = (await pupil('GET', '/api/periods/zhana-zaman')).body;
  const shown = period.topics.filter((p) => p.publisher === 'Мектеп' && p.icon?.name === 'r-batyr-helmet');
  assert.equal(shown.length, mektep.length - 1);
  assert.ok(shown.every((p) => p.icon.size === 36));
  const total = mektep.filter((p) => p !== done).reduce((n, p) => n + rowsToQuestions(p.rows).questions.length, 0);
  assert.equal(shown.reduce((n, p) => n + p.question_count, 0), total);

  // Once only.
  process.env.QADAM_IMPORTS = '1';
  try {
    await runImportsOnce(['history-8-mektep-2026-11']);
  } finally {
    delete process.env.QADAM_IMPORTS;
  }
  assert.equal((await get('SELECT COUNT(*) AS n FROM topics')).n, topicsBefore + mektep.length - 1);
});
