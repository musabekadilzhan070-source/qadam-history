import express from 'express';
import { all, get, run, batch } from './db.js';
import { gradeOf, publisherOf, SUBJECT } from './catalog.js';
import { dayOf } from './almaty.js';

// «Кітаптар»: textbooks the organizer uploads (cover image + PDF) and students read inside QADAM.
//
// A textbook PDF is far larger than one request may be (Vercel stops request and response bodies
// at 4.5 MB), so the PDF is uploaded and read in 1 MB chunks. The file itself is a row in `files`
// (kind 'pdf_upload' while chunks arrive, 'bookpdf' once complete); its bytes are rows in
// `file_chunks`. The reader asks only for the chunks of the pages it shows.

export const CHUNK_SIZE = 1024 * 1024;
export const MAX_PDF = 100 * 1024 * 1024;
const MAX_PDF_LABEL = '100 МБ';
const STALE_UPLOAD = "datetime('now', '-1 day')";

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const failWith = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const id = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : 0;
};
const text = (v, max, label, required = false) => {
  const s = String(v ?? '').trim();
  if (required && !s) failWith(400, `«${label}» өрісін толтырыңыз.`);
  if (s.length > max) failWith(400, `«${label}» тым ұзын (ең көбі ${max} таңба).`);
  return s;
};
const tag = (r) => (r.error ? failWith(400, r.error) : r.value);

const errors = (err, _req, res, next) => {
  if (err?.status) return res.status(err.status).json({ error: err.message });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Бөлік тым үлкен.' });
  next(err);
};

const BOOK_COLUMNS = `b.id, b.title, b.subject, b.grade, b.publisher, b.description, b.cover_id, b.pdf_id, b.page_count,
  b.position, b.published, b.created_at, b.updated_at,
  c.version AS cover_version, c.kind AS cover_kind, p.size AS pdf_size, p.kind AS pdf_kind, p.name AS pdf_name`;
const BOOK_FROM = 'FROM books b LEFT JOIN files c ON c.id = b.cover_id LEFT JOIN files p ON p.id = b.pdf_id';

/** What a book still needs before students can see it. */
function bookProblems(b) {
  const out = [];
  if (!b.title) out.push('Кітап атауын жазыңыз.');
  if (!b.cover_id || b.cover_kind !== 'image') out.push('Мұқаба суретін жүктеңіз.');
  if (!b.pdf_id || b.pdf_kind !== 'bookpdf') out.push('PDF файлын толық жүктеңіз.');
  return out;
}

const orgBook = (b) => ({ ...b, published: Boolean(b.published), problems: bookProblems(b) });

/** Removes a PDF (its chunks and its files row). */
const dropPdf = (fileId) => [
  ['DELETE FROM file_chunks WHERE file_id = ?', fileId],
  ["DELETE FROM files WHERE id = ? AND kind IN ('bookpdf', 'pdf_upload')", fileId],
];

/** Uploads that were abandoned a day ago, and complete PDFs no book uses. */
async function purgeStaleUploads() {
  const stale = await all(
    `SELECT id FROM files WHERE (kind = 'pdf_upload' AND created_at < ${STALE_UPLOAD})
       OR (kind = 'bookpdf' AND updated_at < ${STALE_UPLOAD} AND id NOT IN (SELECT pdf_id FROM books WHERE pdf_id IS NOT NULL))`,
  );
  if (stale.length) await batch(stale.flatMap((f) => dropPdf(f.id)));
}

// ─── Organizer ────────────────────────────────────────────────────
export const orgBooksRouter = express.Router();

const findBook = async (bookId) => get(`SELECT ${BOOK_COLUMNS} ${BOOK_FROM} WHERE b.id = ?`, bookId);

orgBooksRouter.get(
  '/',
  wrap(async (_req, res) => {
    res.json({
      books: (await all(`SELECT ${BOOK_COLUMNS} ${BOOK_FROM} ORDER BY b.position, b.id`)).map(orgBook),
      limits: { chunk_size: CHUNK_SIZE, max_pdf: MAX_PDF, max_pdf_label: MAX_PDF_LABEL },
    });
  }),
);

orgBooksRouter.get(
  '/:id(\\d+)',
  wrap(async (req, res) => {
    const book = await findBook(id(req.params.id));
    if (!book) failWith(404, 'Кітап табылмады.');
    res.json(orgBook(book));
  }),
);

async function parseBook(body) {
  const book = {
    title: text(body.title, 200, 'Кітап атауы', true),
    subject: text(body.subject, 120, 'Пән') || SUBJECT,
    grade: tag(gradeOf(body.grade)),
    publisher: tag(publisherOf(body.publisher)),
    description: text(body.description, 2000, 'Сипаттама'),
    cover_id: id(body.cover_id) || null,
    pdf_id: id(body.pdf_id) || null,
  };
  if (book.cover_id && !(await get("SELECT 1 AS ok FROM files WHERE id = ? AND kind = 'image'", book.cover_id))) {
    failWith(400, 'Мұқаба суреті табылмады. Суретті қайта жүктеңіз.');
  }
  if (book.pdf_id) {
    const pdf = await get('SELECT kind FROM files WHERE id = ?', book.pdf_id);
    if (!pdf || !['bookpdf', 'pdf_upload'].includes(pdf.kind)) failWith(400, 'PDF файлы табылмады. Файлды қайта жүктеңіз.');
    if (pdf.kind !== 'bookpdf') failWith(400, 'PDF файлы әлі толық жүктелмеді. Жүктеу аяқталғанын күтіңіз.');
  }
  return book;
}

async function pageCountOf(pdfId) {
  return pdfId ? ((await get('SELECT page_count FROM book_files WHERE file_id = ?', pdfId))?.page_count ?? 0) : 0;
}

orgBooksRouter.post(
  '/',
  wrap(async (req, res) => {
    const b = await parseBook(req.body || {});
    const position = (await get('SELECT COALESCE(MAX(position), 0) + 1 AS n FROM books')).n;
    const { lastInsertRowid } = await run(
      `INSERT INTO books (title, subject, grade, publisher, description, cover_id, pdf_id, page_count, position, published)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      b.title, b.subject, b.grade, b.publisher, b.description, b.cover_id, b.pdf_id, await pageCountOf(b.pdf_id), position,
    );
    if (req.body?.published) await setPublished(lastInsertRowid, true);
    res.status(201).json(orgBook(await findBook(lastInsertRowid)));
  }),
);

orgBooksRouter.put(
  '/:id(\\d+)',
  wrap(async (req, res) => {
    const bookId = id(req.params.id);
    const old = await findBook(bookId);
    if (!old) failWith(404, 'Кітап табылмады.');
    const b = await parseBook(req.body || {});
    const statements = [
      [
        `UPDATE books SET title = ?, subject = ?, grade = ?, publisher = ?, description = ?, cover_id = ?, pdf_id = ?,
           page_count = ?, updated_at = datetime('now') WHERE id = ?`,
        b.title, b.subject, b.grade, b.publisher, b.description, b.cover_id, b.pdf_id,
        b.pdf_id === old.pdf_id ? old.page_count : await pageCountOf(b.pdf_id), bookId,
      ],
    ];
    // A replaced PDF is removed from storage; reading progress refers to page numbers of the old file.
    if (old.pdf_id && old.pdf_id !== b.pdf_id) {
      statements.push(...dropPdf(old.pdf_id), ['UPDATE book_progress SET last_page = 1 WHERE book_id = ?', bookId]);
    }
    await batch(statements);
    const fresh = await findBook(bookId);
    // A published book that lost its cover or PDF is hidden rather than shown broken.
    if (fresh.published && bookProblems(fresh).length) await run('UPDATE books SET published = 0 WHERE id = ?', bookId);
    if (req.body?.published !== undefined) await setPublished(bookId, Boolean(req.body.published));
    res.json(orgBook(await findBook(bookId)));
  }),
);

async function setPublished(bookId, published) {
  const book = await findBook(bookId);
  if (!book) failWith(404, 'Кітап табылмады.');
  if (published) {
    const problems = bookProblems(book);
    if (problems.length) failWith(400, `Кітап жарияланбады: ${problems.join(' ')}`);
  }
  await run("UPDATE books SET published = ?, updated_at = datetime('now') WHERE id = ?", published ? 1 : 0, bookId);
}

orgBooksRouter.post(
  '/:id(\\d+)/publish',
  wrap(async (req, res) => {
    await setPublished(id(req.params.id), req.body?.published !== false);
    res.json(orgBook(await findBook(id(req.params.id))));
  }),
);

orgBooksRouter.post(
  '/:id(\\d+)/move',
  wrap(async (req, res) => {
    const list = await all('SELECT id FROM books ORDER BY position, id');
    const i = list.findIndex((b) => b.id === id(req.params.id));
    const j = i + (Number(req.body?.delta) < 0 ? -1 : 1);
    if (i < 0) failWith(404, 'Кітап табылмады.');
    if (j >= 0 && j < list.length) [list[i], list[j]] = [list[j], list[i]];
    await batch(list.map((b, k) => ['UPDATE books SET position = ? WHERE id = ?', k + 1, b.id]));
    res.json({ ok: true });
  }),
);

orgBooksRouter.delete(
  '/:id(\\d+)',
  wrap(async (req, res) => {
    const book = await findBook(id(req.params.id));
    if (!book) failWith(404, 'Кітап табылмады.');
    const statements = [
      ['DELETE FROM books WHERE id = ?', book.id],
      ['DELETE FROM book_progress WHERE book_id = ?', book.id],
    ];
    if (book.pdf_id) statements.push(...dropPdf(book.pdf_id));
    // The cover goes too, unless something else on the site still shows that picture.
    if (book.cover_id && req.query.keep_cover !== '1') {
      const elsewhere = await get(
        `SELECT 1 AS ok WHERE EXISTS (SELECT 1 FROM books WHERE cover_id = ?1 AND id <> ?2)
           OR EXISTS (SELECT 1 FROM tests WHERE cover_image_id = ?1) OR EXISTS (SELECT 1 FROM topics WHERE image_id = ?1)
           OR EXISTS (SELECT 1 FROM questions WHERE image_id = ?1) OR EXISTS (SELECT 1 FROM options WHERE image_id = ?1)
           OR EXISTS (SELECT 1 FROM materials WHERE image_id = ?1) OR EXISTS (SELECT 1 FROM persons WHERE image_id = ?1)
           OR EXISTS (SELECT 1 FROM emblems WHERE file_id = ?1)`,
        book.cover_id,
        book.id,
      );
      const settings = await all("SELECT value FROM settings WHERE key IN ('texts', 'icons')");
      const inSettings = settings.some((s) => new RegExp(`(?:"id"|"banner_image_id")\\s*:\\s*"?${book.cover_id}"?(?!\\d)`).test(s.value));
      if (!elsewhere && !inSettings) statements.push(["DELETE FROM files WHERE id = ? AND kind = 'image'", book.cover_id]);
    }
    await batch(statements);
    res.json({ ok: true });
  }),
);

// Chunked PDF upload: start → every chunk → finish. Nothing can use the file before finish.
orgBooksRouter.post(
  '/uploads',
  wrap(async (req, res) => {
    await purgeStaleUploads();
    const size = Number(req.body?.size);
    const name = text(req.body?.name, 160, 'Файл атауы') || 'kitap.pdf';
    if (!/\.pdf$/i.test(name)) failWith(400, 'Тек PDF файлын жүктеуге болады.');
    if (!Number.isInteger(size) || size < 1) failWith(400, 'Файл бос.');
    if (size > MAX_PDF) failWith(400, `PDF көлемі ${MAX_PDF_LABEL} аспауы керек.`);
    const { lastInsertRowid } = await run(
      "INSERT INTO files (kind, name, mime, size, data) VALUES ('pdf_upload', ?, 'application/pdf', ?, X'')",
      name,
      size,
    );
    res.status(201).json({ file_id: lastInsertRowid, chunk_size: CHUNK_SIZE, chunks: Math.ceil(size / CHUNK_SIZE) });
  }),
);

const chunkBody = express.raw({ type: () => true, limit: CHUNK_SIZE + 1024 });

orgBooksRouter.put(
  '/uploads/:file(\\d+)/:idx(\\d+)',
  chunkBody,
  wrap(async (req, res) => {
    const file = await get("SELECT id, size FROM files WHERE id = ? AND kind = 'pdf_upload'", id(req.params.file));
    if (!file) failWith(404, 'Жүктеу табылмады немесе аяқталып қойған. Файлды қайта таңдаңыз.');
    const idx = Number(req.params.idx);
    const chunks = Math.ceil(file.size / CHUNK_SIZE);
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const expected = idx === chunks - 1 ? file.size - CHUNK_SIZE * (chunks - 1) : CHUNK_SIZE;
    if (idx >= chunks) failWith(400, 'Файл бөлігінің нөмірі қате.');
    if (buf.length !== expected) failWith(400, 'Файл бөлігі толық жеткен жоқ. Қайта жүктеңіз.');
    if (idx === 0 && buf.toString('latin1', 0, 5) !== '%PDF-') failWith(400, 'Бұл PDF файлы емес. PDF файлын таңдаңыз.');
    await run('INSERT INTO file_chunks (file_id, idx, data) VALUES (?, ?, ?) ON CONFLICT(file_id, idx) DO UPDATE SET data = excluded.data', file.id, idx, buf);
    res.json({ ok: true });
  }),
);

orgBooksRouter.post(
  '/uploads/:file(\\d+)/finish',
  wrap(async (req, res) => {
    const file = await get("SELECT id, size, name FROM files WHERE id = ? AND kind = 'pdf_upload'", id(req.params.file));
    if (!file) failWith(404, 'Жүктеу табылмады. Файлды қайта таңдаңыз.');
    const chunks = Math.ceil(file.size / CHUNK_SIZE);
    const have = await get('SELECT COUNT(*) AS n, COALESCE(SUM(length(data)), 0) AS bytes FROM file_chunks WHERE file_id = ? AND idx < ?', file.id, chunks);
    if (have.n !== chunks || have.bytes !== file.size) failWith(400, 'Файлдың барлық бөлігі жеткен жоқ. Қайта жүктеңіз.');
    const tail = await get('SELECT data FROM file_chunks WHERE file_id = ? AND idx = ?', file.id, chunks - 1);
    const end = Buffer.from(tail.data);
    if (!end.subarray(Math.max(0, end.length - 2048)).toString('latin1').includes('%%EOF')) {
      failWith(400, 'PDF файлы толық емес немесе бүлінген. Басқа файлды таңдаңыз.');
    }
    const pages = Math.max(0, Math.min(10000, Math.round(Number(req.body?.page_count) || 0)));
    await batch([
      ["UPDATE files SET kind = 'bookpdf', updated_at = datetime('now') WHERE id = ?", file.id],
      ['INSERT INTO book_files (file_id, page_count) VALUES (?, ?) ON CONFLICT(file_id) DO UPDATE SET page_count = excluded.page_count', file.id, pages],
    ]);
    res.json({ file_id: file.id, name: file.name, size: file.size, page_count: pages });
  }),
);

orgBooksRouter.delete(
  '/uploads/:file(\\d+)',
  wrap(async (req, res) => {
    const fileId = id(req.params.file);
    // Only a file no book uses can be dropped here.
    if (!(await get('SELECT 1 AS ok FROM books WHERE pdf_id = ?', fileId))) await batch(dropPdf(fileId));
    res.json({ ok: true });
  }),
);

orgBooksRouter.use(errors);

// ─── Students ─────────────────────────────────────────────────────
export const booksRouter = express.Router();

/** Books students may see: published, with a cover and a complete PDF. */
const LIVE = `b.published = 1 AND c.kind = 'image' AND p.kind = 'bookpdf'`;

const studentBook = (b) => ({
  id: b.id,
  title: b.title,
  subject: b.subject,
  grade: b.grade,
  publisher: b.publisher,
  description: b.description,
  cover_id: b.cover_id,
  cover_version: b.cover_version,
  page_count: b.page_count,
  last_page: b.last_page ?? null,
});

booksRouter.get(
  '/',
  wrap(async (req, res) => {
    const rows = await all(
      `SELECT ${BOOK_COLUMNS}, g.last_page ${BOOK_FROM} LEFT JOIN book_progress g ON g.book_id = b.id AND g.user_id = ?
       WHERE ${LIVE} ORDER BY b.position, b.id`,
      req.user.id,
    );
    res.json({ books: rows.map(studentBook) });
  }),
);

const liveBook = async (bookId, userId) =>
  get(
    `SELECT ${BOOK_COLUMNS}, g.last_page ${BOOK_FROM} LEFT JOIN book_progress g ON g.book_id = b.id AND g.user_id = ?
     WHERE b.id = ? AND ${LIVE}`,
    userId,
    bookId,
  );

booksRouter.get(
  '/:id(\\d+)',
  wrap(async (req, res) => {
    const book = await liveBook(id(req.params.id), req.user.id);
    if (!book) failWith(404, 'Кітап табылмады немесе әзірге жабық.');
    res.json({
      ...studentBook(book),
      pdf: { file_id: book.pdf_id, size: book.pdf_size, chunk_size: CHUNK_SIZE, chunks: Math.ceil(book.pdf_size / CHUNK_SIZE) },
    });
  }),
);

// One chunk of a book's PDF. The URL names the file, so a replaced PDF never mixes with cached chunks.
booksRouter.get(
  '/:id(\\d+)/pdf/:file(\\d+)/:idx(\\d+)',
  wrap(async (req, res) => {
    const book = await liveBook(id(req.params.id), req.user.id);
    if (!book || book.pdf_id !== id(req.params.file)) failWith(404, 'Кітап табылмады немесе әзірге жабық.');
    const chunk = await get('SELECT data FROM file_chunks WHERE file_id = ? AND idx = ?', book.pdf_id, Number(req.params.idx));
    if (!chunk) failWith(404, 'Файл бөлігі табылмады.');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=604800, immutable');
    res.send(Buffer.from(chunk.data));
  }),
);

/** The reader opened the book (its PDF loaded). Opening is not reading: pages are counted by activity. */
booksRouter.post(
  '/:id(\\d+)/open',
  wrap(async (req, res) => {
    const book = await liveBook(id(req.params.id), req.user.id);
    if (!book) failWith(404, 'Кітап табылмады немесе әзірге жабық.');
    await batch([
      [
        `INSERT INTO book_progress (user_id, book_id, last_page, opened_count, last_opened_at) VALUES (?, ?, 1, 1, datetime('now'))
         ON CONFLICT(user_id, book_id) DO UPDATE SET opened_count = opened_count + 1, last_opened_at = datetime('now')`,
        req.user.id,
        book.id,
      ],
      ['INSERT INTO book_days (user_id, book_id, day) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', req.user.id, book.id, dayOf()],
    ]);
    res.json({ ok: true });
  }),
);

/** Remembers the page the student is on, so the book opens there next time (on any device). */
booksRouter.post(
  '/:id(\\d+)/progress',
  wrap(async (req, res) => {
    const book = await liveBook(id(req.params.id), req.user.id);
    if (!book) failWith(404, 'Кітап табылмады немесе әзірге жабық.');
    const page = Math.round(Number(req.body?.page));
    const max = book.page_count || Number(req.body?.page_count) || 10000;
    if (!Number.isInteger(page) || page < 1 || page > max) failWith(400, 'Бет нөмірі қате.');
    await run(
      `INSERT INTO book_progress (user_id, book_id, last_page, opened_count, last_opened_at) VALUES (?, ?, ?, 0, datetime('now'))
       ON CONFLICT(user_id, book_id) DO UPDATE SET last_page = excluded.last_page`,
      req.user.id,
      book.id,
      page,
    );
    // The organizer's page count comes from the uploaded file; fill it in if it was not known.
    if (!book.page_count && Number(req.body?.page_count) > 0) {
      await run('UPDATE books SET page_count = ? WHERE id = ? AND page_count = 0', Math.min(10000, Math.round(Number(req.body.page_count))), book.id);
    }
    res.json({ ok: true });
  }),
);

booksRouter.use(errors);
