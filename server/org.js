import crypto from 'node:crypto';
import express from 'express';
import { config } from './config.js';
import { all, get, run, batch } from './db.js';
import { KINDS, UPLOAD_LIMIT, checkUpload } from './files.js';
import { draftStatus, publish, publishTest, testLiveState, listPublications, restoreDraft, readSetting, published } from './publish.js';
import { TYPES, CHOICE_TYPES, settingsOf, dataOf, assembleQuestions, testProblems, readyQuestions, gradable, grade } from './questions.js';
import { studentPaper } from './quiz.js';
import { hashPassword, endAllSessions } from './auth.js';
import { EMBLEM_IDS, EMBLEM_CATEGORIES } from '../public/assets/js/emblems.js';
import { readSpreadsheet } from './sheets.js';
import { orgFeedbackRouter } from './feedback.js';
import { orgBooksRouter } from './books.js';
import { exportFile, templateFile, rowsToQuestions, dropMissingImages, duplicateKey } from './transfer.js';
import { gradeOf, publisherOf, textbookOf, TOPIC_GRADES, TOPIC_PUBLISHERS } from './catalog.js';
import { latin } from './latin.js';
import { orgLinksRouter, ensureLinks } from './links.js';

// Organizer cabinet API. Everything except /login needs the organizer session cookie.
// The PIN lives only in the ORGANIZER_PIN environment variable and is checked here.

const COOKIE = 'qadam_org';
const TTL_MS = 1000 * 60 * 60 * 8; // 8 сағат
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
const GLOBAL_MAX_FAILS = 30;

const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest();
const tokenHash = (t) => sha256(t).toString('hex');

function cookieValue(req) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return decodeURIComponent(v.join('='));
  }
  return null;
}

function setCookie(req, res, value, maxAgeMs) {
  const parts = [`${COOKIE}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
  if (config.cookieSecure || req.secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export async function isOrganizer(req) {
  const token = cookieValue(req);
  if (!token) return false;
  return Boolean(await get('SELECT 1 AS ok FROM org_sessions WHERE token_hash = ? AND expires_at > ?', tokenHash(token), Date.now()));
}

function pinMatches(pin) {
  const expected = (process.env.ORGANIZER_PIN || '').trim();
  if (!expected) return false;
  return crypto.timingSafeEqual(sha256(pin), sha256(expected));
}

// Failed PIN attempts are counted in the database, so the limit holds across serverless instances.
async function lockedFor(key) {
  const row = await get('SELECT locked_until FROM auth_failures WHERE key = ?', key);
  return row && row.locked_until > Date.now() ? Math.ceil((row.locked_until - Date.now()) / 60000) : 0;
}

async function recordFailure(key, max) {
  const row = await get('SELECT count FROM auth_failures WHERE key = ?', key);
  const count = (row?.count || 0) + 1;
  const lock = count >= max ? Date.now() + LOCK_MS : 0;
  await run(
    `INSERT INTO auth_failures (key, count, locked_until) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET count = excluded.count, locked_until = excluded.locked_until`,
    key,
    count >= max ? 0 : count,
    lock,
  );
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

class Invalid extends Error {}
const fail = (msg) => {
  throw new Invalid(msg);
};

// ─── Field helpers ────────────────────────────────────────────────
const str = (v, max, label, { required = false } = {}) => {
  const s = String(v ?? '').trim();
  if (required && !s) fail(`«${label}» өрісін толтырыңыз.`);
  if (s.length > max) fail(`«${label}» тым ұзын (ең көбі ${max} таңба).`);
  return s;
};
const bool = (v) => (v ? 1 : 0);
const optId = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

async function uniqueSlug(title, exceptId = null) {
  const base = latin(title) || 'takyryp';
  let slug = base;
  for (let i = 2; await get('SELECT 1 AS ok FROM topics WHERE slug = ? AND id IS NOT ?', slug, exceptId); i += 1) slug = `${base}-${i}`;
  return slug;
}

async function nextPosition(table, where = '', ...args) {
  const row = await get(`SELECT COALESCE(MAX(position), 0) + 1 AS n FROM ${table} ${where}`, ...args);
  return row.n;
}

async function mustExist(table, id) {
  const live = table === 'topics' ? ' AND deleted = 0' : '';
  if (!(await get(`SELECT 1 AS ok FROM ${table} WHERE id = ?${live}`, id))) {
    const e = new Invalid('Жазба табылмады. Бетті жаңартып көріңіз.');
    e.status = 404;
    throw e;
  }
}

async function checkTopic(topicId) {
  if (topicId !== null && !(await get('SELECT 1 AS ok FROM topics WHERE id = ? AND deleted = 0', topicId))) fail('Таңдалған тақырып табылмады.');
}

async function checkFile(id, kinds) {
  if (id === null) return;
  const f = await get('SELECT kind FROM files WHERE id = ?', id);
  if (!f || !kinds.includes(f.kind)) fail('Таңдалған файл табылмады.');
}

function parseKeyPoints(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((k) => ({ label: str(k?.label, 120, 'Дерек'), text: str(k?.text, 500, 'Дерек мәтіні') }))
    .filter((k) => k.label || k.text)
    .slice(0, 40);
}

const ICON_NAMES = ['home', 'periods', 'tests', 'materials', 'results', 'feedback', 'profile', 'book', 'clock', 'search', 'check', 'arrow', 'logout'];
const EMBLEM_NAMES = ['emblem-1', 'emblem-2', 'emblem-3', 'emblem-4'];

/** Pixel size limits of an icon: site icons 14–64, a topic emblem 16–128. */
export const ICON_SIZE = { min: 14, max: 64 };
export const EMBLEM_SIZE = { min: 16, max: 128 };

async function parseIcon(v, limits = ICON_SIZE) {
  if (!v || typeof v !== 'object') return null;
  const size = Math.max(limits.min, Math.min(limits.max, Math.round(Number(v.size) || 22)));
  if (v.kind === 'builtin') {
    if (![...ICON_NAMES, ...EMBLEM_NAMES].includes(v.name)) fail('Мұндай белгіше кітапханада жоқ.');
    return { kind: 'builtin', name: v.name, size };
  }
  if (v.kind === 'emblem') {
    if (!EMBLEM_IDS.has(String(v.name))) fail('Мұндай эмблема кітапханада жоқ.');
    return { kind: 'emblem', name: String(v.name), size };
  }
  if (v.kind === 'file') {
    const id = optId(v.id);
    await checkFile(id, ['icon', 'image']);
    if (id === null) fail('Белгіше файлы таңдалмаған.');
    return { kind: 'file', id, size };
  }
  return null;
}

// ─── State for the cabinet ────────────────────────────────────────
async function fileUsage() {
  const uses = new Map();
  const add = (id, label) => {
    if (!id) return;
    if (!uses.has(id)) uses.set(id, []);
    uses.get(id).push(label);
  };
  for (const t of await all('SELECT id, title, image_id, icon FROM topics WHERE deleted = 0')) {
    add(t.image_id, `Тақырып: ${t.title}`);
    try {
      const icon = JSON.parse(t.icon || 'null');
      if (icon?.kind === 'file') add(icon.id, `Тақырып белгішесі: ${t.title}`);
    } catch {
      /* ignore broken icon */
    }
  }
  for (const m of await all('SELECT title, image_id, pdf_id FROM materials')) {
    add(m.image_id, `Материал: ${m.title}`);
    add(m.pdf_id, `Материал PDF: ${m.title}`);
  }
  for (const p of await all('SELECT name, image_id FROM persons')) add(p.image_id, `Тұлға: ${p.name}`);
  for (const q of await all('SELECT q.image_id, x.title FROM questions q LEFT JOIN tests x ON x.id = q.test_id WHERE q.image_id IS NOT NULL')) {
    add(q.image_id, `Тест сұрағы: ${q.title}`);
  }
  for (const o of await all(
    'SELECT o.image_id, x.title FROM options o JOIN questions q ON q.id = o.question_id LEFT JOIN tests x ON x.id = q.test_id WHERE o.image_id IS NOT NULL',
  )) {
    add(o.image_id, `Жауап нұсқасы: ${o.title}`);
  }
  for (const x of await all('SELECT title, cover_image_id FROM tests WHERE cover_image_id IS NOT NULL')) add(x.cover_image_id, `Тест мұқабасы: ${x.title}`);
  for (const e of await all('SELECT name, file_id FROM emblems')) add(e.file_id, `Эмблема: ${e.name}`);
  for (const b of await all('SELECT title, cover_id FROM books WHERE cover_id IS NOT NULL')) add(b.cover_id, `Кітап мұқабасы: ${b.title}`);
  const texts = await readSetting('texts', {});
  add(optId(texts.banner_image_id), 'Басты баннер');
  const icons = await readSetting('icons', {});
  for (const [slot, icon] of Object.entries(icons)) if (icon?.kind === 'file') add(icon.id, `Белгіше: ${slot}`);
  return uses;
}

async function draftTests() {
  const tests = await all(
    `SELECT x.id, CASE WHEN t.deleted = 0 THEN x.topic_id END AS topic_id, x.position, x.title, x.description, x.cover_image_id,
            x.grade, x.publisher, x.subject, x.book_year, x.book_authors, x.book_pages, x.settings, x.published, x.updated_at
     FROM tests x LEFT JOIN topics t ON t.id = x.topic_id ORDER BY x.topic_id, x.position, x.id`,
  );
  const questions = await all('SELECT * FROM questions WHERE test_id IS NOT NULL');
  const options = await all('SELECT o.* FROM options o JOIN questions q ON q.id = o.question_id');
  const testOf = new Map(questions.map((q) => [q.id, q.test_id]));
  return tests.map((x) => ({
    ...x,
    settings: settingsOf(x.settings),
    questions: assembleQuestions(
      questions.filter((q) => q.test_id === x.id),
      options.filter((o) => testOf.get(o.question_id) === x.id),
    ),
  }));
}

async function state() {
  await ensureLinks();
  const links = new Map((await all('SELECT test_id, share_id, enabled FROM test_links')).map((l) => [l.test_id, l]));
  const uses = await fileUsage();
  const live = new Set((await published()).tests.map((x) => x.id));
  return {
    periods: await all('SELECT id, slug, position, title, range_label, summary FROM periods ORDER BY position, id'),
    topics: (await all('SELECT * FROM topics WHERE deleted = 0 ORDER BY period_id, position, id')).map((t) => ({
      ...t,
      key_points: JSON.parse(t.key_points || '[]'),
      icon: JSON.parse(t.icon || 'null'),
    })),
    // A test of a deleted topic is shown as unlinked until the organizer picks a new topic.
    tests: (await draftTests()).map(({ questions, ...x }) => ({
      ...x,
      question_count: gradable(questions).length,
      problems: testProblems({ ...x, questions }),
      live: live.has(x.id),
      share_id: links.get(x.id)?.share_id ?? null,
      link_enabled: Boolean(links.get(x.id)?.enabled),
    })),
    persons: (await all('SELECT * FROM persons ORDER BY position, id')).map((p) => ({ ...p, facts: JSON.parse(p.facts || '[]') })),
    files: (await all("SELECT id, kind, name, mime, size, topic_id, material_id, version, created_at, updated_at FROM files WHERE kind NOT IN ('bookpdf', 'pdf_upload') ORDER BY id DESC")).map(
      (f) => ({ ...f, used_by: uses.get(f.id) || [] }),
    ),
    emblems: await all('SELECT e.id, e.name, e.category, e.file_id, f.version FROM emblems e JOIN files f ON f.id = e.file_id ORDER BY e.id DESC'),
    feedback_new: (await get("SELECT COUNT(*) AS n FROM feedback WHERE status = 'new'")).n,
    books: await get('SELECT COUNT(*) AS total, COALESCE(SUM(published), 0) AS published FROM books'),
    texts: await readSetting('texts', {}),
    icons: await readSetting('icons', {}),
    status: await draftStatus(),
    limits: Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, { max: v.max, limit: v.limit, types: v.types }])),
  };
}

async function testDetail(id) {
  const test = (await draftTests()).find((x) => x.id === id);
  if (!test) return null;
  return { ...test, problems: testProblems(test), live_state: await testLiveState(id) };
}

// ─── Test builder input ───────────────────────────────────────────
/**
 * Reads the questions the cabinet sends into the question model (see questions.js).
 * Saving is lenient so an unfinished test can be kept as a draft; testProblems() decides publishing.
 */
function parseQuestions(input, files) {
  const one = (q, label, inContext) => {
    let type = TYPES.includes(q?.type) ? q.type : 'single';
    if (inContext && type === 'context') type = 'single';
    const imageId = optId(q?.image_id);
    if (imageId) files.add(imageId);
    const out = {
      id: optId(q?.id),
      type,
      text: str(q?.text, type === 'context' ? 300 : 2000, label),
      explanation: str(q?.explanation, 2000, `${label}: түсініктеме`),
      image_id: imageId,
      points: Math.max(0, Math.min(100, Math.round(Number(q?.points ?? 1)))),
      options: [],
      data: dataOf(type, q?.data),
    };
    if (Number.isNaN(out.points)) out.points = 1;
    if (CHOICE_TYPES.includes(type)) {
      out.options = (Array.isArray(q?.options) ? q.options : []).slice(0, 10).map((o, oi) => {
        const oImage = optId(o?.image_id);
        if (oImage) files.add(oImage);
        return { id: optId(o?.id), text: str(o?.text, 500, `${label}, ${oi + 1}-жауап`), image_id: oImage, is_correct: Boolean(o?.is_correct) };
      });
    }
    if (type === 'context') {
      out.points = 0;
      out.children = (Array.isArray(q?.children) ? q.children : []).slice(0, 40).map((c, ci) => one(c, `${label}, ${ci + 1}-сұрақ`, true));
    }
    return out;
  };
  return (Array.isArray(input) ? input : []).slice(0, 200).map((q, i) => one(q, `${i + 1}-сұрақ`, false));
}

const tag = (r) => {
  if (r.error) fail(r.error);
  return r.value;
};

async function parseTest(body) {
  const topicId = optId(body.topic_id);
  if (!topicId) fail('Тестті тақырыпқа байланыстырыңыз.');
  await checkTopic(topicId);
  const coverId = optId(body.cover_image_id);
  const files = new Set(coverId ? [coverId] : []);
  const test = {
    topic_id: topicId,
    title: str(body.title, 160, 'Тест атауы', { required: true }),
    description: str(body.description, 2000, 'Сипаттама'),
    cover_image_id: coverId,
    grade: tag(gradeOf(body.grade)),
    publisher: tag(publisherOf(body.publisher)),
    ...tag(textbookOf(body)),
    settings: settingsOf(body.settings),
    questions: parseQuestions(body.questions, files),
  };
  if (files.size) {
    const found = await all(`SELECT id FROM files WHERE kind = 'image' AND id IN (${[...files].join(',')})`);
    if (found.length < files.size) fail('Тесттегі кейбір сурет табылмады. Суретті қайта жүктеңіз.');
  }
  return test;
}

/** Writes a parsed test over test `id`: rows are kept by id, new ones inserted, the rest removed. */
async function writeTest(id, test) {
  const existingQ = new Set((await all('SELECT id FROM questions WHERE test_id = ?', id)).map((r) => r.id));
  const existingO = new Map(
    (await all('SELECT o.id, o.question_id FROM options o JOIN questions q ON q.id = o.question_id WHERE q.test_id = ?', id)).map((r) => [
      r.id,
      r.question_id,
    ]),
  );
  let nextQ = (await get("SELECT MAX(COALESCE((SELECT MAX(id) FROM questions), 0), COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'questions'), 0)) AS m")).m;
  let nextO = (await get("SELECT MAX(COALESCE((SELECT MAX(id) FROM options), 0), COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'options'), 0)) AS m")).m;
  const statements = [
    [
      "UPDATE tests SET title = ?, topic_id = ?, description = ?, cover_image_id = ?, grade = ?, publisher = ?, subject = ?, book_year = ?, book_authors = ?, book_pages = ?, settings = ?, updated_at = datetime('now') WHERE id = ?",
      test.title, test.topic_id, test.description, test.cover_image_id, test.grade ?? null, test.publisher ?? '',
      test.subject ?? '', test.book_year ?? null, test.book_authors ?? '', test.book_pages ?? '', JSON.stringify(test.settings), id,
    ],
  ];
  const keptQ = new Set();
  const keptO = new Set();
  const put = (q, position, parentId) => {
    let qid = q.id && existingQ.has(q.id) && !keptQ.has(q.id) ? q.id : null;
    const values = [position, q.type, q.text, q.explanation, q.image_id, q.points, JSON.stringify(q.data), parentId, test.topic_id];
    if (qid) {
      statements.push([
        'UPDATE questions SET position = ?, type = ?, text = ?, explanation = ?, image_id = ?, points = ?, data = ?, parent_id = ?, topic_id = ? WHERE id = ?',
        ...values, qid,
      ]);
    } else {
      qid = ++nextQ;
      statements.push([
        'INSERT INTO questions (position, type, text, explanation, image_id, points, data, parent_id, topic_id, id, test_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ...values, qid, id,
      ]);
    }
    keptQ.add(qid);
    q.options.forEach((o, oi) => {
      let oid = o.id && existingO.get(o.id) === qid && !keptO.has(o.id) ? o.id : null;
      if (oid) {
        statements.push(['UPDATE options SET position = ?, text = ?, image_id = ?, is_correct = ? WHERE id = ?', oi + 1, o.text, o.image_id, bool(o.is_correct), oid]);
      } else {
        oid = ++nextO;
        statements.push([
          'INSERT INTO options (id, question_id, position, text, image_id, is_correct) VALUES (?, ?, ?, ?, ?, ?)',
          oid, qid, oi + 1, o.text, o.image_id, bool(o.is_correct),
        ]);
      }
      keptO.add(oid);
    });
    (q.children || []).forEach((c, ci) => put(c, ci + 1, qid));
  };
  test.questions.forEach((q, i) => put(q, i + 1, null));
  for (const oid of existingO.keys()) if (!keptO.has(oid)) statements.push(['DELETE FROM options WHERE id = ?', oid]);
  for (const qid of existingQ) if (!keptQ.has(qid)) statements.push(['DELETE FROM questions WHERE id = ?', qid]);
  await batch(statements);
}

/** Gives unsaved questions and options stable temporary ids (by position) for the preview. */
function previewIds(questions) {
  let n = 0;
  const walk = (q) => {
    n += 1;
    q.id = q.id || -n;
    q.options.forEach((o, i) => {
      o.id = o.id || -(n * 100 + i + 1);
    });
    (q.children || []).forEach(walk);
  };
  questions.forEach(walk);
  return questions;
}

export const orgRouter = express.Router();

// ─── Session ──────────────────────────────────────────────────────
orgRouter.post(
  '/login',
  wrap(async (req, res) => {
    if (!(process.env.ORGANIZER_PIN || '').trim()) {
      return res.status(503).json({ error: 'Организатор PIN-коды серверде бапталмаған (ORGANIZER_PIN).' });
    }
    const ipKey = `org:${req.ip}`;
    const wait = Math.max(await lockedFor(ipKey), await lockedFor('org:*'));
    if (wait) return res.status(429).json({ error: `Тым көп қате әрекет. ${wait} минуттан кейін қайталаңыз.` });
    const pin = String(req.body?.pin ?? '').trim();
    if (!/^\d{4,12}$/.test(pin) || !pinMatches(pin)) {
      await recordFailure(ipKey, MAX_FAILS);
      await recordFailure('org:*', GLOBAL_MAX_FAILS);
      return res.status(401).json({ error: 'PIN-код қате.' });
    }
    await run('DELETE FROM auth_failures WHERE key = ?', ipKey);
    const token = crypto.randomBytes(32).toString('base64url');
    await run('INSERT INTO org_sessions (token_hash, expires_at) VALUES (?, ?)', tokenHash(token), Date.now() + TTL_MS);
    await run('DELETE FROM org_sessions WHERE expires_at < ?', Date.now());
    setCookie(req, res, token, TTL_MS);
    res.json({ ok: true });
  }),
);

orgRouter.post(
  '/logout',
  wrap(async (req, res) => {
    const token = cookieValue(req);
    if (token) await run('DELETE FROM org_sessions WHERE token_hash = ?', tokenHash(token));
    setCookie(req, res, '', 0);
    res.json({ ok: true });
  }),
);

orgRouter.get(
  '/me',
  wrap(async (req, res) => {
    res.json({ organizer: await isOrganizer(req) });
  }),
);

orgRouter.use(
  wrap(async (req, res, next) => {
    if (!(await isOrganizer(req))) return res.status(401).json({ error: 'Организатор ретінде кіру қажет.' });
    next();
  }),
);

orgRouter.get('/state', wrap(async (_req, res) => res.json(await state())));

// ─── Periods and site texts ───────────────────────────────────────
orgRouter.put(
  '/periods/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    await mustExist('periods', id);
    await run(
      'UPDATE periods SET title = ?, range_label = ?, summary = ? WHERE id = ?',
      str(req.body.title, 80, 'Атауы', { required: true }),
      str(req.body.range_label, 80, 'Кезең уақыты'),
      str(req.body.summary, 400, 'Сипаттама'),
      id,
    );
    res.json({ ok: true });
  }),
);

orgRouter.put(
  '/texts',
  wrap(async (req, res) => {
    const input = req.body?.texts;
    if (!input || typeof input !== 'object') fail('Мәтіндер жіберілмеді.');
    const texts = {};
    for (const [key, value] of Object.entries(input).slice(0, 80)) {
      if (!/^[a-z0-9_]{1,40}$/.test(key)) continue;
      if (key.endsWith('_id')) {
        const id = optId(value);
        await checkFile(id, ['image']);
        if (id) texts[key] = id;
      } else {
        const s = str(value, 600, key);
        if (s) texts[key] = s;
      }
    }
    await run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      'texts',
      JSON.stringify(texts),
    );
    res.json({ ok: true });
  }),
);

orgRouter.put(
  '/icons',
  wrap(async (req, res) => {
    const input = req.body?.icons;
    if (!input || typeof input !== 'object') fail('Белгішелер жіберілмеді.');
    const icons = {};
    for (const [slot, value] of Object.entries(input).slice(0, 40)) {
      if (!/^(nav|period)\.[a-z0-9]{1,20}$/.test(slot)) continue;
      const icon = await parseIcon(value);
      if (icon) icons[slot] = icon;
    }
    await run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      'icons',
      JSON.stringify(icons),
    );
    res.json({ ok: true });
  }),
);

// ─── Topics ───────────────────────────────────────────────────────
/**
 * The grade and publisher of a topic: one of 6–11-сынып × Атамұра / Мектеп, required.
 * A topic made before this field keeps having none while a request does not touch it (publishing
 * from the list, assigning an emblem); the topic editor always sends it and must choose one.
 */
function topicClass(body, before) {
  const sent = Boolean(body.grade) || Boolean(String(body.publisher ?? '').trim());
  // Nothing chosen in this request: an existing topic keeps what it has (it can never be emptied).
  if (!sent && before) return { grade: before.grade ?? null, publisher: before.publisher || '' };
  const grade = Number(body.grade);
  const publisher = String(body.publisher ?? '').trim();
  if (!TOPIC_GRADES.includes(grade) || !TOPIC_PUBLISHERS.includes(publisher)) {
    fail('Сынып пен баспаны таңдаңыз (мысалы: 8-сынып — Атамұра). Онсыз тақырыпты сақтауға болмайды.');
  }
  return { grade, publisher };
}

async function topicFields(body, id = null) {
  const before = id ? await get('SELECT grade, publisher FROM topics WHERE id = ?', id) : null;
  const cls = topicClass(body, before);
  const periodId = optId(body.period_id);
  if (!periodId || !(await get('SELECT 1 AS ok FROM periods WHERE id = ?', periodId))) fail('Кезеңді таңдаңыз.');
  const title = str(body.title, 160, 'Атауы', { required: true });
  const imageId = optId(body.image_id);
  await checkFile(imageId, ['image']);
  return {
    period_id: periodId,
    title,
    slug: await uniqueSlug(body.slug ? body.slug : title, id),
    range_label: str(body.range_label, 80, 'Уақыты'),
    summary: str(body.summary, 600, 'Қысқаша сипаттама'),
    body: str(body.body, 60000, 'Оқу материалы'),
    key_points: JSON.stringify(parseKeyPoints(body.key_points)),
    image_id: imageId,
    icon: JSON.stringify(await parseIcon(body.icon, EMBLEM_SIZE)),
    published: bool(body.published),
    grade: cls.grade,
    publisher: cls.publisher,
  };
}

orgRouter.post(
  '/topics',
  wrap(async (req, res) => {
    const f = await topicFields(req.body || {});
    const position = await nextPosition('topics', 'WHERE period_id = ?', f.period_id);
    const { lastInsertRowid } = await run(
      `INSERT INTO topics (period_id, slug, position, title, range_label, summary, body, key_points, image_id, icon, published, grade, publisher)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      f.period_id, f.slug, position, f.title, f.range_label, f.summary, f.body, f.key_points, f.image_id, f.icon, f.published, f.grade, f.publisher,
    );
    res.status(201).json({ id: lastInsertRowid, slug: f.slug });
  }),
);

orgRouter.put(
  '/topics/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    await mustExist('topics', id);
    const before = await get('SELECT period_id FROM topics WHERE id = ?', id);
    const f = await topicFields(req.body || {}, id);
    const position = before.period_id === f.period_id ? null : await nextPosition('topics', 'WHERE period_id = ?', f.period_id);
    await run(
      `UPDATE topics SET period_id = ?, slug = ?, title = ?, range_label = ?, summary = ?, body = ?, key_points = ?,
              image_id = ?, icon = ?, published = ?, grade = ?, publisher = ?, position = COALESCE(?, position) WHERE id = ?`,
      f.period_id, f.slug, f.title, f.range_label, f.summary, f.body, f.key_points, f.image_id, f.icon, f.published, f.grade, f.publisher, position, id,
    );
    res.json({ ok: true, slug: f.slug });
  }),
);

orgRouter.delete(
  '/topics/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    await mustExist('topics', id);
    const mode = req.query.mode === 'cascade' ? 'cascade' : 'keep';
    const statements =
      mode === 'cascade'
        ? [
            ['DELETE FROM options WHERE question_id IN (SELECT q.id FROM questions q JOIN tests x ON x.id = q.test_id WHERE x.topic_id = ?)', id],
            ['DELETE FROM questions WHERE test_id IN (SELECT id FROM tests WHERE topic_id = ?)', id],
            ['DELETE FROM tests WHERE topic_id = ?', id],
            ['UPDATE materials SET topic_id = NULL, published = 0 WHERE topic_id = ?', id],
            ['DELETE FROM persons WHERE topic_id = ?', id],
          ]
        : [
            // Kept content stays in the cabinet without a topic and is hidden from students until relinked.
            // Tests keep the old topic id (questions need one) and show as unlinked.
            ['UPDATE tests SET published = 0 WHERE topic_id = ?', id],
            ['UPDATE materials SET topic_id = NULL, published = 0 WHERE topic_id = ?', id],
            ['UPDATE persons SET topic_id = NULL WHERE topic_id = ?', id],
          ];
    // The row stays (marked deleted) so students' saved results keep their topic.
    statements.push(["UPDATE topics SET deleted = 1, published = 0, image_id = NULL, slug = 'deleted-' || id WHERE id = ?", id]);
    await batch(statements);
    res.json({ ok: true, mode });
  }),
);

function reorderRoute(table) {
  return wrap(async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
    if (!ids.length) fail('Рет жіберілмеді.');
    await batch(ids.map((id, i) => [`UPDATE ${table} SET position = ? WHERE id = ?`, i + 1, id]));
    res.json({ ok: true });
  });
}

orgRouter.post('/topics/reorder', reorderRoute('topics'));
orgRouter.post('/tests/reorder', reorderRoute('tests'));
orgRouter.post('/persons/reorder', reorderRoute('persons'));

// ─── Persons (khans and historical figures) ───────────────────────
async function personFields(body) {
  const topicId = optId(body.topic_id);
  await checkTopic(topicId);
  const imageId = optId(body.image_id);
  await checkFile(imageId, ['image']);
  const facts = (Array.isArray(body.facts) ? body.facts : [])
    .map((f) => str(f, 400, 'Тарихи дерек'))
    .filter(Boolean)
    .slice(0, 30);
  return {
    topic_id: topicId,
    name: str(body.name, 120, 'Аты', { required: true }),
    role: str(body.role, 120, 'Лауазымы'),
    reign: str(body.reign, 80, 'Билік жылдары'),
    biography: str(body.biography, 20000, 'Өмірбаяны'),
    facts: JSON.stringify(facts),
    image_id: imageId,
    published: bool(body.published),
  };
}

orgRouter.post(
  '/persons',
  wrap(async (req, res) => {
    const f = await personFields(req.body || {});
    const position = await nextPosition('persons');
    const { lastInsertRowid } = await run(
      'INSERT INTO persons (topic_id, position, name, role, reign, biography, facts, image_id, published) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      f.topic_id, position, f.name, f.role, f.reign, f.biography, f.facts, f.image_id, f.published,
    );
    res.status(201).json({ id: lastInsertRowid });
  }),
);

orgRouter.put(
  '/persons/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    await mustExist('persons', id);
    const f = await personFields(req.body || {});
    await run(
      `UPDATE persons SET topic_id = ?, name = ?, role = ?, reign = ?, biography = ?, facts = ?, image_id = ?, published = ?,
              updated_at = datetime('now') WHERE id = ?`,
      f.topic_id, f.name, f.role, f.reign, f.biography, f.facts, f.image_id, f.published, id,
    );
    res.json({ ok: true });
  }),
);

orgRouter.delete(
  '/persons/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    await mustExist('persons', id);
    await run('DELETE FROM persons WHERE id = ?', id);
    res.json({ ok: true });
  }),
);

// ─── Tests ────────────────────────────────────────────────────────
const sendTest = async (res, id, status = 200) => res.status(status).json(await testDetail(id));

orgRouter.get(
  '/tests/:id',
  wrap(async (req, res) => {
    const test = await testDetail(Number(req.params.id));
    if (!test) return res.status(404).json({ error: 'Тест табылмады.' });
    res.json(test);
  }),
);

/** New test: only a topic and title are needed; a full builder body is saved as well. */
orgRouter.post(
  '/tests',
  wrap(async (req, res) => {
    const test = await parseTest(req.body || {});
    const position = await nextPosition('tests', 'WHERE topic_id = ?', test.topic_id);
    const { lastInsertRowid } = await run('INSERT INTO tests (topic_id, position, title, published) VALUES (?, ?, ?, 0)', test.topic_id, position, test.title);
    await writeTest(lastInsertRowid, test);
    await sendTest(res, lastInsertRowid, 201);
  }),
);

/** Saves the whole test as a draft. A live test keeps showing its published version until it is published again. */
orgRouter.put(
  '/tests/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    await mustExist('tests', id);
    await writeTest(id, await parseTest(req.body || {}));
    await sendTest(res, id);
  }),
);

/** Publishes this test to students now, after the full check; the rest of the draft is untouched. */
orgRouter.post(
  '/tests/:id/publish',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    await mustExist('tests', id);
    const test = await testDetail(id);
    if (test.problems.length) return res.status(400).json({ error: 'Тест жарияланбады: алдымен қателерді түзетіңіз.', problems: test.problems });
    await run('UPDATE tests SET published = 1 WHERE id = ?', id);
    const error = await publishTest(id, true, `Тест жарияланды: ${test.title}`);
    if (error) {
      await run('UPDATE tests SET published = 0 WHERE id = ?', id);
      return res.status(400).json({ error, problems: [error] });
    }
    await sendTest(res, id);
  }),
);

orgRouter.post(
  '/tests/:id/hide',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    await mustExist('tests', id);
    const test = await get('SELECT title FROM tests WHERE id = ?', id);
    await run('UPDATE tests SET published = 0 WHERE id = ?', id);
    await publishTest(id, false, `Тест жасырылды: ${test.title}`);
    await sendTest(res, id);
  }),
);

orgRouter.post(
  '/tests/:id/duplicate',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    await mustExist('tests', id);
    const source = await testDetail(id);
    const strip = (q) => ({ ...q, id: null, options: q.options.map((o) => ({ ...o, id: null })), children: q.children?.map(strip) });
    const copy = { ...source, title: `${source.title} (көшірме)`.slice(0, 160), questions: source.questions.map(strip) };
    const topicId = source.topic_id ?? (await get('SELECT topic_id FROM tests WHERE id = ?', id)).topic_id;
    const position = await nextPosition('tests', 'WHERE topic_id = ?', topicId);
    const { lastInsertRowid } = await run('INSERT INTO tests (topic_id, position, title, published) VALUES (?, ?, ?, 0)', topicId, position, copy.title);
    await writeTest(lastInsertRowid, { ...copy, topic_id: topicId });
    await sendTest(res, lastInsertRowid, 201);
  }),
);

/**
 * Student view of the test as it is in the builder now, without saving anything:
 * without answers it returns the paper; with answers it grades them. Nothing is stored.
 */
orgRouter.post(
  '/preview',
  wrap(async (req, res) => {
    const body = req.body?.test || {};
    const test = await parseTest({ ...body, title: String(body.title || '').trim() || 'Атаусыз тест' });
    test.questions = previewIds(test.questions);
    const ready = { ...test, questions: readyQuestions(test.questions) };
    const problems = testProblems(test);
    if (!gradable(ready.questions).length) {
      return res.status(400).json({ error: 'Алдын ала қарауға дайын сұрақ жоқ.', problems });
    }
    const answers = req.body?.answers;
    if (answers && typeof answers === 'object') {
      const served = Array.isArray(req.body?.served) ? req.body.served.map(Number) : gradable(ready.questions).map((q) => q.id);
      const result = grade(ready, served, answers, test.settings);
      return res.json({ ...result, stored: undefined, passed: result.percent >= test.settings.pass_percent, pass_percent: test.settings.pass_percent });
    }
    const paper = studentPaper(ready, test.settings);
    res.json({ title: test.title, description: test.description, cover_image_id: test.cover_image_id, ...paper.meta, units: paper.units, served: paper.served, problems });
  }),
);

orgRouter.delete(
  '/tests/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    await mustExist('tests', id);
    const title = (await get('SELECT title FROM tests WHERE id = ?', id)).title;
    await batch([
      ['DELETE FROM options WHERE question_id IN (SELECT id FROM questions WHERE test_id = ?)', id],
      ['DELETE FROM questions WHERE test_id = ?', id],
      ['DELETE FROM tests WHERE id = ?', id],
    ]);
    // A deleted test also leaves the students' pages at once.
    if ((await published()).tests.some((x) => x.id === id)) await publishTest(id, false, `Тест өшірілді: ${title}`);
    res.json({ ok: true });
  }),
);

// ─── Suggestions from students (feedback.js) ─────────────────────
orgRouter.use('/feedback', orgFeedbackRouter);
orgRouter.use('/books', orgBooksRouter);
orgRouter.use('/links', orgLinksRouter);

// ─── Question import and export (layout in transfer.js) ───────────
const rawBody = express.raw({ type: () => true, limit: UPLOAD_LIMIT });
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// File names are in Latin letters: some browsers and phones drop a Kazakh file name and save "download".
function sendSheet(res, buf, format, name) {
  res.set('Content-Type', format === 'csv' ? 'text/csv; charset=utf-8' : XLSX_MIME);
  res.set('Content-Disposition', `attachment; filename="${latin(name) || 'qadam'}.${format}"`);
  res.set('Cache-Control', 'no-store');
  res.send(buf);
}

orgRouter.get(
  '/tests/:id/export',
  wrap(async (req, res) => {
    const test = await testDetail(Number(req.params.id));
    if (!test) return res.status(404).json({ error: 'Тест табылмады.' });
    const format = req.query.format === 'csv' ? 'csv' : 'xlsx';
    sendSheet(res, exportFile(test.questions, format, test.title), format, `qadam ${test.title} suraqtar`);
  }),
);

orgRouter.get(
  '/import/template',
  wrap(async (_req, res) => {
    sendSheet(res, templateFile(), 'xlsx', 'qadam suraqtar ulgisi');
  }),
);

/** Where each question text already is: duplicate key → [{ id, title }] of draft tests. */
async function questionIndex() {
  const index = new Map();
  for (const t of await draftTests()) {
    for (const q of t.questions.flatMap((x) => (x.type === 'context' ? [x, ...x.children] : [x]))) {
      const key = duplicateKey(q);
      if (!index.has(key)) index.set(key, []);
      if (!index.get(key).some((x) => x.id === t.id)) index.get(key).push({ id: t.id, title: t.title });
    }
  }
  return index;
}

const flat = (questions) => questions.flatMap((q) => (q.type === 'context' ? [q, ...q.children] : [q]));

/** Reads an uploaded file and returns what would be imported. Nothing is saved here. */
orgRouter.post(
  '/import/parse',
  rawBody,
  wrap(async (req, res) => {
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!buf.length) fail('Файл таңдалмады немесе бос.');
    let sheet;
    try {
      sheet = readSpreadsheet(buf);
    } catch (err) {
      fail(err.message);
    }
    const { questions, errors, warnings, images = [] } = rowsToQuestions(sheet.rows);
    const known = new Set(
      images.length ? (await all(`SELECT id FROM files WHERE kind = 'image' AND id IN (${images.map(Number).join(',')})`)).map((r) => r.id) : [],
    );
    dropMissingImages(questions, known, warnings);
    // A picture question whose picture is missing cannot be shown to students.
    const usable = [];
    for (const q of questions) {
      const lost = flat([q]).find((x) => x.type === 'image' && !x.image_id);
      if (lost) errors.push({ row: lost.row, column: 'Сурет', message: 'Суретпен берілетін сұрақтың суреті табылмады: кабинеттегі суреттің ID нөмірін жазыңыз.' });
      else usable.push(q);
    }
    errors.sort((a, b) => a.row - b.row);
    const index = await questionIndex();
    const seen = new Map();
    for (const q of flat(usable)) {
      const key = duplicateKey(q);
      q.duplicate = { tests: index.get(key) || [], row: seen.get(key) || null };
      if (!seen.has(key)) seen.set(key, q.row);
    }
    const asked = flat(usable).filter((q) => q.type !== 'context');
    const byType = {};
    for (const q of asked) byType[q.type] = (byType[q.type] || 0) + 1;
    res.json({ format: sheet.format, questions: usable, count: asked.length, by_type: byType, errors, warnings });
  }),
);

/** Saves checked questions into an existing test (appended) or a new one, in one write. */
orgRouter.post(
  '/import/commit',
  wrap(async (req, res) => {
    const body = req.body || {};
    const incoming = Array.isArray(body.questions) ? body.questions : [];
    if (!incoming.length) fail('Импорттайтын сұрақ жоқ.');
    const skip = Boolean(body.skip_duplicates);
    let base;
    if (body.target === 'existing') {
      const id = Number(body.test_id);
      base = await testDetail(id);
      if (!base) fail('Таңдалған тест табылмады.');
      if (!base.topic_id) fail('Бұл тест тақырыпқа байланыстырылмаған: алдымен тестке тақырып таңдаңыз.');
    } else if (body.target === 'new') {
      base = { id: null, topic_id: optId(body.topic_id), title: body.title, description: '', cover_image_id: null, settings: {}, questions: [] };
    } else fail('Сұрақтарды қайда қосатыныңызды таңдаңыз.');

    // Duplicates are dropped against the target test and earlier rows of the same file.
    const keys = new Set(flat(base.questions).map(duplicateKey));
    const strip = (q) => ({ ...q, id: null, options: (q.options || []).map((o) => ({ ...o, id: null })), children: q.children?.map(strip) });
    let skipped = 0;
    const added = [];
    for (const raw of incoming) {
      const q = strip(raw);
      if (q.type === 'context') {
        q.children = (q.children || []).filter((c) => {
          const dup = keys.has(duplicateKey(c));
          keys.add(duplicateKey(c));
          if (dup && skip) skipped += 1;
          return !(dup && skip);
        });
        if (!q.children.length) continue;
      } else {
        const dup = keys.has(duplicateKey(q));
        keys.add(duplicateKey(q));
        if (dup && skip) {
          skipped += 1;
          continue;
        }
      }
      added.push(q);
    }
    if (!added.length) fail('Барлық сұрақ қайталанады: қосылатын жаңа сұрақ қалмады.');
    if (base.questions.length + added.length > 200) {
      fail(`Бір тестте ең көбі 200 сұрақ (блок) болады: тестте ${base.questions.length}, импортта ${added.length}.`);
    }
    // parseTest checks every field and picture again, so a hand-made request cannot store bad data.
    const test = await parseTest({ ...base, questions: [...base.questions, ...added] });
    const count = gradable(test.questions.slice(base.questions.length)).length;
    let id = base.id;
    if (id) await writeTest(id, test);
    else {
      const position = await nextPosition('tests', 'WHERE topic_id = ?', test.topic_id);
      id = Number((await run('INSERT INTO tests (topic_id, position, title, published) VALUES (?, ?, ?, 0)', test.topic_id, position, test.title)).lastInsertRowid);
      try {
        await writeTest(id, test);
      } catch (err) {
        await run('DELETE FROM tests WHERE id = ?', id);
        throw err;
      }
    }
    res.status(201).json({ test_id: id, added: count, skipped, test: await testDetail(id) });
  }),
);

// ─── Emblem library: the organizer's own uploads (the built-in set is in emblems.js) ───
const CATEGORY_KEYS = EMBLEM_CATEGORIES.map(([k]) => k);
const emblemFields = (body) => {
  const category = String(body?.category || '');
  if (!CATEGORY_KEYS.includes(category)) fail('Эмблема санатын таңдаңыз.');
  return { name: str(body?.name, 80, 'Эмблема атауы', { required: true }), category };
};

orgRouter.post(
  '/emblems',
  wrap(async (req, res) => {
    const f = emblemFields(req.body);
    const fileId = optId(req.body?.file_id);
    if (!fileId) fail('Эмблема файлын жүктеңіз.');
    await checkFile(fileId, ['icon', 'image']);
    const { lastInsertRowid } = await run('INSERT INTO emblems (name, category, file_id) VALUES (?, ?, ?)', f.name, f.category, fileId);
    res.status(201).json({ id: lastInsertRowid });
  }),
);

orgRouter.put(
  '/emblems/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    await mustExist('emblems', id);
    const f = emblemFields(req.body);
    await run('UPDATE emblems SET name = ?, category = ? WHERE id = ?', f.name, f.category, id);
    res.json({ ok: true });
  }),
);

orgRouter.delete(
  '/emblems/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    await mustExist('emblems', id);
    // The file stays in «Файлдар»: a topic may still show it.
    await run('DELETE FROM emblems WHERE id = ?', id);
    res.json({ ok: true });
  }),
);

// ─── Students: list and temporary passwords (when email reset is not set up) ───
orgRouter.get(
  '/students',
  wrap(async (_req, res) => {
    res.json({
      students: await all(
        `SELECT u.id, u.username, u.email, u.display_name, u.created_at,
                COALESCE(SUM(a.kind = 'test'), 0) AS attempts, COALESCE(SUM(a.kind = 'rework'), 0) AS reworks
         FROM users u LEFT JOIN attempts a ON a.user_id = u.id GROUP BY u.id ORDER BY u.id DESC LIMIT 500`,
      ),
    });
  }),
);

orgRouter.post(
  '/students/:id/password',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    await mustExist('users', id);
    const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
    const password = Array.from(crypto.randomBytes(10), (b) => alphabet[b % alphabet.length]).join('');
    await run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(password), id);
    await endAllSessions(id);
    res.json({ password });
  }),
);

// ─── Files ────────────────────────────────────────────────────────

function uploadName(req) {
  try {
    return decodeURIComponent(String(req.get('X-File-Name') || '')).slice(0, 120);
  } catch {
    return '';
  }
}

orgRouter.post(
  '/files',
  rawBody,
  wrap(async (req, res) => {
    const kind = String(req.query.kind || '');
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const check = checkUpload(kind, buf);
    if (check.error) fail(check.error);
    const topicId = optId(req.query.topic_id);
    await checkTopic(topicId);
    const { lastInsertRowid } = await run(
      'INSERT INTO files (kind, name, mime, size, data, topic_id) VALUES (?, ?, ?, ?, ?, ?)',
      kind,
      uploadName(req) || KINDS[kind].label,
      check.mime,
      buf.length,
      buf,
      topicId,
    );
    res.status(201).json(await get('SELECT id, kind, name, mime, size, topic_id, material_id, version FROM files WHERE id = ?', lastInsertRowid));
  }),
);

orgRouter.put(
  '/files/:id/content',
  rawBody,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const file = await get('SELECT kind FROM files WHERE id = ?', id);
    if (!file) return res.status(404).json({ error: 'Файл табылмады.' });
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const check = checkUpload(file.kind, buf);
    if (check.error) fail(check.error);
    await run(
      `UPDATE files SET data = ?, mime = ?, size = ?, version = version + 1, updated_at = datetime('now') WHERE id = ?`,
      buf,
      check.mime,
      buf.length,
      id,
    );
    res.json(await get('SELECT id, kind, name, mime, size, topic_id, material_id, version FROM files WHERE id = ?', id));
  }),
);

orgRouter.put(
  '/files/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    await mustExist('files', id);
    const topicId = optId(req.body?.topic_id);
    await checkTopic(topicId);
    const materialId = optId(req.body?.material_id);
    if (materialId && !(await get('SELECT 1 AS ok FROM materials WHERE id = ?', materialId))) fail('Материал табылмады.');
    await run(
      `UPDATE files SET name = ?, topic_id = ?, material_id = ?, updated_at = datetime('now') WHERE id = ?`,
      str(req.body?.name, 120, 'Атауы', { required: true }),
      topicId,
      materialId,
      id,
    );
    res.json({ ok: true });
  }),
);

orgRouter.delete(
  '/files/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    await mustExist('files', id);
    const used = (await fileUsage()).get(id) || [];
    if (used.length && req.query.force !== '1') {
      return res.status(409).json({ error: 'Файл сайтта қолданылып тұр.', used_by: used });
    }
    // Detach every reference so nothing points at a missing file.
    const texts = await readSetting('texts', {});
    const icons = await readSetting('icons', {});
    if (optId(texts.banner_image_id) === id) delete texts.banner_image_id;
    for (const [slot, icon] of Object.entries(icons)) if (icon?.kind === 'file' && icon.id === id) delete icons[slot];
    const topicIcons = (await all('SELECT id, icon FROM topics')).filter((t) => {
      try {
        const icon = JSON.parse(t.icon || 'null');
        return icon?.kind === 'file' && icon.id === id;
      } catch {
        return false;
      }
    });
    await batch([
      ['UPDATE topics SET image_id = NULL WHERE image_id = ?', id],
      ...topicIcons.map((t) => ["UPDATE topics SET icon = 'null' WHERE id = ?", t.id]),
      ['UPDATE materials SET image_id = NULL WHERE image_id = ?', id],
      ['UPDATE materials SET pdf_id = NULL WHERE pdf_id = ?', id],
      ['UPDATE persons SET image_id = NULL WHERE image_id = ?', id],
      // A book without a cover is never shown broken: it is hidden until a new cover is chosen.
      ['UPDATE books SET cover_id = NULL, published = 0 WHERE cover_id = ?', id],
      ['UPDATE questions SET image_id = NULL WHERE image_id = ?', id],
      ['UPDATE options SET image_id = NULL WHERE image_id = ?', id],
      ["INSERT INTO settings (key, value) VALUES ('texts', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(texts)],
      ["INSERT INTO settings (key, value) VALUES ('icons', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(icons)],
      ['DELETE FROM files WHERE id = ?', id],
    ]);
    res.json({ ok: true });
  }),
);

// ─── Publishing ───────────────────────────────────────────────────
orgRouter.get(
  '/publications',
  wrap(async (_req, res) => {
    res.json({ status: await draftStatus(), publications: await listPublications() });
  }),
);

orgRouter.post(
  '/publish',
  wrap(async (req, res) => {
    const id = await publish(str(req.body?.note, 200, 'Түсініктеме'));
    res.json({ ok: true, id });
  }),
);

orgRouter.post(
  '/publications/:id/restore',
  wrap(async (req, res) => {
    if (!(await restoreDraft(Number(req.params.id)))) return res.status(404).json({ error: 'Нұсқа табылмады.' });
    res.json({ ok: true });
  }),
);

orgRouter.use((err, _req, res, next) => {
  if (err instanceof Invalid) return res.status(err.status || 400).json({ error: err.message });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Файл тым үлкен (ең көбі 4 МБ).' });
  next(err);
});
