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
  // A long step between requests (an import) must not meet a keep-alive socket the server just closed (ECONNRESET).
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

test('8th grade → 7th grade: Атамұра with Абылай ханның семсері, Мектеп too; nothing else is published', async () => {
  const { run } = await import('../server/db.js');
  const org = client();
  assert.equal((await org('POST', '/api/org/login', { pin: '908172' })).status, 200);
  const { body: st } = await org('GET', '/api/org/state');
  const modern = st.periods.find((p) => p.slug === 'zhana-zaman');
  // A test with its own «8 | Атамұра» tags under an untagged topic, and a 9th-grade one that stays.
  const plain = await org('POST', '/api/org/topics', { period_id: modern.id, title: 'Тегі жоқ тақырып', grade: 9, publisher: 'Атамұра', published: true });
  await run("UPDATE topics SET grade = NULL, publisher = '' WHERE id = ?", plain.body.id);
  const own = await org('POST', '/api/org/tests', { topic_id: plain.body.id, title: 'Өз тегі бар', grade: 8, publisher: 'Атамұра', questions: [{ type: 'single', text: 'С?', points: 1, options: [{ text: 'А', is_correct: true }, { text: 'Б' }] }] });
  assert.equal((await org('POST', `/api/org/tests/${own.body.id}/publish`)).status, 200);
  const nine = await org('POST', '/api/org/topics', { period_id: modern.id, title: '9-сынып тақырыбы', grade: 9, publisher: 'Атамұра', published: true });
  // An unpublished edit of an 8th-grade test must stay unpublished.
  const anyAtam = await get("SELECT x.id, x.title FROM tests x JOIN topics t ON t.id = x.topic_id WHERE t.grade = 8 AND t.publisher = 'Атамұра' LIMIT 1");
  await run('UPDATE tests SET title = ? WHERE id = ?', 'Жарияланбаған өзгеріс', anyAtam.id);

  const atamBefore = (await all("SELECT id FROM topics WHERE grade = 8 AND publisher = 'Атамұра' AND deleted = 0")).length;
  const mekBefore = (await all("SELECT id FROM topics WHERE grade = 8 AND publisher = 'Мектеп' AND deleted = 0")).length;
  const sevenBefore = (await all("SELECT id FROM topics WHERE grade = 7 AND publisher = 'Атамұра'")).length;
  assert.ok(atamBefore > 20 && mekBefore > 40);
  process.env.QADAM_IMPORTS = '1';
  try {
    await runImportsOnce(['retag-8-to-7-2026-11']);
  } finally {
    delete process.env.QADAM_IMPORTS;
  }
  const row = await get("SELECT status, report FROM content_imports WHERE key = 'retag-8-to-7-2026-11'");
  assert.equal(row.status, 'done', row.report);
  assert.equal((await all('SELECT id FROM topics WHERE grade = 8 AND deleted = 0')).length, 0);
  assert.equal((await all("SELECT id FROM topics WHERE grade = 7 AND publisher = 'Атамұра'")).length, atamBefore + sevenBefore);
  assert.equal((await all("SELECT id FROM topics WHERE grade = 7 AND publisher = 'Мектеп'")).length, mekBefore);
  assert.equal((await get('SELECT grade FROM tests WHERE id = ?', own.body.id)).grade, 7);
  assert.equal((await get('SELECT grade FROM topics WHERE id = ?', nine.body.id)).grade, 9);
  const atamIcons = await all("SELECT icon FROM topics WHERE grade = 7 AND publisher = 'Атамұра' AND title <> 'Жоба тақырып'");
  assert.ok(atamIcons.every((t) => JSON.parse(t.icon).name === 'r-ablai-sword' && JSON.parse(t.icon).size === 36));
  assert.equal(JSON.parse((await get('SELECT icon FROM topics WHERE id = ?', plain.body.id)).icon).name, 'r-ablai-sword', 'all its tests are Атамұра');
  const mekIcons = await all("SELECT icon FROM topics WHERE grade = 7 AND publisher = 'Мектеп' AND icon LIKE '%helmet%'");
  assert.equal(mekIcons.length, mekBefore - 1, 'Мектеп keeps its helmet (one topic was made by hand in the test)');

  // Students see it at once; the unpublished edit stays unpublished.
  const pupil = client();
  assert.equal((await pupil('POST', '/api/auth/register', { display_name: 'Оқушы', email: 'seven@mail.kz', password: 'secret9', password_confirm: 'secret9' })).status, 201);
  const { body: list } = await pupil('GET', '/api/tests');
  const tests = list.tests || list;
  assert.ok(!tests.some((x) => x.grade === 8), 'no 8th-grade test left');
  assert.ok(tests.some((x) => x.grade === 7 && x.publisher === 'Атамұра'));
  assert.ok(tests.some((x) => x.grade === 7 && x.publisher === 'Мектеп'));
  assert.ok(tests.some((x) => x.id === own.body.id && x.grade === 7));
  assert.ok(!tests.some((x) => x.title === 'Жарияланбаған өзгеріс'));
  const period = (await pupil('GET', '/api/periods/zhana-zaman')).body;
  // (The test above retagged the first pack Атамұра on the draft only, so match by id.)
  const draftAtam = new Set((await all("SELECT id FROM topics WHERE grade = 7 AND publisher = 'Атамұра' AND icon LIKE '%ablai%'")).map((t) => t.id));
  const atamTopics = period.topics.filter((t) => draftAtam.has(t.id));
  assert.ok(atamTopics.length && atamTopics.every((t) => t.icon?.name === 'r-ablai-sword' && t.icon.size === 36));
  assert.ok(!period.topics.some((t) => t.grade === 8));
});

test('every test of Орта ғасыр becomes «6-сынып | Атамұра», live at once, and goes into that book', async () => {
  const { run } = await import('../server/db.js');
  const org = client();
  assert.equal((await org('POST', '/api/org/login', { pin: '908172' })).status, 200);
  const { body: st } = await org('GET', '/api/org/state');
  const middle = st.periods.find((p) => p.slug === 'orta-gasyr');
  const topics = st.topics.filter((t) => t.period_id === middle.id);
  assert.ok(topics.length);
  // Mixed tags before: none, another grade, another publisher.
  await run("UPDATE topics SET grade = NULL, publisher = '' WHERE id = ?", topics[0].id);
  await run("UPDATE tests SET grade = 9, publisher = 'Мектеп' WHERE topic_id = ?", topics[0].id);
  const other = st.topics.find((t) => t.period_id !== middle.id && !t.deleted);
  const otherBefore = await get('SELECT grade, publisher FROM topics WHERE id = ?', other.id);
  process.env.QADAM_IMPORTS = '1';
  try {
    await runImportsOnce(['tag-orta-gasyr-6-atamura-2026-11']);
  } finally {
    delete process.env.QADAM_IMPORTS;
  }
  const row = await get("SELECT status, report FROM content_imports WHERE key = 'tag-orta-gasyr-6-atamura-2026-11'");
  assert.equal(row.status, 'done', row.report);
  const left = await all(
    "SELECT x.id FROM tests x JOIN topics t ON t.id = x.topic_id WHERE t.period_id = ? AND t.deleted = 0 AND NOT (x.grade = 6 AND x.publisher = 'Атамұра' AND t.grade = 6 AND t.publisher = 'Атамұра')",
    middle.id,
  );
  assert.deepEqual(left, []);
  assert.deepEqual(await get('SELECT grade, publisher FROM topics WHERE id = ?', other.id), otherBefore, 'other periods untouched');
  const pupil = client();
  assert.equal((await pupil('POST', '/api/auth/register', { display_name: 'Оқушы', email: 'six@mail.kz', password: 'secret9', password_confirm: 'secret9' })).status, 201);
  const { body: list } = await pupil('GET', '/api/tests');
  const mid = (list.tests || list).filter((x) => x.period_slug === 'orta-gasyr');
  assert.ok(mid.length);
  assert.ok(mid.every((x) => x.grade === 6 && x.publisher === 'Атамұра'));
});

test('Қазіргі заман, «8-сынып | Атамұра»: all 21 topics live, the period’s older topics untouched', async () => {
  const items = (await import('../server/imports/history-8-modern-atamura.js')).default;
  const org = client();
  assert.equal((await org('POST', '/api/org/login', { pin: '908172' })).status, 200);
  const { body: st } = await org('GET', '/api/org/state');
  const recent = st.periods.find((p) => p.slug === 'kazirgi-zaman');
  // An older topic of the period with one of the pack's titles: not taken for it, not moved.
  const alash = items.find((p) => p.section === '§6–7');
  const old = await org('POST', '/api/org/topics', { period_id: recent.id, title: alash.title, grade: 9, publisher: 'Атамұра', published: true });
  assert.equal(old.status, 201);
  const topicsBefore = (await get('SELECT COUNT(*) AS n FROM topics')).n;
  const run = async () => {
    process.env.QADAM_IMPORTS = '1';
    try {
      await runImportsOnce(['history-8-modern-atamura-2026-11']);
    } finally {
      delete process.env.QADAM_IMPORTS;
    }
  };
  await run();
  const row = await get("SELECT status, report FROM content_imports WHERE key = 'history-8-modern-atamura-2026-11'");
  assert.equal(row.status, 'done', row.report);
  const report = JSON.parse(row.report);
  assert.equal(report.publisher, 'Атамұра');
  assert.equal(report.grade, 8);
  assert.equal(report.imported.length, 21);
  assert.equal(report.live, 21);
  assert.equal((await get('SELECT COUNT(*) AS n FROM topics')).n, topicsBefore + 21);
  assert.equal((await all('SELECT id FROM tests WHERE topic_id = ?', old.body.id)).length, 0);

  const pupil = client();
  assert.equal((await pupil('POST', '/api/auth/register', { display_name: 'Оқушы', email: 'now8@mail.kz', password: 'secret9', password_confirm: 'secret9' })).status, 201);
  const period = (await pupil('GET', '/api/periods/kazirgi-zaman')).body;
  const shown = period.topics.filter((t) => t.grade === 8 && t.publisher === 'Атамұра');
  assert.equal(shown.length, 21);
  const total = items.reduce((n, p) => n + rowsToQuestions(p.rows).questions.length, 0);
  assert.equal(total, 746);
  assert.equal(shown.reduce((n, p) => n + p.question_count, 0), total);

  await run();
  assert.equal((await get('SELECT COUNT(*) AS n FROM topics')).n, topicsBefore + 21);
});

test('Қазіргі заман, «8-сынып | Атамұра»: «1822 жылғы Жарғы» 36 px on every topic, live at once', async () => {
  const org = client();
  assert.equal((await org('POST', '/api/org/login', { pin: '908172' })).status, 200);
  const { body: st } = await org('GET', '/api/org/state');
  const recent = st.periods.find((p) => p.slug === 'kazirgi-zaman');
  const other = await org('POST', '/api/org/topics', { period_id: recent.id, title: '9-сынып, басқа', grade: 9, publisher: 'Атамұра', published: true });
  process.env.QADAM_IMPORTS = '1';
  try {
    await runImportsOnce(['icon-kazirgi-8-atamura-charter-2026-11']);
  } finally {
    delete process.env.QADAM_IMPORTS;
  }
  const row = await get("SELECT status, report FROM content_imports WHERE key = 'icon-kazirgi-8-atamura-charter-2026-11'");
  assert.equal(row.status, 'done', row.report);
  assert.equal(JSON.parse(row.report).topics, 21);
  assert.ok(!(await get('SELECT icon FROM topics WHERE id = ?', other.body.id)).icon.includes('charter'));
  const pupil = client();
  assert.equal((await pupil('POST', '/api/auth/register', { display_name: 'Оқушы', email: 'charter@mail.kz', password: 'secret9', password_confirm: 'secret9' })).status, 201);
  const period = (await pupil('GET', '/api/periods/kazirgi-zaman')).body;
  const mine = period.topics.filter((t) => t.grade === 8 && t.publisher === 'Атамұра');
  assert.equal(mine.length, 21);
  assert.ok(mine.every((t) => t.icon?.name === 'e-charter-1822' && t.icon.size === 36 && t.icon.kind === 'emblem'));
});

test('Қазіргі заман, «8-сынып | Мектеп»: all 41 topics live with Жанқожа батыр 36 px', async () => {
  const items = (await import('../server/imports/history-8-modern-mektep.js')).default;
  const before = (await get('SELECT COUNT(*) AS n FROM topics')).n;
  const go = async () => {
    process.env.QADAM_IMPORTS = '1';
    try {
      await runImportsOnce(['history-8-modern-mektep-2026-11']);
    } finally {
      delete process.env.QADAM_IMPORTS;
    }
  };
  await go();
  const row = await get("SELECT status, report FROM content_imports WHERE key = 'history-8-modern-mektep-2026-11'");
  assert.equal(row.status, 'done', row.report);
  const report = JSON.parse(row.report);
  assert.equal(report.publisher, 'Мектеп');
  assert.equal(report.imported.length, 41);
  assert.equal(report.live, 41);
  assert.equal((await get('SELECT COUNT(*) AS n FROM topics')).n, before + 41);
  const pupil = client();
  assert.equal((await pupil('POST', '/api/auth/register', { display_name: 'Оқушы', email: 'now8m@mail.kz', password: 'secret9', password_confirm: 'secret9' })).status, 201);
  const period = (await pupil('GET', '/api/periods/kazirgi-zaman')).body;
  const shown = period.topics.filter((t) => t.grade === 8 && t.publisher === 'Мектеп');
  assert.equal(shown.length, 41);
  assert.ok(shown.every((t) => t.icon?.name === 'up-zhankozha' && t.icon.size === 36));
  const total = items.reduce((n, p) => n + rowsToQuestions(p.rows).questions.length, 0);
  assert.equal(total, 953);
  assert.equal(shown.reduce((n, p) => n + p.question_count, 0), total);
  // The Атамұра topics of the period keep their own emblem.
  assert.ok(period.topics.filter((t) => t.grade === 8 && t.publisher === 'Атамұра').every((t) => t.icon?.name === 'e-charter-1822'));
  await go();
  assert.equal((await get('SELECT COUNT(*) AS n FROM topics')).n, before + 41);
});

test('Қазіргі заман, «9-сынып | Атамұра»: all 32 topics live with the factory emblem 36 px', async () => {
  const items = (await import('../server/imports/history-9-modern-atamura.js')).default;
  const before = (await get('SELECT COUNT(*) AS n FROM topics')).n;
  const go = async () => {
    process.env.QADAM_IMPORTS = '1';
    try {
      await runImportsOnce(['history-9-modern-atamura-2026-11']);
    } finally {
      delete process.env.QADAM_IMPORTS;
    }
  };
  await go();
  const row = await get("SELECT status, report FROM content_imports WHERE key = 'history-9-modern-atamura-2026-11'");
  assert.equal(row.status, 'done', row.report);
  const report = JSON.parse(row.report);
  assert.equal(report.grade, 9);
  assert.equal(report.publisher, 'Атамұра');
  assert.equal(report.imported.length, 32);
  assert.equal(report.live, 32);
  assert.equal((await get('SELECT COUNT(*) AS n FROM topics')).n, before + 32);
  const pupil = client();
  assert.equal((await pupil('POST', '/api/auth/register', { display_name: 'Оқушы', email: 'now9a@mail.kz', password: 'secret9', password_confirm: 'secret9' })).status, 201);
  const period = (await pupil('GET', '/api/periods/kazirgi-zaman')).body;
  const shown = period.topics.filter((t) => t.grade === 9 && t.publisher === 'Атамұра' && t.icon?.name === 'sv-factory');
  assert.equal(shown.length, 32);
  assert.ok(shown.every((t) => t.icon.size === 36));
  const total = items.reduce((n, p) => n + rowsToQuestions(p.rows).questions.length, 0);
  assert.equal(total, 740);
  assert.equal(shown.reduce((n, p) => n + p.question_count, 0), total);
  await go();
  assert.equal((await get('SELECT COUNT(*) AS n FROM topics')).n, before + 32);
});

test('Қазіргі заман, «9-сынып | Мектеп»: all 46 topics live with Мәңгілік алау 36 px', async () => {
  const items = (await import('../server/imports/history-9-modern-mektep.js')).default;
  const before = (await get('SELECT COUNT(*) AS n FROM topics')).n;
  const go = async () => {
    process.env.QADAM_IMPORTS = '1';
    try {
      await runImportsOnce(['history-9-modern-mektep-2026-11']);
    } finally {
      delete process.env.QADAM_IMPORTS;
    }
  };
  await go();
  const row = await get("SELECT status, report FROM content_imports WHERE key = 'history-9-modern-mektep-2026-11'");
  assert.equal(row.status, 'done', row.report);
  const report = JSON.parse(row.report);
  assert.equal(report.grade, 9);
  assert.equal(report.publisher, 'Мектеп');
  assert.equal(report.imported.length, 46);
  assert.equal(report.live, 46);
  assert.equal((await get('SELECT COUNT(*) AS n FROM topics')).n, before + 46);
  const pupil = client();
  assert.equal((await pupil('POST', '/api/auth/register', { display_name: 'Оқушы', email: 'now9m@mail.kz', password: 'secret9', password_confirm: 'secret9' })).status, 201);
  const period = (await pupil('GET', '/api/periods/kazirgi-zaman')).body;
  const shown = period.topics.filter((t) => t.grade === 9 && t.publisher === 'Мектеп');
  assert.equal(shown.length, 46);
  assert.ok(shown.every((t) => t.icon?.name === 'w-eternal-flame' && t.icon.size === 36));
  const total = items.reduce((n, p) => n + rowsToQuestions(p.rows).questions.length, 0);
  assert.equal(total, 982);
  assert.equal(shown.reduce((n, p) => n + p.question_count, 0), total);
  await go();
  assert.equal((await get('SELECT COUNT(*) AS n FROM topics')).n, before + 46);
});

test('«10-сынып | Атамұра»: one test in each of the four periods, each with its own emblem 36 px', async () => {
  const data = await import('../server/imports/history-10-atamura.js');
  const parts = [
    ['ancient', 'ezhelgi-zaman', 'a-pottery', 40],
    ['middle', 'orta-gasyr', 't-turgesh-coin', 50],
    ['modern', 'zhana-zaman', 'd-signal-fire', 74],
    ['recent', 'kazirgi-zaman', 'i-khan-shatyr', 118],
  ];
  const keys = parts.map(([p]) => `history-10-atamura-${p}-2026-11`);
  const before = (await get('SELECT COUNT(*) AS n FROM topics')).n;
  const go = async () => {
    process.env.QADAM_IMPORTS = '1';
    try {
      await runImportsOnce(keys);
    } finally {
      delete process.env.QADAM_IMPORTS;
    }
  };
  await go();
  assert.equal((await get('SELECT COUNT(*) AS n FROM topics')).n, before + 4);
  const pupil = client();
  assert.equal((await pupil('POST', '/api/auth/register', { display_name: 'Оқушы', email: 'ten@mail.kz', password: 'secret9', password_confirm: 'secret9' })).status, 201);
  for (const [part, slug, emblem, count] of parts) {
    const row = await get('SELECT status, report FROM content_imports WHERE key = ?', `history-10-atamura-${part}-2026-11`);
    assert.equal(row.status, 'done', row.report);
    const report = JSON.parse(row.report);
    assert.equal(report.live, 1, row.report);
    const period = (await pupil('GET', `/api/periods/${slug}`)).body;
    const shown = period.topics.filter((t) => t.grade === 10 && t.publisher === 'Атамұра');
    assert.equal(shown.length, 1, slug);
    assert.equal(shown[0].title, data[part][0].title);
    assert.deepEqual([shown[0].icon?.name, shown[0].icon?.size], [emblem, 36]);
    assert.equal(shown[0].question_count, count);
  }
  await go();
  assert.equal((await get('SELECT COUNT(*) AS n FROM topics')).n, before + 4);
});

test('«10-сынып | Атамұра» topics: each period gets its own topics, same titles in other periods are not taken for them', async () => {
  const data = await import('../server/imports/history-10-atamura-topics.js');
  const parts = [
    ['ancient', 'ezhelgi-zaman', 'a-pottery'],
    ['middle', 'orta-gasyr', 't-turgesh-coin'],
    ['modern', 'zhana-zaman', 'd-signal-fire'],
    ['recent', 'kazirgi-zaman', 'i-khan-shatyr'],
  ];
  const all20 = parts.reduce((n, [p]) => n + data[p].length, 0);
  assert.equal(all20, 20);
  const before = (await get('SELECT COUNT(*) AS n FROM topics')).n;
  const go = async () => {
    process.env.QADAM_IMPORTS = '1';
    try {
      await runImportsOnce(['history-10-atamura-topics-2026-11']);
    } finally {
      delete process.env.QADAM_IMPORTS;
    }
  };
  await go();
  const row = await get("SELECT status, report FROM content_imports WHERE key = 'history-10-atamura-topics-2026-11'");
  assert.equal(row.status, 'done', row.report);
  for (const r of JSON.parse(row.report)) assert.deepEqual([r.period, r.skipped, r.moved], [r.period, [], []], JSON.stringify(r));
  assert.equal((await get('SELECT COUNT(*) AS n FROM topics')).n, before + 20);
  const pupil = client();
  assert.equal((await pupil('POST', '/api/auth/register', { display_name: 'Оқушы', email: 'ten2@mail.kz', password: 'secret9', password_confirm: 'secret9' })).status, 201);
  for (const [part, slug, emblem] of parts) {
    const period = (await pupil('GET', `/api/periods/${slug}`)).body;
    const titles = new Set(data[part].map((i) => i.title));
    const shown = period.topics.filter((t) => t.grade === 10 && t.publisher === 'Атамұра' && titles.has(t.title));
    assert.equal(shown.length, data[part].length, slug);
    assert.ok(shown.every((t) => t.icon?.name === emblem && t.icon.size === 36));
    const total = data[part].reduce((n, p) => n + rowsToQuestions(p.rows).questions.length, 0);
    assert.equal(shown.reduce((n, t) => n + t.question_count, 0), total, slug);
  }
  await go();
  assert.equal((await get('SELECT COUNT(*) AS n FROM topics')).n, before + 20);
});
