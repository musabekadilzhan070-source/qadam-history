import crypto from 'node:crypto';
import express from 'express';
import { config } from './config.js';
import { all, get, run } from './db.js';
import { assembleQuestions, readyQuestions, settingsOf, pickUnits, forStudent, gradable, grade } from './questions.js';
import { makeToken, readToken, timeAllowed } from './quiz.js';
import { parseCookies } from './auth.js';
import { writeCsv, writeXlsx } from './sheets.js';
import { latin } from './latin.js';

// ─── Test links ───────────────────────────────────────────────────
// Every test has a permanent link /t/<share_id>, like a Google Form. The organizer turns the link
// on, may set opening and closing times, retakes and what students see at the end. Anyone with
// the link enters a name and takes the test without an account.
//
// • The test is handed out as it is saved in the cabinet now, and that exact version is kept
//   (link_versions): an attempt is always graded on the questions it was given.
// • An attempt is a row from the start (link_attempts); the answers are graded on the server,
//   and finished_at is written once, so a repeated submit never adds a second result.
// • A browser keeps a random participant id in a cookie. It decides retakes and lets a student
//   come back to an unfinished test after a reload. It is not a person's identity: the same name
//   typed twice is never merged.

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const failWith = (status, message, extra = {}) => Object.assign(new Error(message), { status, extra });

const PARTICIPANT = 'qadam_pid';
const YEAR_MS = 365 * 24 * 3600 * 1000;
const GRACE_SEC = 90;
/** An unfinished attempt without a time limit can be resumed for this long. */
const RESUME_MS = 12 * 3600 * 1000;

/** Gives every test that has none its link row (a new test gets its link at once). */
export async function ensureLinks() {
  await run(
    `INSERT OR IGNORE INTO test_links (test_id, share_id)
     SELECT id, lower(hex(randomblob(8))) FROM tests WHERE id NOT IN (SELECT test_id FROM test_links)`,
  );
}

const almaty = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Almaty', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const when = (iso) => almaty.format(new Date(iso));

/** Whether a new attempt may start now, with the reason in Kazakh when it may not. */
export function linkState(link, now = Date.now()) {
  if (!link.enabled) return { open: false, reason: 'closed', message: 'Бұл тест жабық: организатор сілтеме арқылы тапсыруды тоқтатқан.' };
  if (link.opens_at && now < Date.parse(link.opens_at)) return { open: false, reason: 'not_yet', message: `Тест әлі ашылмаған. Басталу уақыты: ${when(link.opens_at)} (Алматы уақыты).` };
  if (link.closes_at && now >= Date.parse(link.closes_at)) return { open: false, reason: 'ended', message: `Тест тапсыру мерзімі аяқталды (${when(link.closes_at)}).` };
  return { open: true, reason: 'open', message: '' };
}

/** The test as saved in the cabinet: only questions ready to be graded. */
async function savedTest(testId) {
  const x = await get(
    `SELECT x.id, x.title, x.description, x.settings, x.grade, x.publisher, x.subject, COALESCE(t.title, '') AS topic_title
     FROM tests x LEFT JOIN topics t ON t.id = x.topic_id AND t.deleted = 0 WHERE x.id = ?`,
    testId,
  );
  if (!x) return null;
  const rows = await all('SELECT * FROM questions WHERE test_id = ? ORDER BY position, id', testId);
  const options = rows.length ? await all(`SELECT * FROM options WHERE question_id IN (${rows.map((r) => r.id).join(',')}) ORDER BY id`) : [];
  return {
    id: x.id,
    title: x.title,
    description: x.description || '',
    topic_title: x.topic_title,
    subject: x.subject || '',
    grade: x.grade ?? null,
    publisher: x.publisher || '',
    settings: settingsOf(x.settings),
    questions: readyQuestions(assembleQuestions(rows, options)),
  };
}

const versions = new Map();
async function versionById(id) {
  if (!versions.has(id)) {
    const row = await get('SELECT data FROM link_versions WHERE id = ?', id);
    if (!row) return null;
    versions.set(id, JSON.parse(row.data));
  }
  return versions.get(id);
}

/** Keeps the current saved test as a version (once per distinct content) and returns it. */
async function currentVersion(testId) {
  const test = await savedTest(testId);
  if (!test) return null;
  const data = JSON.stringify(test);
  const hash = crypto.createHash('sha256').update(data).digest('hex');
  await run('INSERT OR IGNORE INTO link_versions (test_id, hash, data) VALUES (?, ?, ?)', testId, hash, data);
  const { id } = await get('SELECT id FROM link_versions WHERE test_id = ? AND hash = ?', testId, hash);
  versions.set(id, test);
  return { id, test };
}

const linkBySlug = (slug) =>
  /^[0-9a-f]{16}$/.test(String(slug)) ? get('SELECT l.*, x.title FROM test_links l JOIN tests x ON x.id = l.test_id WHERE l.share_id = ?', String(slug)) : null;

function participantOf(req, res) {
  let id = parseCookies(req.headers.cookie)[PARTICIPANT];
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(id || '')) {
    id = crypto.randomBytes(18).toString('base64url');
    const parts = [`${PARTICIPANT}=${id}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(YEAR_MS / 1000)}`];
    if (config.cookieSecure || req.secure) parts.push('Secure');
    res.append('Set-Cookie', parts.join('; '));
  }
  return id;
}

const questionCount = (test) => {
  const all = gradable(test.questions).length;
  return test.settings.question_limit ? Math.min(all, test.settings.question_limit) : all;
};

/** Units of a version holding exactly the served questions (to resume an attempt after a reload). */
function servedUnits(test, served) {
  const set = new Set(served);
  const units = [];
  for (const q of test.questions) {
    if (q.type === 'context') {
      const children = q.children.filter((c) => set.has(c.id));
      if (children.length) units.push({ ...q, children });
    } else if (set.has(q.id)) units.push(q);
  }
  return units;
}

// New attempts per address: enough for a class behind one school network, not for a flood.
const startHits = new Map();
function tooManyStarts(ip) {
  const now = Date.now();
  const list = (startHits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  list.push(now);
  startHits.set(ip, list);
  if (startHits.size > 5000) startHits.clear();
  return list.length > 120;
}

const cleanName = (raw) => String(raw ?? '').replace(/\s+/g, ' ').trim();

/** An unfinished attempt of this browser that can still be continued. */
async function openAttempt(testId, participant, test) {
  const row = await get(
    'SELECT * FROM link_attempts WHERE test_id = ? AND participant = ? AND finished_at IS NULL ORDER BY id DESC LIMIT 1',
    testId,
    participant,
  );
  if (!row) return null;
  const v = test || (await versionById(row.version_id));
  const allowed = v ? timeAllowed(v.settings, JSON.parse(row.served).length) : 0;
  const age = Date.now() - row.started_ms;
  return (allowed ? age < allowed * 1000 : age < RESUME_MS) ? row : null;
}

/** Any earlier attempt of this browser: a finished one, or one started and left. */
async function finishedBy(testId, participant) {
  return get('SELECT id FROM link_attempts WHERE test_id = ? AND participant = ? LIMIT 1', testId, participant);
}

// ─── Students (no account) ───────────────────────────────────────
export const publicLinksRouter = express.Router();

publicLinksRouter.get(
  '/:slug',
  wrap(async (req, res) => {
    const link = await linkBySlug(req.params.slug);
    if (!link) throw failWith(404, 'Мұндай тест табылмады. Сілтемені тексеріңіз.');
    const test = await savedTest(link.test_id);
    const state = linkState(link);
    const participant = parseCookies(req.headers.cookie)[PARTICIPANT];
    const resume = participant && state.open ? await openAttempt(link.test_id, participant) : null;
    const done = participant && !link.retakes ? Boolean(await finishedBy(link.test_id, participant)) : false;
    const count = test ? questionCount(test) : 0;
    res.json({
      title: test?.title || link.title,
      description: test?.description || '',
      topic_title: test?.topic_title || '',
      subject: test?.subject || '',
      grade: test?.grade ?? null,
      publisher: test?.publisher || '',
      question_count: count,
      time_limit_sec: test ? timeAllowed(test.settings, count) : 0,
      question_time_sec: test?.settings.question_time_sec || 0,
      opens_at: link.opens_at,
      closes_at: link.closes_at,
      retakes: Boolean(link.retakes),
      show_result: Boolean(link.show_result),
      ...(count ? state : { open: false, reason: 'empty', message: 'Бұл тестте әзірге сұрақ жоқ.' }),
      already_done: done && !resume,
      resume: resume ? { name: resume.name } : null,
    });
  }),
);

publicLinksRouter.post(
  '/:slug/start',
  wrap(async (req, res) => {
    const link = await linkBySlug(req.params.slug);
    if (!link) throw failWith(404, 'Мұндай тест табылмады. Сілтемені тексеріңіз.');
    const state = linkState(link);
    if (!state.open) throw failWith(403, state.message, { reason: state.reason });
    const participant = participantOf(req, res);
    let row = await openAttempt(link.test_id, participant);
    let test;
    if (row) {
      test = await versionById(row.version_id);
    } else {
      if (tooManyStarts(req.ip)) throw failWith(429, 'Тым көп сұраныс. Бірнеше минуттан кейін қайталаңыз.');
      const name = cleanName(req.body?.name);
      if (name.length < 3 || name.length > 80 || !/\p{L}/u.test(name)) throw failWith(400, 'Аты-жөніңізді толық жазыңыз (3–80 әріп).');
      if (!link.retakes && (await finishedBy(link.test_id, participant))) {
        throw failWith(409, 'Сіз бұл тестті тапсырып қойдыңыз. Организатор қайта тапсыруға рұқсат бермеген.', { reason: 'done' });
      }
      const version = await currentVersion(link.test_id);
      if (!version || !gradable(version.test.questions).length) throw failWith(403, 'Бұл тестте әзірге сұрақ жоқ.', { reason: 'empty' });
      test = version.test;
      const units = pickUnits(test.questions, test.settings);
      const served = gradable(units).map((q) => q.id);
      const { lastInsertRowid } = await run(
        'INSERT INTO link_attempts (test_id, version_id, test_title, name, participant, served, started_ms) VALUES (?, ?, ?, ?, ?, ?, ?)',
        link.test_id, version.id, test.title, name, participant, JSON.stringify(served), Date.now(),
      );
      row = await get('SELECT * FROM link_attempts WHERE id = ?', lastInsertRowid);
    }
    const served = JSON.parse(row.served);
    const units = servedUnits(test, served);
    const allowed = timeAllowed(test.settings, served.length);
    const elapsed = Math.floor((Date.now() - row.started_ms) / 1000);
    res.json({
      attempt_id: row.id,
      name: row.name,
      resumed: elapsed > 5,
      title: test.title,
      topic: { title: test.topic_title },
      question_count: served.length,
      max_score: gradable(units).reduce((s, q) => s + q.points, 0),
      // What is left of the time limit (a resumed attempt keeps its own clock).
      time_limit_sec: allowed ? Math.max(1, allowed - elapsed) : 0,
      question_time_sec: test.settings.question_time_sec,
      pass_percent: test.settings.pass_percent,
      units: units.map((u) => forStudent(u, test.settings)),
      token: await makeToken({ la: row.id, t: link.test_id, s: row.started_ms }),
    });
  }),
);

/** What the student sees at the end, by the organizer's choice. */
function endView(link, row, items) {
  const showResult = Boolean(link.show_result);
  return {
    finished: true,
    name: row.name,
    title: row.test_title,
    show_result: showResult,
    ...(showResult
      ? {
          correct: row.correct,
          total: row.total,
          score: row.score,
          max_score: row.max_score,
          percent: row.percent,
          duration_sec: row.duration_sec,
        }
      : {}),
    ...(showResult && link.show_answers ? { items } : {}),
  };
}

/** Review items of a stored attempt, graded again from its own version. */
async function storedItems(row, showAnswers) {
  const test = await versionById(row.version_id);
  if (!test) return [];
  const answers = JSON.parse(row.answers || '{}');
  return grade(test, JSON.parse(row.served), answers, { ...test.settings, show_answers: showAnswers }).items;
}

publicLinksRouter.post(
  '/:slug/submit',
  wrap(async (req, res) => {
    const link = await linkBySlug(req.params.slug);
    if (!link) throw failWith(404, 'Мұндай тест табылмады. Сілтемені тексеріңіз.');
    const session = await readToken(req.body?.token);
    if (!session?.la || session.t !== link.test_id) throw failWith(400, 'Тест сессиясы жарамсыз. Сілтемені қайта ашыңыз.');
    const answers = req.body?.answers;
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw failWith(400, 'Жауаптар жіберілмеді.');
    let row = await get('SELECT * FROM link_attempts WHERE id = ? AND test_id = ?', session.la, link.test_id);
    if (!row) throw failWith(404, 'Тест тапсыру табылмады. Сілтемені қайта ашыңыз.');
    // Already graded (a repeated request): the same result, never a second row.
    if (row.finished_at) return res.json(endView(link, row, await storedItems(row, Boolean(link.show_answers))));
    const test = await versionById(row.version_id);
    const served = JSON.parse(row.served);
    const elapsed = Math.max(0, Math.round((Date.now() - row.started_ms) / 1000));
    const allowed = timeAllowed(test.settings, served.length);
    if (allowed && elapsed > allowed + GRACE_SEC) throw failWith(400, 'Тест уақыты әлдеқашан аяқталған. Сілтемені қайта ашып, қайтадан бастаңыз.');
    const result = grade(test, served, answers, { ...test.settings, show_answers: Boolean(link.show_answers) });
    const stored = Object.fromEntries(result.stored.map(({ question, answer }) => [question.id, answer]));
    const { changes } = await run(
      `UPDATE link_attempts SET finished_at = datetime('now'), correct = ?, total = ?, score = ?, max_score = ?, percent = ?, duration_sec = ?, answers = ?
       WHERE id = ? AND finished_at IS NULL`,
      result.correct, result.total, result.score, result.max_score, result.percent, Math.min(elapsed, 6 * 3600), JSON.stringify(stored), row.id,
    );
    row = await get('SELECT * FROM link_attempts WHERE id = ?', row.id);
    res.json(endView(link, row, changes ? result.items : await storedItems(row, Boolean(link.show_answers))));
  }),
);

publicLinksRouter.use((err, _req, res, next) => {
  if (!err.status) return next(err);
  res.status(err.status).json({ error: err.message, ...err.extra });
});

// ─── Organizer ────────────────────────────────────────────────────
export const orgLinksRouter = express.Router();

const linkView = (l) => ({
  test_id: l.test_id,
  share_id: l.share_id,
  path: `/t/${l.share_id}`,
  enabled: Boolean(l.enabled),
  opens_at: l.opens_at,
  closes_at: l.closes_at,
  retakes: Boolean(l.retakes),
  show_result: Boolean(l.show_result),
  show_answers: Boolean(l.show_answers),
  state: linkState(l),
});

/** Every test's link with how many took it. */
orgLinksRouter.get(
  '/',
  wrap(async (_req, res) => {
    await ensureLinks();
    const rows = await all(
      `SELECT l.*, x.title, x.topic_id,
              (SELECT COUNT(*) FROM link_attempts a WHERE a.test_id = l.test_id AND a.finished_at IS NOT NULL) AS finished,
              (SELECT COUNT(*) FROM link_attempts a WHERE a.test_id = l.test_id AND a.finished_at IS NULL) AS unfinished
       FROM test_links l JOIN tests x ON x.id = l.test_id ORDER BY x.topic_id, x.position, x.id`,
    );
    res.json({ links: rows.map((l) => ({ ...linkView(l), title: l.title, finished: l.finished, unfinished: l.unfinished })) });
  }),
);

const isoOrNull = (v, label) => {
  if (v === null || v === undefined || v === '') return null;
  const ms = Date.parse(String(v));
  if (Number.isNaN(ms)) throw failWith(400, `${label} қате көрсетілген.`);
  return new Date(ms).toISOString();
};

orgLinksRouter.put(
  '/:testId(\\d+)',
  wrap(async (req, res) => {
    await ensureLinks();
    const testId = Number(req.params.testId);
    const link = await get('SELECT * FROM test_links WHERE test_id = ?', testId);
    if (!link) throw failWith(404, 'Тест табылмады.');
    const b = req.body || {};
    const opens = 'opens_at' in b ? isoOrNull(b.opens_at, 'Басталу уақыты') : link.opens_at;
    const closes = 'closes_at' in b ? isoOrNull(b.closes_at, 'Аяқталу уақыты') : link.closes_at;
    if (opens && closes && Date.parse(closes) <= Date.parse(opens)) throw failWith(400, 'Аяқталу уақыты басталу уақытынан кейін болуы керек.');
    const flag = (k) => (k in b ? (b[k] ? 1 : 0) : link[k]);
    const next = { enabled: flag('enabled'), retakes: flag('retakes'), show_result: flag('show_result'), show_answers: flag('show_answers') };
    if (next.enabled && !link.enabled) {
      const test = await savedTest(testId);
      if (!test || !gradable(test.questions).length) throw failWith(400, 'Сілтемені қосу үшін тестте кемінде бір дайын сұрақ болуы керек.');
    }
    await run(
      `UPDATE test_links SET enabled = ?, opens_at = ?, closes_at = ?, retakes = ?, show_result = ?, show_answers = ?, updated_at = datetime('now')
       WHERE test_id = ?`,
      next.enabled, opens, closes, next.retakes, next.show_result, next.show_answers, testId,
    );
    res.json(linkView(await get('SELECT * FROM test_links WHERE test_id = ?', testId)));
  }),
);

const RESULT_SQL = `SELECT a.id, a.test_id, COALESCE(x.title, a.test_title) AS test_title, a.name, a.started_at, a.finished_at,
  a.correct, a.total, a.score, a.max_score, a.percent, a.duration_sec, a.started_ms, a.version_id, a.served
  FROM link_attempts a LEFT JOIN tests x ON x.id = a.test_id`;

async function resultRows(testId) {
  const rows = testId ? await all(`${RESULT_SQL} WHERE a.test_id = ? ORDER BY a.id DESC LIMIT 5000`, testId) : await all(`${RESULT_SQL} ORDER BY a.id DESC LIMIT 5000`);
  const out = [];
  for (const r of rows) {
    let status = r.finished_at ? 'finished' : 'unfinished';
    if (!r.finished_at) {
      // Still running only while its time (or the resume window) lasts.
      const v = await versionById(r.version_id);
      const allowed = v ? timeAllowed(v.settings, JSON.parse(r.served).length) : 0;
      if (Date.now() - r.started_ms < (allowed ? (allowed + GRACE_SEC) * 1000 : RESUME_MS)) status = 'in_progress';
    }
    const { served, started_ms, version_id, ...rest } = r;
    out.push({ ...rest, status });
  }
  return out;
}

const STATUS_TEXT = { finished: 'Аяқталды', unfinished: 'Аяқталмады', in_progress: 'Орындалуда' };

orgLinksRouter.get(
  '/results',
  wrap(async (req, res) => {
    const testId = Number(req.query.test_id) || null;
    res.json({ results: await resultRows(testId) });
  }),
);

const dbTime = (s) => (s ? when(String(s).replace(' ', 'T') + 'Z') : '');
const duration = (sec) => (sec == null ? '' : `${Math.floor(sec / 60)} мин ${String(sec % 60).padStart(2, '0')} с`);

orgLinksRouter.get(
  '/results/export',
  wrap(async (req, res) => {
    const testId = Number(req.query.test_id) || null;
    const format = req.query.format === 'csv' ? 'csv' : 'xlsx';
    const rows = await resultRows(testId);
    const table = [
      ['№', 'Тест', 'Оқушының аты-жөні', 'Басталған уақыты', 'Аяқталған уақыты', 'Ұпай', 'Максималды ұпай', 'Пайыз', 'Дұрыс', 'Сұрақ саны', 'Орындау уақыты', 'Мәртебесі'],
      ...rows.map((r, i) => [
        i + 1, r.test_title, r.name, dbTime(r.started_at), dbTime(r.finished_at),
        r.score ?? '', r.max_score ?? '', r.percent == null ? '' : `${r.percent}%`, r.correct ?? '', r.total ?? '', duration(r.duration_sec), STATUS_TEXT[r.status],
      ]),
    ];
    const buf = format === 'csv' ? writeCsv(table) : writeXlsx([{ name: 'Нәтижелер', rows: table, widths: [5, 34, 28, 18, 18, 8, 10, 8, 8, 10, 14, 13] }]);
    const title = testId ? rows[0]?.test_title || (await get('SELECT title FROM tests WHERE id = ?', testId))?.title || 'test' : 'barlyk-testter';
    res.set('Content-Type', format === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename="qadam-${latin(title) || 'test'}-natizheler.${format}"`);
    res.set('Cache-Control', 'no-store');
    res.send(buf);
  }),
);

/** One student's work: every question with their answer and the correct one. */
orgLinksRouter.get(
  '/results/:id(\\d+)',
  wrap(async (req, res) => {
    const row = await get('SELECT * FROM link_attempts WHERE id = ?', Number(req.params.id));
    if (!row) throw failWith(404, 'Нәтиже табылмады.');
    const [view] = (await resultRows(row.test_id)).filter((r) => r.id === row.id);
    res.json({ ...view, items: row.finished_at ? await storedItems(row, true) : [] });
  }),
);

orgLinksRouter.delete(
  '/results/:id(\\d+)',
  wrap(async (req, res) => {
    const { changes } = await run('DELETE FROM link_attempts WHERE id = ?', Number(req.params.id));
    if (!changes) throw failWith(404, 'Нәтиже табылмады.');
    res.json({ ok: true });
  }),
);

orgLinksRouter.use((err, _req, res, next) => {
  if (!err.status) return next(err);
  res.status(err.status).json({ error: err.message, ...err.extra });
});
