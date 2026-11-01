import crypto from 'node:crypto';
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
  endAllSessions,
  tokenHash,
} from './auth.js';
import { mailConfigured, sendMail } from './mail.js';
import { listPeriods, getPeriod, listTests, siteInfo, totals } from './content.js';
import { findTest, firstTestOfTopic, startTest, submitTest, userResults, attemptDetail, startRework, submitRework, textbook } from './quiz.js';
import { ensureFirstPublication } from './publish.js';
import { orgRouter } from './org.js';
import { feedbackRouter } from './feedback.js';
import { booksRouter } from './books.js';
import { activityRouter, reportRouter, purgeOldActivity } from './activity.js';
import { publicLinksRouter } from './links.js';
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
    purgeOldActivity().catch(() => {});
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
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
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
const publicUser = (u) => ({ id: u.id, username: u.username, email: u.email ?? null, display_name: u.display_name, created_at: u.created_at });

// ─── Content ───────────────────────────────────────────────────────
// The whole student site is behind sign-in: content is served to signed-in students only.
app.get('/api/overview', requireUser, wrap(async (req, res) => {
  res.json({ totals: await totals(), periods: await listPeriods(userId(req)), tests: await listTests(userId(req)) });
}));

app.get('/api/periods/:slug', requireUser, wrap(async (req, res) => {
  const period = await getPeriod(req.params.slug, userId(req));
  if (!period) return res.status(404).json({ error: 'Кезең табылмады.' });
  res.json(period);
}));

app.get('/api/tests', requireUser, wrap(async (req, res) => {
  res.json({ periods: await listPeriods(userId(req)), tests: await listTests(userId(req)) });
}));

// Texts, icons and banner image the organizer set for the student pages.
app.get('/api/site', wrap(async (_req, res) => {
  res.json(await siteInfo());
}));

// Uploaded images, icons and PDFs, stored in the database.
app.get('/api/files/:id', wrap(async (req, res) => {
  // Book PDFs are kept in chunks and served only to signed-in students (books.js).
  const file = await get("SELECT mime, data, version, name FROM files WHERE id = ? AND kind NOT IN ('bookpdf', 'pdf_upload')", Number(req.params.id));
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

// Starting a test hands out its questions (no answers) and a signed session token.
app.get('/api/tests/:id', requireUser, wrap(async (req, res) => {
  const found = testId(req) && (await findTest(testId(req)));
  if (!found) return res.status(404).json({ error: 'Тест табылмады.' });
  const { test, topic } = found;
  res.json({ id: test.id, title: test.title, description: test.description, cover_image_id: test.cover_image_id, topic, book: textbook(test), ...(await startTest(test, userId(req))) });
}));

app.post('/api/tests/:id', requireUser, wrap(async (req, res) => {
  const found = testId(req) && (await findTest(testId(req)));
  if (!found) return res.status(404).json({ error: 'Тест табылмады.' });
  const answers = req.body?.answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    return res.status(400).json({ error: 'Жауаптар жіберілмеді.' });
  }
  try {
    const result = await submitTest(found.test, { token: req.body?.token, answers }, { userId: userId(req) });
    res.json({ test: { id: found.test.id, title: found.test.title }, topic: found.topic, saved: Boolean(result.attempt_id), ...result });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }
}));

// Older links pointed at a topic's single test: answer with that test's id.
app.get('/api/topics/:slug/test', requireUser, wrap(async (req, res) => {
  const id = await firstTestOfTopic(req.params.slug);
  if (!id) return res.status(404).json({ error: 'Бұл тақырыпта әзірге тест жоқ.' });
  res.json({ test_id: id });
}));

// ─── Organizer cabinet ─────────────────────────────────────────────
app.use('/api/org', orgRouter);
// A test sent as a link: taken without an account (links.js).
app.use('/api/link', publicLinksRouter);
app.use('/api/feedback', requireUser, feedbackRouter);
app.use('/api/books', requireUser, booksRouter);
app.use('/api/activity', requireUser, activityRouter);
app.use('/api/report', requireUser, reportRouter);

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

// «Қателермен қайта жұмыс істеу»: only the questions answered wrongly in one of the student's own attempts.
const attemptParam = (req) => {
  const id = Number(req.params.id);
  return Number.isInteger(id) && id > 0 ? id : 0;
};
const sendError = (res, err) => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  throw err;
};

app.get('/api/results/:id/rework', requireUser, wrap(async (req, res) => {
  try {
    res.json(await startRework(req.user.id, attemptParam(req)));
  } catch (err) {
    sendError(res, err);
  }
}));

app.post('/api/results/:id/rework', requireUser, wrap(async (req, res) => {
  const answers = req.body?.answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return res.status(400).json({ error: 'Жауаптар жіберілмеді.' });
  try {
    res.json(await submitRework(req.user.id, attemptParam(req), { token: req.body?.token, answers }));
  } catch (err) {
    sendError(res, err);
  }
}));

// ─── Accounts ──────────────────────────────────────────────────────
const USERNAME_RE = /^[\p{L}\p{N}._-]{3,32}$/u;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const BAD_EMAIL = 'Электрондық пошта форматы қате. Мысалы: adilzhan@gmail.com';
const RESET_TTL_MS = 60 * 60 * 1000;

const findAccount = (login) =>
  get('SELECT * FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE ORDER BY id LIMIT 1', login, login);

function checkPassword(password, confirm) {
  if (password.length < 6 || password.length > 128) return 'Құпиясөз кемінде 6 таңбадан тұрсын.';
  if (confirm !== undefined && confirm !== password) return 'Құпиясөздер сәйкес келмейді.';
  return null;
}

app.get('/api/me', wrap(async (req, res) => {
  res.json({ user: req.user ? publicUser(req.user) : null });
}));

app.post('/api/auth/register', wrap(async (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const displayName = String(req.body?.display_name ?? '').trim();
  const password = String(req.body?.password ?? '');
  const confirm = req.body?.password_confirm === undefined ? undefined : String(req.body.password_confirm);
  // Older clients sent a login instead of an email; both are accepted.
  const username = String(req.body?.username ?? '').trim() || email;
  if (displayName.length < 2 || displayName.length > 60) {
    return res.status(400).json({ error: 'Аты-жөніңізді жазыңыз (2–60 таңба).' });
  }
  if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: BAD_EMAIL });
  if (!email && !USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'Электрондық поштаңызды жазыңыз.' });
  }
  if (email && username !== email && !USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'Логин 3–32 таңбадан тұрсын: әріп, цифр, нүкте, сызықша.' });
  }
  const pwError = checkPassword(password, confirm);
  if (pwError) return res.status(400).json({ error: pwError });
  if (email && (await findAccount(email))) {
    return res.status(409).json({ error: 'Бұл электрондық поштамен аккаунт бар. «Кіру» бетін ашыңыз.' });
  }
  if (await findAccount(username)) return res.status(409).json({ error: 'Бұл логин бос емес. Басқасын таңдаңыз.' });
  let lastInsertRowid;
  try {
    ({ lastInsertRowid } = await run(
      'INSERT INTO users (username, email, display_name, password_hash) VALUES (?, ?, ?, ?)',
      username,
      email || null,
      displayName,
      hashPassword(password),
    ));
  } catch (err) {
    if (/UNIQUE/i.test(String(err.message))) return res.status(409).json({ error: 'Бұл электрондық поштамен аккаунт бар.' });
    throw err;
  }
  await startSession(req, res, lastInsertRowid);
  res.status(201).json({ user: publicUser(await get('SELECT * FROM users WHERE id = ?', lastInsertRowid)) });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const login = String(req.body?.login ?? req.body?.username ?? '').trim();
  const password = String(req.body?.password ?? '');
  if (!login || !password) return res.status(400).json({ error: 'Логинді (немесе поштаны) және құпиясөзді жазыңыз.' });
  if (login.includes('@') && !EMAIL_RE.test(login)) return res.status(400).json({ error: BAD_EMAIL });
  const key = `${req.ip}|${login.toLowerCase()}`;
  const wait = loginLimiter.blocked(key);
  if (wait) return res.status(429).json({ error: `Тым көп әрекет. ${Math.ceil(wait / 60)} минуттан кейін қайталаңыз.` });
  const user = await findAccount(login);
  if (!user || !verifyPassword(password, user.password_hash)) {
    loginLimiter.fail(key);
    return res.status(401).json({ error: 'Логин (пошта) немесе құпиясөз қате.' });
  }
  loginLimiter.reset(key);
  await startSession(req, res, user.id);
  res.json({ user: publicUser(user) });
}));

app.post('/api/auth/logout', wrap(async (req, res) => {
  await endSession(req, res);
  res.json({ ok: true });
}));

app.get('/api/auth/options', (_req, res) => {
  res.json({ email_reset: mailConfigured() });
});

// Password reset by email. The answer is the same whether or not the address exists.
app.post('/api/auth/forgot', wrap(async (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: BAD_EMAIL });
  if (!mailConfigured()) {
    return res.status(503).json({
      error: 'Хат жіберу қызметі әзірге қосылмаған. Құпиясөзді қалпына келтіру үшін организаторға жүгініңіз: ол уақытша құпиясөз береді.',
    });
  }
  const wait = loginLimiter.blocked(`forgot|${req.ip}`);
  if (wait) return res.status(429).json({ error: `Тым көп әрекет. ${Math.ceil(wait / 60)} минуттан кейін қайталаңыз.` });
  loginLimiter.fail(`forgot|${req.ip}`);
  const user = await get('SELECT id, display_name, email FROM users WHERE email = ? COLLATE NOCASE', email);
  if (user) {
    const token = crypto.randomBytes(32).toString('base64url');
    await run('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)', tokenHash(token), user.id, Date.now() + RESET_TTL_MS);
    const origin = process.env.SITE_URL || `${req.protocol}://${req.get('host')}`;
    await sendMail({
      to: user.email,
      subject: 'QADAM: құпиясөзді қалпына келтіру',
      text: `Сәлеметсіз бе, ${user.display_name}!\n\nЖаңа құпиясөз орнату үшін сілтемені ашыңыз (1 сағат жарамды):\n${origin}/reset?token=${token}\n\nЕгер сіз сұрамасаңыз, бұл хатты елемеңіз.`,
    });
  }
  res.json({ ok: true, message: 'Егер бұл поштамен аккаунт болса, оған сілтеме жіберілді. Поштаңызды тексеріңіз.' });
}));

app.post('/api/auth/reset', wrap(async (req, res) => {
  const token = String(req.body?.token ?? '');
  const password = String(req.body?.password ?? '');
  const pwError = checkPassword(password, String(req.body?.password_confirm ?? ''));
  if (pwError) return res.status(400).json({ error: pwError });
  const row = token && (await get('SELECT user_id FROM password_resets WHERE token_hash = ? AND expires_at > ?', tokenHash(token), Date.now()));
  if (!row) return res.status(400).json({ error: 'Сілтеме жарамсыз немесе мерзімі өтіп кеткен. Қайта сұраңыз.' });
  await run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(password), row.user_id);
  await run('DELETE FROM password_resets WHERE user_id = ?', row.user_id);
  await endAllSessions(row.user_id);
  await startSession(req, res, row.user_id);
  res.json({ user: publicUser(await get('SELECT * FROM users WHERE id = ?', row.user_id)) });
}));

app.patch('/api/me', requireUser, wrap(async (req, res) => {
  const displayName = String(req.body?.display_name ?? req.user.display_name).trim();
  if (displayName.length < 2 || displayName.length > 60) {
    return res.status(400).json({ error: 'Аты-жөніңізді жазыңыз (2–60 таңба).' });
  }
  let email = req.user.email;
  if (req.body?.email !== undefined) {
    email = String(req.body.email).trim().toLowerCase() || null;
    if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: BAD_EMAIL });
    const other = email && (await get('SELECT id FROM users WHERE (email = ? COLLATE NOCASE OR username = ? COLLATE NOCASE) AND id <> ?', email, email, req.user.id));
    if (other) return res.status(409).json({ error: 'Бұл электрондық пошта басқа аккаунтқа тіркелген.' });
  }
  await run('UPDATE users SET display_name = ?, email = ? WHERE id = ?', displayName, email, req.user.id);
  res.json({ user: publicUser({ ...req.user, display_name: displayName, email }) });
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
