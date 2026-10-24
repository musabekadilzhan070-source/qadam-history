import express from 'express';
import { all, get, run } from './db.js';

// Suggestions from students to the organizer, and the organizer's replies.
// Status: new (not read yet) → read → answered. A student sees only their own rows;
// the organizer router is mounted behind the organizer session check in org.js.

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const SUBJECT = [3, 120];
const BODY = [5, 3000];
const REPLY = [2, 3000];
const PER_HOUR = 10;
export const STATUSES = ['new', 'read', 'answered'];

const text = (v, [min, max], label) => {
  const s = String(v ?? '').trim();
  if (s.length < min) return { error: `«${label}» өрісін толтырыңыз (кемінде ${min} таңба).` };
  if (s.length > max) return { error: `«${label}» тым ұзын (ең көбі ${max} таңба).` };
  return { value: s };
};

// ─── Student ──────────────────────────────────────────────────────
export const feedbackRouter = express.Router();

const own = (userId) =>
  all(
    `SELECT id, subject, body, status, reply, replied_at, reply_seen, created_at
     FROM feedback WHERE user_id = ? ORDER BY id DESC LIMIT 200`,
    userId,
  );
const unseen = async (userId) => (await get("SELECT COUNT(*) AS n FROM feedback WHERE user_id = ? AND status = 'answered' AND reply_seen = 0", userId)).n;

feedbackRouter.get(
  '/',
  wrap(async (req, res) => {
    res.json({ items: await own(req.user.id), unseen: await unseen(req.user.id) });
  }),
);

feedbackRouter.get(
  '/unseen',
  wrap(async (req, res) => {
    res.json({ unseen: await unseen(req.user.id) });
  }),
);

feedbackRouter.post(
  '/',
  wrap(async (req, res) => {
    const subject = text(req.body?.subject, SUBJECT, 'Тақырып');
    if (subject.error) return res.status(400).json({ error: subject.error });
    const body = text(req.body?.body, BODY, 'Ұсыныс мәтіні');
    if (body.error) return res.status(400).json({ error: body.error });
    const recent = (await get("SELECT COUNT(*) AS n FROM feedback WHERE user_id = ? AND created_at > datetime('now', '-1 hour')", req.user.id)).n;
    if (recent >= PER_HOUR) return res.status(429).json({ error: 'Бір сағатта тым көп ұсыныс жіберілді. Кейінірек қайталаңыз.' });
    const { lastInsertRowid } = await run('INSERT INTO feedback (user_id, subject, body) VALUES (?, ?, ?)', req.user.id, subject.value, body.value);
    res.status(201).json({ item: await get('SELECT id, subject, body, status, reply, replied_at, reply_seen, created_at FROM feedback WHERE id = ?', lastInsertRowid) });
  }),
);

/** The student opened their list: replies count as seen. */
feedbackRouter.post(
  '/seen',
  wrap(async (req, res) => {
    await run("UPDATE feedback SET reply_seen = 1 WHERE user_id = ? AND status = 'answered' AND reply_seen = 0", req.user.id);
    res.json({ ok: true });
  }),
);

// ─── Organizer ────────────────────────────────────────────────────
export const orgFeedbackRouter = express.Router();

const DAY = /^\d{4}-\d{2}-\d{2}$/;

orgFeedbackRouter.get(
  '/',
  wrap(async (req, res) => {
    const where = [];
    const args = [];
    const status = String(req.query.status || '');
    if (STATUSES.includes(status)) {
      where.push('f.status = ?');
      args.push(status);
    } else if (status === 'open') where.push("f.status <> 'answered'");
    const from = String(req.query.from || '');
    const to = String(req.query.to || '');
    if (DAY.test(from)) {
      where.push('f.created_at >= ?');
      args.push(from);
    }
    if (DAY.test(to)) {
      where.push("f.created_at < date(?, '+1 day')");
      args.push(to);
    }
    const q = String(req.query.q || '').trim().slice(0, 100);
    if (q) {
      where.push("(f.subject LIKE ? ESCAPE '\\' OR f.body LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\')");
      const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      args.push(like, like, like, like);
    }
    const items = await all(
      `SELECT f.id, f.subject, f.body, f.status, f.reply, f.replied_at, f.read_at, f.created_at,
              u.id AS user_id, u.display_name, COALESCE(u.email, u.username) AS contact
       FROM feedback f JOIN users u ON u.id = f.user_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY f.id DESC LIMIT 300`,
      ...args,
    );
    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const r of await all('SELECT status, COUNT(*) AS n FROM feedback GROUP BY status')) counts[r.status] = r.n;
    res.json({ items, counts });
  }),
);

orgFeedbackRouter.get(
  '/count',
  wrap(async (_req, res) => {
    res.json({ new: (await get("SELECT COUNT(*) AS n FROM feedback WHERE status = 'new'")).n });
  }),
);

const find = (id) => get('SELECT id, status FROM feedback WHERE id = ?', Number(id) || 0);
const one = (id) =>
  get(
    `SELECT f.id, f.subject, f.body, f.status, f.reply, f.replied_at, f.read_at, f.created_at,
            u.id AS user_id, u.display_name, COALESCE(u.email, u.username) AS contact
     FROM feedback f JOIN users u ON u.id = f.user_id WHERE f.id = ?`,
    id,
  );

/** Marks as read, or back to unread with { read: false }. An answered suggestion stays answered. */
orgFeedbackRouter.post(
  '/:id/read',
  wrap(async (req, res) => {
    const row = await find(req.params.id);
    if (!row) return res.status(404).json({ error: 'Ұсыныс табылмады.' });
    if (row.status !== 'answered') {
      if (req.body?.read === false) await run("UPDATE feedback SET status = 'new', read_at = NULL WHERE id = ?", row.id);
      else await run("UPDATE feedback SET status = 'read', read_at = COALESCE(read_at, datetime('now')) WHERE id = ?", row.id);
    }
    res.json({ item: await one(row.id) });
  }),
);

orgFeedbackRouter.post(
  '/:id/reply',
  wrap(async (req, res) => {
    const row = await find(req.params.id);
    if (!row) return res.status(404).json({ error: 'Ұсыныс табылмады.' });
    const reply = text(req.body?.reply, REPLY, 'Жауап');
    if (reply.error) return res.status(400).json({ error: reply.error });
    await run(
      `UPDATE feedback SET reply = ?, status = 'answered', replied_at = datetime('now'), reply_seen = 0,
         read_at = COALESCE(read_at, datetime('now')) WHERE id = ?`,
      reply.value,
      row.id,
    );
    res.json({ item: await one(row.id) });
  }),
);
