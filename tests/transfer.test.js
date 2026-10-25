import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qadam-transfer-'));
process.env.DB_FILE = path.join(tmp, 'test.sqlite');
process.env.ORGANIZER_PIN = '908172';
delete process.env.TURSO_DATABASE_URL;
const { app, whenReady } = await import('../server/app.js');
const { readSpreadsheet, writeCsv, writeXlsx } = await import('../server/sheets.js');
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
  return async (method, url, body) => {
    const raw = Buffer.isBuffer(body);
    const headers = { 'Content-Type': raw ? 'application/octet-stream' : 'application/json' };
    if (method !== 'GET') headers['X-Qadam'] = '1';
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(base + url, { method, headers, body: raw ? body : body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
  };
}
async function organizer() {
  const call = client();
  assert.equal((await call('POST', '/api/org/login', { pin: '908172' })).status, 200);
  return call;
}
async function student(name = 'Оқушы') {
  const call = client();
  const email = `s${Math.random().toString(36).slice(2, 8)}@gmail.com`;
  assert.equal((await call('POST', '/api/auth/register', { display_name: name, email, password: 'secret9', password_confirm: 'secret9' })).status, 201);
  return call;
}
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');

test('template downloads as xlsx and imports into a new test after the preview', async () => {
  const org = await organizer();
  const tpl = await org('GET', '/api/org/import/template');
  assert.equal(tpl.status, 200);
  assert.match(tpl.headers.get('content-type'), /spreadsheetml/);
  assert.match(tpl.headers.get('content-disposition'), /attachment/);
  const { rows } = readSpreadsheet(tpl.body);
  assert.deepEqual(rows[0].slice(0, 4), ['ID', 'Түрі', 'Контекст', 'Сұрақ мәтіні']);

  const before = (await org('GET', '/api/org/state')).body;
  const parsed = await org('POST', '/api/org/import/parse', tpl.body);
  assert.equal(parsed.status, 200);
  assert.equal(parsed.body.format, 'xlsx');
  assert.deepEqual(parsed.body.errors, []);
  assert.equal(parsed.body.count, 7);
  // Parsing alone saves nothing.
  assert.equal((await org('GET', '/api/org/state')).body.tests.length, before.tests.length);

  const topic = before.topics[0];
  const done = await org('POST', '/api/org/import/commit', { target: 'new', title: 'Импорт тесті', topic_id: topic.id, questions: parsed.body.questions, skip_duplicates: true });
  assert.equal(done.status, 201);
  assert.equal(done.body.added, 7);
  const t = done.body.test;
  assert.equal(t.title, 'Импорт тесті');
  assert.deepEqual(t.questions.map((q) => q.type), ['single', 'multiple', 'matching', 'ordering', 'open', 'context']);
  assert.deepEqual(t.questions[1].options.map((o) => o.is_correct), [true, true, false, true]);
  assert.equal(t.questions[5].children.length, 2);
  assert.deepEqual(t.problems, []);
  assert.equal(t.live_state, 'hidden');
});

test('export keeps every format and re-imports into the same test without duplicates', async () => {
  const org = await organizer();
  const st = (await org('GET', '/api/org/state')).body;
  const img = (await org('POST', '/api/org/files?kind=image', PNG)).body;
  const created = await org('POST', '/api/org/tests', {
    title: 'Экспорт',
    topic_id: st.topics[0].id,
    questions: [
      { type: 'image', text: 'Суретте кім?', image_id: img.id, points: 2, options: [{ text: 'Абылай', is_correct: true }, { text: 'Кенесары', image_id: img.id }] },
      { type: 'open', text: 'Астана', data: { answers: ['Астана', 'Нұр-Сұлтан'], ignore_case: false, ignore_spaces: true } },
      { type: 'context', text: 'Құжат', data: { body: 'Мәтін, "тырнақшамен"\nжаңа жол' }, children: [{ type: 'ordering', text: 'Рет', data: { items: [{ text: 'А', date: '1465' }, { text: 'Б', date: '' }] } }] },
    ],
  });
  const id = created.body.id;
  for (const format of ['xlsx', 'csv']) {
    const file = await org('GET', `/api/org/tests/${id}/export?format=${format}`);
    assert.equal(file.status, 200);
    assert.match(file.headers.get('content-disposition'), new RegExp(`\\.${format}`));
    const parsed = (await org('POST', '/api/org/import/parse', file.body)).body;
    assert.equal(parsed.format, format);
    assert.deepEqual(parsed.errors, []);
    const [image, open, ctx] = parsed.questions;
    assert.equal(image.image_id, img.id);
    assert.equal(image.points, 2);
    assert.equal(image.options[1].image_id, img.id);
    assert.deepEqual(open.data, { answers: ['Астана', 'Нұр-Сұлтан'], ignore_case: false, ignore_spaces: true });
    assert.equal(ctx.data.body, 'Мәтін, "тырнақшамен"\nжаңа жол');
    assert.deepEqual(ctx.children[0].data.items.map((i) => [i.text, i.date]), [['А', '1465'], ['Б', '']]);
    assert.ok(image.duplicate.tests.some((t) => t.id === id));

    const again = await org('POST', '/api/org/import/commit', { target: 'existing', test_id: id, questions: parsed.questions, skip_duplicates: true });
    assert.equal(again.status, 400);
    assert.match(again.body.error, /қайталанады/);
  }
  // Without skipping, the copies are appended after the existing questions.
  const parsed = (await org('POST', '/api/org/import/parse', (await org('GET', `/api/org/tests/${id}/export`)).body)).body;
  const added = await org('POST', '/api/org/import/commit', { target: 'existing', test_id: id, questions: parsed.questions, skip_duplicates: false });
  assert.equal(added.status, 201);
  assert.equal(added.body.test.questions.length, 6);
  assert.equal(added.body.test.questions[0].id, created.body.questions[0].id);
});

test('bad rows are listed by number and a failed import changes nothing', async () => {
  const org = await organizer();
  const csv = writeCsv([
    ['Түрі', 'Сұрақ мәтіні', 'Нұсқа 1', 'Нұсқа 2', 'Нұсқа 3', 'Дұрыс жауап', 'Ұпай', 'Сурет'],
    ['Бір дұрыс жауап', 'Дұрыс сұрақ', 'а', 'ә', '', 'Ә', '', ''],
    ['Бір дұрыс жауап', 'Жоқ нұсқа', 'а', 'ә', '', '5', '', ''],
    ['Белгісіз', 'Түрі қате', 'а', 'ә', '', '1', '', ''],
    ['Бір дұрыс жауап', '', 'а', 'ә', '', '1', '', ''],
    ['', '', '', '', '', '', '', ''],
    ['Сәйкестендіру', 'Жұп', 'А-Б', 'В = Г', '', '', '', ''],
    ['Ашық жауап', 'Ұпайы қате', '1991', '', '', '', 'көп', ''],
    ['Бір дұрыс жауап', 'Сурет жоқ', 'а', 'ә', '', '1', '', '99999'],
    ['Бір дұрыс жауап', 'Бос нұсқа', 'а', '', 'б', '1', '', ''],
  ]);
  const parsed = (await org('POST', '/api/org/import/parse', csv)).body;
  assert.deepEqual(parsed.errors.map((e) => e.row), [3, 4, 5, 7, 8, 10]);
  assert.match(parsed.errors[0].message, /«5»/);
  assert.match(parsed.errors[0].column, /^F \(«Дұрыс жауап»\)$/);
  assert.match(parsed.errors[1].column, /«Түрі»/);
  assert.equal(parsed.count, 2);
  assert.match(parsed.warnings.join(' '), /99999/);
  assert.equal(parsed.questions[1].image_id, null);

  // Header without the needed columns.
  const noHeader = (await org('POST', '/api/org/import/parse', writeCsv([['a', 'b'], ['1', '2']]))).body;
  assert.match(noHeader.errors[0].message, /Сұрақ түрі, Сұрақ мәтіні, Жауаптар/);
  // Not a spreadsheet, and the old .xls format.
  assert.equal((await org('POST', '/api/org/import/parse', PNG)).status, 400);
  const xls = Buffer.alloc(16);
  xls.writeUInt32BE(0xd0cf11e0, 0);
  assert.match((await org('POST', '/api/org/import/parse', xls)).body.error, /xls/);
  assert.equal((await org('POST', '/api/org/import/parse', writeXlsx([{ name: 'A', rows: [] }]))).body.errors.length, 1);

  // A commit that fails its check writes nothing.
  const st = (await org('GET', '/api/org/state')).body;
  const target = st.tests[0];
  const before = (await org('GET', `/api/org/tests/${target.id}`)).body;
  const bad = await org('POST', '/api/org/import/commit', {
    target: 'existing',
    test_id: target.id,
    questions: [...parsed.questions, { type: 'single', text: 'Жоқ сурет', image_id: 424242, options: [{ text: 'а', is_correct: true }, { text: 'ә' }] }],
  });
  assert.equal(bad.status, 400);
  assert.deepEqual((await org('GET', `/api/org/tests/${target.id}`)).body.questions, before.questions);
  const noTopic = await org('POST', '/api/org/import/commit', { target: 'new', title: 'X', questions: parsed.questions });
  assert.equal(noTopic.status, 400);
  assert.equal((await org('GET', '/api/org/state')).body.tests.length, st.tests.length);
});

test('the one-cell format: quiz, multiple answers, matching and chronology are built as real tasks', async () => {
  const org = await organizer();
  const csv = writeCsv([
    ['Сұрақ түрі', 'Сұрақ мәтіні', 'Жауаптар', 'Дұрыс жауап'],
    ['Біржауапты', 'Қазақ хандығы қай жылы құрылды?', '1456; 1465; 1470; 1480', '1465'],
    ['Көпжауапты', 'Қазақ хандығының негізін қалаған хандарды таңдаңыз', 'Керей; Жәнібек; Қасым; Тәуке', 'Керей; Жәнібек'],
    ['Сәйкестендіру', 'Хандарды билік құрған жылдарымен сәйкестендіріңіз', 'Керей — 1465–1473; Қасым — 1511–1521', 'Керей — 1465–1473; Қасым — 1511–1521'],
    ['Хронологиялық реттілік', 'Оқиғаларды хронологиялық ретпен орналастырыңыз',
      'Тәуке ханның билікке келуі — 1680; Қазақ хандығының құрылуы — 1465–1466; Қасым ханның билікке келуі — 1511',
      'Қазақ хандығының құрылуы — 1465–1466; Қасым ханның билікке келуі — 1511; Тәуке ханның билікке келуі — 1680'],
    ['Викторина — біржауапты', 'Бірінші нұсқа нөмірмен', 'Иә; Жоқ', '1'],
    ['Біржауапты', 'Екі дұрыс жауап', 'А; Б; В', 'А; Б'],
    ['Сәйкестендіру', 'Жұбы жоқ', 'Керей; Қасым', ''],
    ['Хронологиялық реттілік', 'Бөтен оқиға', 'А — 1; Б — 2', 'А — 1; В — 3'],
    ['Көпжауапты', 'Жоқ жауап', 'А; Б; В', 'А; Г'],
    ['Біржауапты', 'Жауабы жоқ', 'А; Б', ''],
  ]);
  const parsed = (await org('POST', '/api/org/import/parse', csv)).body;
  assert.deepEqual(parsed.errors.map((e) => [e.row, e.column.split(' ')[0]]), [[7, 'D'], [8, 'C'], [9, 'D'], [10, 'D'], [11, 'D']]);
  assert.match(parsed.errors[0].message, /Көпжауапты/);
  assert.match(parsed.errors[3].message, /«Г»/);
  assert.equal(parsed.count, 5);
  assert.deepEqual(parsed.by_type, { single: 2, multiple: 1, matching: 1, ordering: 1 });
  const [single, multiple, matching, ordering, byNumber] = parsed.questions;
  assert.deepEqual(single.options.map((o) => [o.text, o.is_correct]), [['1456', false], ['1465', true], ['1470', false], ['1480', false]]);
  assert.deepEqual(multiple.options.filter((o) => o.is_correct).map((o) => o.text), ['Керей', 'Жәнібек']);
  assert.deepEqual(matching.data.pairs.map((p) => [p.left, p.right]), [['Керей', '1465–1473'], ['Қасым', '1511–1521']]);
  assert.deepEqual(ordering.data.items.map((i) => [i.text, i.date]), [
    ['Қазақ хандығының құрылуы', '1465–1466'],
    ['Қасым ханның билікке келуі', '1511'],
    ['Тәуке ханның билікке келуі', '1680'],
  ]);
  assert.equal(byNumber.options[0].is_correct, true);

  // Saved as real tasks, published, and taken by a student: matching and ordering are graded, ordering comes mixed up.
  const st = (await org('GET', '/api/org/state')).body;
  const done = await org('POST', '/api/org/import/commit', { target: 'new', title: 'Хандық', topic_id: st.topics[0].id, questions: parsed.questions });
  assert.equal(done.status, 201);
  const t = done.body.test;
  assert.deepEqual(t.questions.map((q) => q.type), ['single', 'multiple', 'matching', 'ordering', 'single']);
  assert.deepEqual(t.problems, []);
  assert.equal((await org('POST', `/api/org/tests/${t.id}/publish`)).status, 200);

  const pupil = await student();
  const paper = (await pupil('GET', `/api/tests/${t.id}`)).body;
  const q = (type) => paper.units.find((u) => u.type === type);
  const ord = q('ordering');
  const rightOrder = t.questions[3].data.items.map((i) => i.text);
  assert.notDeepEqual(ord.items.map((i) => i.text), rightOrder);
  const answers = {};
  for (const u of paper.units) {
    const src = t.questions.find((x) => x.text === u.text);
    if (u.type === 'matching') answers[u.id] = Object.fromEntries(u.left.map((l) => [l.key, l.key]));
    else if (u.type === 'ordering') answers[u.id] = rightOrder.map((text) => u.items.find((i) => i.text === text).key);
    else answers[u.id] = u.options.filter((o) => src.options.find((so) => so.text === o.text).is_correct).map((o) => o.id);
  }
  const result = (await pupil('POST', `/api/tests/${t.id}`, { answers, token: paper.token })).body;
  assert.equal(result.percent, 100);
  // A wrong order and a half-chosen multiple answer are not counted as right.
  const again = (await pupil('GET', `/api/tests/${t.id}`)).body;
  const wrong = {};
  for (const u of again.units) {
    if (u.type === 'ordering') wrong[u.id] = [...rightOrder].reverse().map((text) => u.items.find((i) => i.text === text).key);
    if (u.type === 'multiple' || (u.options && u.multiple)) wrong[u.id] = [u.options.find((o) => o.text === 'Керей').id];
  }
  const r2 = (await pupil('POST', `/api/tests/${t.id}`, { answers: wrong, token: again.token })).body;
  assert.equal(r2.items.find((i) => i.type === 'ordering').is_correct, false);
  assert.equal(r2.items.find((i) => i.type === 'multiple').is_correct, false);
});

test('import and export need the organizer', async () => {
  const pupil = await student();
  assert.equal((await pupil('GET', '/api/org/import/template')).status, 401);
  assert.equal((await pupil('GET', '/api/org/tests/1/export')).status, 401);
  assert.equal((await pupil('POST', '/api/org/import/parse', Buffer.from('a,b'))).status, 401);
  assert.equal((await pupil('POST', '/api/org/import/commit', { target: 'new' })).status, 401);
});

test('suggestions: a student sends, sees only their own, the organizer reads and replies', async () => {
  const anna = await student('Анна');
  const bolat = await student('Болат');
  const guest = client();
  assert.equal((await guest('POST', '/api/feedback', { subject: 'Сәлем', body: 'Мәтін мәтін' })).status, 401);
  assert.equal((await guest('GET', '/api/feedback')).status, 401);

  assert.equal((await anna('POST', '/api/feedback', { subject: '', body: 'Мәтін мәтін' })).status, 400);
  assert.equal((await anna('POST', '/api/feedback', { subject: 'Тақырып', body: '   ' })).status, 400);
  const sent = await anna('POST', '/api/feedback', { subject: 'Жаңа тест', body: 'Алаш туралы тест қосыңыз.' });
  assert.equal(sent.status, 201);
  assert.equal(sent.body.item.status, 'new');
  await bolat('POST', '/api/feedback', { subject: 'Қате', body: 'Үшінші сұрақта қате бар.' });

  assert.deepEqual((await anna('GET', '/api/feedback')).body.items.map((f) => f.subject), ['Жаңа тест']);
  assert.deepEqual((await bolat('GET', '/api/feedback')).body.items.map((f) => f.subject), ['Қате']);
  // Students cannot reach the organizer side.
  assert.equal((await anna('GET', '/api/org/feedback')).status, 401);
  assert.equal((await anna('POST', `/api/org/feedback/${sent.body.item.id}/reply`, { reply: 'x' })).status, 401);

  const org = await organizer();
  const list = (await org('GET', '/api/org/feedback')).body;
  assert.equal(list.counts.new, 2);
  assert.equal((await org('GET', '/api/org/feedback/count')).body.new, 2);
  assert.equal((await org('GET', '/api/org/state')).body.feedback_new, 2);
  const item = list.items.find((f) => f.subject === 'Жаңа тест');
  assert.equal(item.display_name, 'Анна');
  assert.match(item.contact, /@gmail\.com$/);

  assert.equal((await org('POST', `/api/org/feedback/${item.id}/read`)).body.item.status, 'read');
  assert.equal((await org('GET', '/api/org/feedback?status=new')).body.items.length, 1);
  assert.equal((await org('GET', '/api/org/feedback?q=Алаш')).body.items.length, 1);
  assert.equal((await org('GET', '/api/org/feedback?from=2000-01-01&to=2000-01-02')).body.items.length, 0);
  const today = new Date().toISOString().slice(0, 10);
  assert.equal((await org('GET', `/api/org/feedback?from=${today}&to=${today}`)).body.items.length, 2);

  assert.equal((await org('POST', `/api/org/feedback/${item.id}/reply`, { reply: '' })).status, 400);
  const replied = await org('POST', `/api/org/feedback/${item.id}/reply`, { reply: 'Рақмет, келесі аптада қосамыз.' });
  assert.equal(replied.body.item.status, 'answered');
  assert.equal((await org('GET', '/api/org/feedback?status=answered')).body.items.length, 1);
  assert.equal((await org('GET', '/api/org/feedback?status=open')).body.items.length, 1);

  const mine = (await anna('GET', '/api/feedback')).body;
  assert.equal(mine.unseen, 1);
  assert.equal(mine.items[0].reply, 'Рақмет, келесі аптада қосамыз.');
  assert.equal((await bolat('GET', '/api/feedback')).body.items[0].reply, null);
  await anna('POST', '/api/feedback/seen');
  assert.equal((await anna('GET', '/api/feedback/unseen')).body.unseen, 0);
});
