import path from 'node:path';
import express from 'express';
import { config } from './config.js';
import { get, run, migrate } from './db.js';
import {
  sessionMiddleware,
  requireUser,
  hashPassword,
  verifyPassword,
  startSession,
  endSession,
  makeLimiter,
  purgeExpiredSessions,
} from './auth.js';
import { listPeriods, getPeriod, getTopic, listTests, listMaterials, getMaterial, siteInfo, totals } from './content.js';
import { findTest, firstTestOfTopic, testForStudent, gradeTest, userResults, attemptDetail } from './quiz.js';
import { ensureFirstPublication } from './publish.js';
import { orgRouter } from './org.js';
import { seedIfEmpty } from './seed.js';

// Express 4 does not catch rejected promises: route them to the error handler.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Schema + seed run once per process (once per cold start on Vercel); a failure is retried on the next request.
let ready = null;
export function whenReady() {
  ready ||= (async () => {
    await migrate();
    await seedIfEmpty();
    await ensureFirstPublication();
    purgeExpiredSessions().catch(() => {});
  })().catch((err) => {
    ready = null;
    throw err;
  });
  return ready;
}

export const app = express();
app.disable('x-powered-by');
if (process.env.VERCEL) app.set('trust proxy', true);
else if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : process.env.TRUST_PROXY);

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  next();
});

app.use('/api', wrap(async (_req, _res, next) => {
  await whenReady();
  next();
}));
// A whole test with its questions can be larger than a student request; file uploads are raw bodies (see org.js).
app.use('/api/org', express.json({ limit: '2mb' }));
app.use('/api', express.json({ limit: '200kb' }));
app.use('/api', wrap(sessionMiddleware));

// CSRF guard: every state-changing API call must carry a custom header,
// which browsers never attach to cross-site form posts.
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Qadam') !== '1') return res.status(403).json({ error: 'Сұраныс қабылданбады.' });
  next();
});
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

const loginLimiter = makeLimiter({ max: 10, windowMs: 10 * 60 * 1000 });
const userId = (req) => req.user?.id ?? null;
const publicUser = (u) => ({ id: u.id, username: u.username, display_name: u.display_name, created_at: u.created_at });

// ─── Content ───────────────────────────────────────────────────────
app.get('/api/overview', wrap(async (req, res) => {
  res.json({ totals: await totals(), periods: await listPeriods(userId(req)) });
}));

app.get('/api/periods/:slug', wrap(async (req, res) => {
  const period = await getPeriod(req.params.slug, userId(req));
  if (!period) return res.status(404).json({ error: 'Кезең табылмады.' });
  res.json(period);
}));

app.get('/api/topics/:slug', wrap(async (req, res) => {
  const topic = await getTopic(req.params.slug, userId(req));
  if (!topic) return res.status(404).json({ error: 'Тақырып табылмады.' });
  res.json(topic);
}));

app.get('/api/tests', wrap(async (req, res) => {
  res.json({ periods: await listPeriods(userId(req)), tests: await listTests(userId(req)) });
}));

app.get('/api/materials', wrap(async (_req, res) => {
  res.json({ periods: await listPeriods(null), ...(await listMaterials()) });
}));

app.get('/api/materials/:id', wrap(async (req, res) => {
  const material = await getMaterial(Number(req.params.id));
  if (!material) return res.status(404).json({ error: 'Материал табылмады.' });
  res.json(material);
}));

// Texts, icons and banner image the organizer set for the student pages.
app.get('/api/site', wrap(async (_req, res) => {
  res.json(await siteInfo());
}));

// Uploaded images, icons and PDFs, stored in the database.
app.get('/api/files/:id', wrap(async (req, res) => {
  const file = await get('SELECT mime, data, version, name FROM files WHERE id = ?', Number(req.params.id));
  if (!file) return res.status(404).json({ error: 'Файл табылмады.' });
  const data = Buffer.from(file.data);
  res.setHeader('Content-Type', file.mime);
  // SVG could carry script: sandbox it. Chrome's PDF viewer refuses to run under a sandbox CSP.
  if (file.mime === 'application/pdf') res.removeHeader('Content-Security-Policy');
  else res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  const ext = { 'application/pdf': '.pdf' }[file.mime] || '';
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent((file.name || 'file').replace(/\.pdf$/i, '') + ext)}`);
  // Links carry ?v=<version>, so a replaced file gets a new URL and old copies can be cached for good.
  // Otherwise the browser revalidates (ETag), so a replaced image shows up everywhere at once.
  res.setHeader('Cache-Control', String(req.query.v) === String(file.version) ? 'public, max-age=31536000, immutable' : 'no-cache');
  res.send(data);
}));

// ─── Tests ─────────────────────────────────────────────────────────
const testId = (req) => {
  const id = Number(req.params.id);
  return Number.isInteger(id) ? id : null;
};

app.get('/api/tests/:id', wrap(async (req, res) => {
  const found = testId(req) && (await findTest(testId(req)));
  if (!found) return res.status(404).json({ error: 'Тест табылмады.' });
  res.json({ id: found.test.id, title: found.test.title, topic: found.topic, questions: testForStudent(found.test) });
}));

app.post('/api/tests/:id', wrap(async (req, res) => {
  const found = testId(req) && (await findTest(testId(req)));
  if (!found) return res.status(404).json({ error: 'Тест табылмады.' });
  const answers = req.body?.answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    return res.status(400).json({ error: 'Жауаптар жіберілмеді.' });
  }
  const result = await gradeTest(found.test, answers, { userId: userId(req), durationSec: req.body?.duration_sec });
  res.json({ test: { id: found.test.id, title: found.test.title }, topic: found.topic, saved: Boolean(result.attempt_id), ...result });
}));

// Older links pointed at a topic's single test: answer with that test's id.
app.get('/api/topics/:slug/test', wrap(async (req, res) => {
  const id = await firstTestOfTopic(req.params.slug);
  if (!id) return res.status(404).json({ error: 'Бұл тақырыпта әзірге тест жоқ.' });
  res.json({ test_id: id });
}));

// ─── Organizer cabinet ─────────────────────────────────────────────
app.use('/api/org', orgRouter);

// ─── Results ───────────────────────────────────────────────────────
app.get('/api/results', requireUser, wrap(async (req, res) => {
  res.json(await userResults(req.user.id));
}));

app.get('/api/results/:id', requireUser, wrap(async (req, res) => {
  const id = Number(req.params.id);
  const detail = Number.isInteger(id) ? await attemptDetail(req.user.id, id) : null;
  if (!detail) return res.status(404).json({ error: 'Нәтиже табылмады.' });
  res.json(detail);
}));

// ─── Accounts ──────────────────────────────────────────────────────
const USERNAME_RE = /^[\p{L}\p{N}._-]{3,32}$/u;

app.get('/api/me', wrap(async (req, res) => {
  res.json({ user: req.user ? publicUser(req.user) : null });
}));

app.post('/api/auth/register', wrap(async (req, res) => {
  const username = String(req.body?.username ?? '').trim();
  const displayName = String(req.body?.display_name ?? '').trim();
  const password = String(req.body?.password ?? '');
  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'Логин 3–32 таңбадан тұрсын: әріп, цифр, нүкте, сызықша.' });
  }
  if (displayName.length < 2 || displayName.length > 60) {
    return res.status(400).json({ error: 'Аты-жөніңізді жазыңыз (2–60 таңба).' });
  }
  if (password.length < 6 || password.length > 128) {
    return res.status(400).json({ error: 'Құпиясөз кемінде 6 таңбадан тұрсын.' });
  }
  if (await get('SELECT 1 AS ok FROM users WHERE username = ?', username)) {
    return res.status(409).json({ error: 'Бұл логин бос емес. Басқасын таңдаңыз.' });
  }
  let lastInsertRowid;
  try {
    ({ lastInsertRowid } = await run(
    'INSERT INTO users (username, display_name, password_hash) VALUES (?, ?, ?)',
    username,
    displayName,
      hashPassword(password),
    ));
  } catch (err) {
    if (/UNIQUE/i.test(String(err.message))) return res.status(409).json({ error: 'Бұл логин бос емес. Басқасын таңдаңыз.' });
    throw err;
  }
  await startSession(req, res, lastInsertRowid);
  res.status(201).json({ user: publicUser(await get('SELECT * FROM users WHERE id = ?', lastInsertRowid)) });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const username = String(req.body?.username ?? '').trim();
  const password = String(req.body?.password ?? '');
  const key = `${req.ip}|${username.toLowerCase()}`;
  const wait = loginLimiter.blocked(key);
  if (wait) return res.status(429).json({ error: `Тым көп әрекет. ${Math.ceil(wait / 60)} минуттан кейін қайталаңыз.` });
  const user = username ? await get('SELECT * FROM users WHERE username = ?', username) : null;
  if (!user || !verifyPassword(password, user.password_hash)) {
    loginLimiter.fail(key);
    return res.status(401).json({ error: 'Логин немесе құпиясөз қате.' });
  }
  loginLimiter.reset(key);
  await startSession(req, res, user.id);
  res.json({ user: publicUser(user) });
}));

app.post('/api/auth/logout', wrap(async (req, res) => {
  await endSession(req, res);
  res.json({ ok: true });
}));

app.patch('/api/me', requireUser, wrap(async (req, res) => {
  const displayName = String(req.body?.display_name ?? '').trim();
  if (displayName.length < 2 || displayName.length > 60) {
    return res.status(400).json({ error: 'Аты-жөніңізді жазыңыз (2–60 таңба).' });
  }
  await run('UPDATE users SET display_name = ? WHERE id = ?', displayName, req.user.id);
  res.json({ user: publicUser({ ...req.user, display_name: displayName }) });
}));

app.post('/api/me/password', requireUser, wrap(async (req, res) => {
  const current = String(req.body?.current_password ?? '');
  const next = String(req.body?.new_password ?? '');
  const user = await get('SELECT password_hash FROM users WHERE id = ?', req.user.id);
  if (!verifyPassword(current, user.password_hash)) return res.status(400).json({ error: 'Қазіргі құпиясөз қате.' });
  if (next.length < 6 || next.length > 128) return res.status(400).json({ error: 'Жаңа құпиясөз кемінде 6 таңбадан тұрсын.' });
  await run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(next), req.user.id);
  res.json({ ok: true });
}));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Табылмады.' }));

// ─── Static site (single-page app) ─────────────────────────────────
app.use(
  express.static(config.publicDir, {
    index: false,
    setHeaders(res, file) {
      if (/\.(woff2|svg)$/.test(file)) res.setHeader('Cache-Control', 'public, max-age=604800');
    },
  }),
);
app.get(/^\/organizer(\/.*)?$/, wrap(async (_req, res) => {
  res.sendFile(path.join(config.publicDir, 'organizer.html'));
}));
app.get(/^\/(?!assets\/).*/, wrap(async (_req, res) => {
  res.sendFile(path.join(config.publicDir, 'index.html'));
}));

app.use((err, _req, res, _next) => {
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Сұраныс дұрыс емес.' });
  console.error(err);
  res.status(500).json({ error: 'Серверде қате шықты. Кейінірек қайталаңыз.' });
});
