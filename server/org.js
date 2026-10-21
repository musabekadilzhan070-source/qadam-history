import crypto from 'node:crypto';
import express from 'express';
import { config } from './config.js';
import { all, get, run, batch } from './db.js';
import { KINDS, UPLOAD_LIMIT, checkUpload } from './files.js';
import { draftStatus, publish, listPublications, restoreDraft, readSetting } from './publish.js';

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

const TRANSLIT = {
  а: 'a', ә: 'a', б: 'b', в: 'v', г: 'g', ғ: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i', к: 'k', қ: 'k',
  л: 'l', м: 'm', н: 'n', ң: 'n', о: 'o', ө: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ұ: 'u', ү: 'u', ф: 'f', х: 'h',
  һ: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'y', і: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

async function uniqueSlug(title, exceptId = null) {
  const base =
    String(title)
      .toLowerCase()
      .split('')
      .map((c) => TRANSLIT[c] ?? c)
      .join('')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'takyryp';
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

const ICON_NAMES = ['home', 'periods', 'tests', 'materials', 'results', 'profile', 'book', 'clock', 'search', 'check', 'arrow', 'logout'];
const EMBLEM_NAMES = ['emblem-1', 'emblem-2', 'emblem-3', 'emblem-4'];

async function parseIcon(v) {
  if (!v || typeof v !== 'object') return null;
  const size = Math.max(14, Math.min(64, Math.round(Number(v.size) || 22)));
  if (v.kind === 'builtin') {
    if (![...ICON_NAMES, ...EMBLEM_NAMES].includes(v.name)) fail('Мұндай белгіше кітапханада жоқ.');
    return { kind: 'builtin', name: v.name, size };
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
  const texts = await readSetting('texts', {});
  add(optId(texts.banner_image_id), 'Басты баннер');
  const icons = await readSetting('icons', {});
  for (const [slot, icon] of Object.entries(icons)) if (icon?.kind === 'file') add(icon.id, `Белгіше: ${slot}`);
  return uses;
}

async function state() {
  const uses = await fileUsage();
  const counts = await all(
    `SELECT x.id, COUNT(DISTINCT q.id) AS question_count,
            SUM(CASE WHEN q.id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM options o WHERE o.question_id = q.id AND o.is_correct = 1) THEN 1 ELSE 0 END) AS missing_correct
     FROM tests x LEFT JOIN questions q ON q.test_id = x.id GROUP BY x.id`,
  );
  const countById = new Map(counts.map((c) => [c.id, c]));
  return {
    periods: await all('SELECT id, slug, position, title, range_label, summary FROM periods ORDER BY position, id'),
    topics: (await all('SELECT * FROM topics WHERE deleted = 0 ORDER BY period_id, position, id')).map((t) => ({
      ...t,
      key_points: JSON.parse(t.key_points || '[]'),
      icon: JSON.parse(t.icon || 'null'),
    })),
    // A test of a deleted topic is shown as unlinked until the organizer picks a new topic.
    tests: (
      await all(
        `SELECT x.id, CASE WHEN t.deleted = 0 THEN x.topic_id END AS topic_id, x.position, x.title, x.published, x.updated_at
         FROM tests x LEFT JOIN topics t ON t.id = x.topic_id ORDER BY x.topic_id, x.position, x.id`,
      )
    ).map((x) => ({
      ...x,
      question_count: countById.get(x.id)?.question_count || 0,
      missing_correct: countById.get(x.id)?.missing_correct || 0,
    })),
    materials: await all('SELECT * FROM materials ORDER BY topic_id, position, id'),
    persons: (await all('SELECT * FROM persons ORDER BY position, id')).map((p) => ({ ...p, facts: JSON.parse(p.facts || '[]') })),
    files: (await all('SELECT id, kind, name, mime, size, topic_id, material_id, version, created_at, updated_at FROM files ORDER BY id DESC')).map(
      (f) => ({ ...f, used_by: uses.get(f.id) || [] }),
    ),
    texts: await readSetting('texts', {}),
    icons: await readSetting('icons', {}),
    status: await draftStatus(),
    limits: Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, { max: v.max, limit: v.limit, types: v.types }])),
  };
}

async function testDetail(id) {
  const test = await get(
    `SELECT x.id, CASE WHEN t.deleted = 0 THEN x.topic_id END AS topic_id, x.position, x.title, x.published, x.updated_at
     FROM tests x LEFT JOIN topics t ON t.id = x.topic_id WHERE x.id = ?`,
    id,
  );
  if (!test) return null;
  const questions = await all('SELECT id, text, explanation, image_id FROM questions WHERE test_id = ? ORDER BY position, id', id);
  const options = await all(
    `SELECT o.id, o.question_id, o.text, o.image_id, o.is_correct FROM options o JOIN questions q ON q.id = o.question_id
     WHERE q.test_id = ? ORDER BY o.position, o.id`,
    id,
  );
  return {
    ...test,
    questions: questions.map((q) => ({
      ...q,
      options: options.filter((o) => o.question_id === q.id).map((o) => ({ id: o.id, text: o.text, image_id: o.image_id, is_correct: Boolean(o.is_correct) })),
    })),
  };
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
async function topicFields(body, id = null) {
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
    icon: JSON.stringify(await parseIcon(body.icon)),
    published: bool(body.published),
  };
}

orgRouter.post(
  '/topics',
  wrap(async (req, res) => {
    const f = await topicFields(req.body || {});
    const position = await nextPosition('topics', 'WHERE period_id = ?', f.period_id);
    const { lastInsertRowid } = await run(
      `INSERT INTO topics (period_id, slug, position, title, range_label, summary, body, key_points, image_id, icon, published)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      f.period_id, f.slug, position, f.title, f.range_label, f.summary, f.body, f.key_points, f.image_id, f.icon, f.published,
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
              image_id = ?, icon = ?, published = ?, position = COALESCE(?, position) WHERE id = ?`,
      f.period_id, f.slug, f.title, f.range_label, f.summary, f.body, f.key_points, f.image_id, f.icon, f.published, position, id,
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
            ['DELETE FROM materials WHERE topic_id = ?', id],
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
orgRouter.post('/materials/reorder', reorderRoute('materials'));
orgRouter.post('/tests/reorder', reorderRoute('tests'));
orgRouter.post('/persons/reorder', reorderRoute('persons'));

// ─── Materials ────────────────────────────────────────────────────
async function materialFields(body) {
  const topicId = optId(body.topic_id);
  await checkTopic(topicId);
  const imageId = optId(body.image_id);
  const pdfId = optId(body.pdf_id);
  await checkFile(imageId, ['image']);
  await checkFile(pdfId, ['pdf']);
  const f = {
    topic_id: topicId,
    title: str(body.title, 160, 'Атауы', { required: true }),
    body: str(body.body, 60000, 'Мәтіні'),
    image_id: imageId,
    pdf_id: pdfId,
    published: bool(body.published),
  };
  if (!f.body && !f.pdf_id) fail('Материалға мәтін жазыңыз немесе PDF файл тіркеңіз.');
  return f;
}

orgRouter.post(
  '/materials',
  wrap(async (req, res) => {
    const f = await materialFields(req.body || {});
    const position = await nextPosition('materials');
    const { lastInsertRowid } = await run(
      'INSERT INTO materials (topic_id, position, title, body, image_id, pdf_id, published) VALUES (?, ?, ?, ?, ?, ?, ?)',
      f.topic_id, position, f.title, f.body, f.image_id, f.pdf_id, f.published,
    );
    res.status(201).json({ id: lastInsertRowid });
  }),
);

orgRouter.put(
  '/materials/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    await mustExist('materials', id);
    const f = await materialFields(req.body || {});
    await run(
      `UPDATE materials SET topic_id = ?, title = ?, body = ?, image_id = ?, pdf_id = ?, published = ?, updated_at = datetime('now') WHERE id = ?`,
      f.topic_id, f.title, f.body, f.image_id, f.pdf_id, f.published, id,
    );
    res.json({ ok: true });
  }),
);

orgRouter.delete(
  '/materials/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    await mustExist('materials', id);
    await batch([
      ['UPDATE files SET material_id = NULL WHERE material_id = ?', id],
      ['DELETE FROM materials WHERE id = ?', id],
    ]);
    res.json({ ok: true });
  }),
);

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
orgRouter.get(
  '/tests/:id',
  wrap(async (req, res) => {
    const test = await testDetail(Number(req.params.id));
    if (!test) return res.status(404).json({ error: 'Тест табылмады.' });
    res.json(test);
  }),
);

orgRouter.post(
  '/tests',
  wrap(async (req, res) => {
    const topicId = optId(req.body?.topic_id);
    if (!topicId) fail('Тестті тақырыпқа байланыстырыңыз.');
    await checkTopic(topicId);
    const title = str(req.body?.title, 160, 'Тест атауы', { required: true });
    const position = await nextPosition('tests', 'WHERE topic_id = ?', topicId);
    const { lastInsertRowid } = await run(
      'INSERT INTO tests (topic_id, position, title, published) VALUES (?, ?, ?, ?)',
      topicId,
      position,
      title,
      bool(req.body?.published),
    );
    res.status(201).json({ id: lastInsertRowid });
  }),
);

/** Saves the whole test: title, topic, visibility and every question with its options. */
orgRouter.put(
  '/tests/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    await mustExist('tests', id);
    const body = req.body || {};
    const topicId = optId(body.topic_id);
    if (!topicId) fail('Тестті тақырыпқа байланыстырыңыз.');
    await checkTopic(topicId);
    const title = str(body.title, 160, 'Тест атауы', { required: true });
    const input = Array.isArray(body.questions) ? body.questions.slice(0, 200) : [];

    const existingQ = new Set((await all('SELECT id FROM questions WHERE test_id = ?', id)).map((r) => r.id));
    const existingO = new Map(
      (await all('SELECT o.id, o.question_id FROM options o JOIN questions q ON q.id = o.question_id WHERE q.test_id = ?', id)).map((r) => [
        r.id,
        r.question_id,
      ]),
    );
    let nextQ = (await get('SELECT COALESCE(MAX(id), 0) AS m FROM questions')).m;
    let nextO = (await get('SELECT COALESCE(MAX(id), 0) AS m FROM options')).m;

    const statements = [
      ['UPDATE tests SET title = ?, topic_id = ?, published = ?, updated_at = datetime(\'now\') WHERE id = ?', title, topicId, bool(body.published), id],
    ];
    const keptQ = new Set();
    const keptO = new Set();
    for (const [qi, q] of input.entries()) {
      const text = str(q?.text, 2000, `${qi + 1}-сұрақ`, { required: true });
      const qImage = optId(q?.image_id);
      await checkFile(qImage, ['image']);
      const options = (Array.isArray(q?.options) ? q.options : []).slice(0, 10);
      if (options.length < 2) fail(`${qi + 1}-сұраққа кемінде екі жауап нұсқасын қосыңыз.`);
      let qid = optId(q?.id);
      if (qid && existingQ.has(qid)) {
        statements.push([
          'UPDATE questions SET position = ?, text = ?, explanation = ?, image_id = ?, topic_id = ? WHERE id = ?',
          qi + 1, text, str(q?.explanation, 2000, 'Түсініктеме'), qImage, topicId, qid,
        ]);
      } else {
        qid = ++nextQ;
        statements.push([
          'INSERT INTO questions (id, topic_id, test_id, position, text, explanation, image_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
          qid, topicId, id, qi + 1, text, str(q?.explanation, 2000, 'Түсініктеме'), qImage,
        ]);
      }
      keptQ.add(qid);
      for (const [oi, o] of options.entries()) {
        const oText = str(o?.text, 500, `${qi + 1}-сұрақтың ${oi + 1}-жауабы`);
        const oImage = optId(o?.image_id);
        await checkFile(oImage, ['image']);
        if (!oText && !oImage) fail(`${qi + 1}-сұрақтың ${oi + 1}-жауабына мәтін немесе сурет қосыңыз.`);
        let oid = optId(o?.id);
        if (oid && existingO.get(oid) === qid) {
          statements.push(['UPDATE options SET position = ?, text = ?, image_id = ?, is_correct = ? WHERE id = ?', oi + 1, oText, oImage, bool(o?.is_correct), oid]);
        } else {
          oid = ++nextO;
          statements.push([
            'INSERT INTO options (id, question_id, position, text, image_id, is_correct) VALUES (?, ?, ?, ?, ?, ?)',
            oid, qid, oi + 1, oText, oImage, bool(o?.is_correct),
          ]);
        }
        keptO.add(oid);
      }
    }
    for (const oid of existingO.keys()) if (!keptO.has(oid)) statements.push(['DELETE FROM options WHERE id = ?', oid]);
    for (const qid of existingQ) if (!keptQ.has(qid)) statements.push(['DELETE FROM questions WHERE id = ?', qid]);
    await batch(statements);
    res.json(await testDetail(id));
  }),
);

orgRouter.delete(
  '/tests/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    await mustExist('tests', id);
    await batch([
      ['DELETE FROM options WHERE question_id IN (SELECT id FROM questions WHERE test_id = ?)', id],
      ['DELETE FROM questions WHERE test_id = ?', id],
      ['DELETE FROM tests WHERE id = ?', id],
    ]);
    res.json({ ok: true });
  }),
);

// ─── Files ────────────────────────────────────────────────────────
const rawBody = express.raw({ type: () => true, limit: UPLOAD_LIMIT });

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
