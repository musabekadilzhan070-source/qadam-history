import { org } from './api.js';
import { esc, icon, toast, confirmDialog, select, fileField, bindFileFields, busy, formatBytes, statusBadge } from './ui.js';
import { GRADES, PUBLISHERS, SUBJECT, gradeLabel } from '../catalog.js';
import { countPages } from '../pdf.js';

// «Кітаптар»: textbooks for students. A book has a cover image and a PDF; the PDF goes to the
// server in 1 MB pieces with a progress bar, and the book cannot be shown before it is complete.

const coverSrc = (b) => `/api/files/${b.cover_id}?v=${b.cover_version}`;

export async function booksView(el, _params, ctx, alive) {
  let { books } = await org.get('/books');
  if (!alive()) return;

  const row = (b, i) => `
    <li class="o-row o-book-row" data-id="${b.id}">
      <div class="o-order">
        <button type="button" class="o-icon-btn" data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="Жоғары">▲</button>
        <button type="button" class="o-icon-btn" data-act="down" ${i === books.length - 1 ? 'disabled' : ''} aria-label="Төмен">▼</button>
      </div>
      <span class="o-book-thumb">${b.cover_id && b.cover_kind === 'image' ? `<img src="${coverSrc(b)}" alt="" />` : icon('book')}</span>
      <div class="o-row-body"><a href="/organizer/books/${b.id}" data-link><b>${esc(b.title)}</b></a>
        <small>${esc([b.subject, gradeLabel(b.grade), b.publisher].filter(Boolean).join(' · '))}${b.pdf_kind === 'bookpdf' ? ` · PDF ${formatBytes(b.pdf_size)}${b.page_count ? `, ${b.page_count} бет` : ''}` : ''}
        ${b.problems.length ? `<br><span class="o-warn">${esc(b.problems.join(' '))}</span>` : ''}</small></div>
      ${statusBadge(b.published)}
      <div class="o-row-actions">
        <a class="btn btn-ghost btn-sm" href="/organizer/books/${b.id}" data-link>Өңдеу</a>
        <button type="button" class="btn btn-ghost btn-sm" data-act="toggle" ${!b.published && b.problems.length ? 'disabled title="Алдымен мұқаба мен PDF жүктеңіз"' : ''}>${b.published ? 'Жасыру' : 'Жариялау'}</button>
        <button type="button" class="o-icon-btn o-danger" data-act="delete" aria-label="Жою" title="Жою">${icon('cross')}</button>
      </div>
    </li>`;

  const draw = () => {
    el.innerHTML = `
      <section class="o-card">
        <div class="o-card-head"><div><h2>Кітаптар · ${books.length}</h2>
          <p class="o-muted">Оқулық қосыңыз: мұқаба суреті және PDF файлы. Жарияланған кітапты оқушылар «Кітаптар» бөлімінде, сайттың ішінде оқиды.</p></div>
          <a class="btn btn-sm" href="/organizer/books/new" data-link>+ Кітап қосу</a></div>
        ${books.length ? `<ol class="o-rows">${books.map(row).join('')}</ol>` : '<p class="o-muted">Әзірге кітап жоқ. «Кітап қосу» батырмасын басыңыз.</p>'}
      </section>`;
  };
  draw();

  el.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const b = books.find((x) => x.id === Number(btn.closest('[data-id]')?.dataset.id));
    if (!b) return;
    const act = btn.dataset.act;
    if (act === 'delete') {
      if (!(await confirmDialog('Кітапты жою', `«${b.title}» кітабы, оның PDF файлы және оқушылардың осы кітаптағы бетбелгілері біржола жойылады.`, { ok: 'Жою', danger: true }))) return;
    }
    await busy(btn, async () => {
      if (act === 'delete') {
        await org.del(`/books/${b.id}`);
        toast('Кітап жойылды.');
      } else if (act === 'toggle') {
        await org.post(`/books/${b.id}/publish`, { published: !b.published });
        toast(b.published ? 'Кітап жасырылды.' : 'Кітап жарияланды: оқушылар оны «Кітаптар» бөлімінде көреді.');
      } else if (act === 'up' || act === 'down') {
        await org.post(`/books/${b.id}/move`, { delta: act === 'up' ? -1 : 1 });
      }
      ({ books } = await org.get('/books'));
      draw();
    });
  });
}

/** Sends a PDF in pieces; calls onProgress(0..1). Resolves with { file_id, size, page_count }. */
async function uploadPdf(file, pageCount, onProgress, signal) {
  const start = await org.post('/books/uploads', { name: file.name, size: file.size });
  try {
    for (let i = 0; i < start.chunks; i += 1) {
      if (signal.cancelled) throw new Error('Жүктеу тоқтатылды.');
      const part = file.slice(i * start.chunk_size, Math.min(file.size, (i + 1) * start.chunk_size));
      let tries = 0;
      for (;;) {
        try {
          await org.upload(`/books/uploads/${start.file_id}/${i}`, part, 'PUT');
          break;
        } catch (err) {
          tries += 1;
          if (tries >= 3 || (err.status && err.status < 500)) throw err;
          await new Promise((r) => setTimeout(r, 1000 * tries));
        }
      }
      onProgress((i + 1) / start.chunks);
    }
    return await org.post(`/books/uploads/${start.file_id}/finish`, { page_count: pageCount });
  } catch (err) {
    org.del(`/books/uploads/${start.file_id}`).catch(() => {});
    throw err;
  }
}

export async function bookEditView(el, [param], ctx, alive) {
  const isNew = param === 'new';
  const { limits } = await org.get('/books');
  let book = isNew
    ? { title: '', subject: SUBJECT, grade: null, publisher: '', description: '', cover_id: null, pdf_id: null, published: false, problems: [] }
    : await org.get(`/books/${param}`);
  if (!alive()) return;
  let pdf = book.pdf_id && book.pdf_kind === 'bookpdf' ? { file_id: book.pdf_id, name: book.pdf_name, size: book.pdf_size, page_count: book.page_count } : null;
  let uploading = null; // { cancelled } while a PDF is being sent
  let freshPdf = null; // a PDF uploaded here and not saved yet
  let dirty = false;
  ctx.setDirtyCheck(() => dirty || Boolean(uploading));

  const pdfBox = () => `
    <div class="o-field"><span class="o-label">PDF файлы <i>*</i></span>
      <div class="o-file-box o-pdf-box">
        <div class="o-pdf-info" data-pdf-info>
          ${pdf ? `${icon('book')}<span><b>${esc(pdf.name || 'kitap.pdf')}</b><small>${formatBytes(pdf.size)}${pdf.page_count ? ` · ${pdf.page_count} бет` : ''}</small></span>` : '<span class="o-file-empty">PDF жүктелмеген</span>'}
        </div>
        <div class="o-upload-progress" data-progress hidden><div><i></i></div><span></span></div>
        <div class="o-file-actions">
          <button type="button" class="btn btn-dark btn-sm" data-act="pdf">${pdf ? 'PDF ауыстыру' : 'PDF жүктеу'}</button>
          <button type="button" class="btn btn-ghost btn-sm" data-act="cancel-upload" hidden>Тоқтату</button>
        </div>
      </div>
      <small class="o-hint">Тек PDF, ең көбі ${esc(limits.max_pdf_label)}. Файл бөліктермен жүктеледі: жүктеу аяқталмайынша кітапты сақтауға болмайды.</small>
    </div>`;

  const draw = () => {
    el.innerHTML = `
      <p class="o-back"><a href="/organizer/books" data-link>← Кітаптар</a></p>
      <form class="o-card" data-form novalidate>
        <div class="o-card-head"><h2>${isNew ? 'Жаңа кітап' : 'Кітапты өңдеу'}</h2>${isNew ? '' : statusBadge(book.published)}</div>
        <div class="o-grid-2">
          <label class="o-field"><span class="o-label">Кітап атауы <i>*</i></span><input name="title" maxlength="200" value="${esc(book.title)}" required /></label>
          <label class="o-field"><span class="o-label">Пән</span><input name="subject" maxlength="120" value="${esc(book.subject || SUBJECT)}" /></label>
        </div>
        <div class="o-grid-2">
          ${select({ name: 'grade', label: 'Сынып', value: book.grade ?? '', options: [{ value: '', label: '— Таңдалмаған —' }, ...GRADES.map((g) => ({ value: g, label: gradeLabel(g) }))] })}
          ${select({ name: 'publisher', label: 'Баспа', value: book.publisher || '', options: [{ value: '', label: '— Таңдалмаған —' }, ...PUBLISHERS.map((x) => ({ value: x, label: x }))] })}
        </div>
        <label class="o-field"><span class="o-label">Сипаттама (міндетті емес)</span><textarea name="description" rows="3" maxlength="2000">${esc(book.description || '')}</textarea></label>
        <div class="o-grid-2 o-book-files">
          ${fileField({ name: 'cover_id', kind: 'image', value: book.cover_id, label: 'Мұқаба суреті *', hint: 'JPG, PNG немесе WEBP, ең көбі 3 МБ. Тік (3:4) сурет жақсы көрінеді.' })}
          <div data-pdf-box>${pdfBox()}</div>
        </div>
        <label class="o-toggle"><input type="checkbox" name="published" ${book.published ? 'checked' : ''} /><span></span>Оқушыларға көрсету (мұқаба мен PDF толық жүктелгенде ғана)</label>
      </form>
      <div class="o-savebar${dirty ? ' is-dirty' : ''}">
        <span>${dirty ? 'Сақталмаған өзгерістер бар' : isNew ? 'Жаңа кітап' : 'Барлық өзгеріс сақталған'}</span>
        <button type="button" class="btn" data-act="save">Сақтау</button>
      </div>`;
    bindFileFields(el, ctx);
    document.getElementById('o-title').textContent = book.title || 'Кітап';
  };
  draw();

  const setDirty = () => {
    dirty = true;
    const bar = el.querySelector('.o-savebar');
    bar.classList.add('is-dirty');
    bar.querySelector('span').textContent = 'Сақталмаған өзгерістер бар';
  };
  el.addEventListener('input', setDirty);
  el.addEventListener('change', setDirty);

  const progress = (share, text) => {
    const box = el.querySelector('[data-progress]');
    box.hidden = share === null;
    if (share !== null) {
      box.querySelector('i').style.width = `${Math.round(share * 100)}%`;
      box.querySelector('span').textContent = text;
    }
  };

  async function pickPdf() {
    const file = await new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.pdf,application/pdf';
      input.addEventListener('change', () => resolve(input.files[0] || null));
      input.click();
    });
    if (!file) return;
    if (!/\.pdf$/i.test(file.name)) return toast('Тек PDF файлын таңдаңыз.', 'error');
    if (file.size > limits.max_pdf) return toast(`PDF көлемі ${limits.max_pdf_label} аспауы керек (қазір ${formatBytes(file.size)}).`, 'error');
    if (!file.size) return toast('Файл бос.', 'error');
    const saveBtn = el.querySelector('[data-act="save"]');
    const pdfBtn = el.querySelector('[data-act="pdf"]');
    const cancelBtn = el.querySelector('[data-act="cancel-upload"]');
    uploading = { cancelled: false };
    saveBtn.disabled = true;
    pdfBtn.disabled = true;
    cancelBtn.hidden = false;
    try {
      progress(0, 'PDF тексерілуде…');
      let pages;
      try {
        pages = await countPages(file);
      } catch {
        throw new Error('PDF файлы ашылмады: файл бүлінген немесе құпиясөзбен қорғалған. Басқа файлды таңдаңыз.');
      }
      const done = await uploadPdf(file, pages, (share) => progress(share, `Жүктелуде: ${Math.round(share * 100)}% (${formatBytes(file.size * share)} / ${formatBytes(file.size)})`), uploading);
      if (freshPdf && freshPdf !== done.file_id) org.del(`/books/uploads/${freshPdf}`).catch(() => {});
      freshPdf = done.file_id;
      pdf = done;
      el.querySelector('[data-pdf-box]').innerHTML = pdfBox();
      setDirty();
      toast(`PDF жүктелді: ${pages} бет. Кітапты сақтаңыз.`);
    } catch (err) {
      progress(null);
      toast(err.message, 'error');
    } finally {
      uploading = null;
      el.querySelector('[data-act="save"]').disabled = false;
      const again = el.querySelector('[data-act="pdf"]');
      if (again) again.disabled = false;
      const c = el.querySelector('[data-act="cancel-upload"]');
      if (c) c.hidden = true;
    }
  }

  el.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'pdf') return pickPdf();
    if (btn.dataset.act === 'cancel-upload') {
      if (uploading) uploading.cancelled = true;
      return;
    }
    if (btn.dataset.act !== 'save') return;
    if (uploading) return toast('PDF жүктелуін күтіңіз.', 'error');
    const form = el.querySelector('[data-form]');
    const body = {
      title: form.title.value,
      subject: form.subject.value,
      grade: form.grade.value || null,
      publisher: form.publisher.value,
      description: form.description.value,
      cover_id: Number(form.cover_id.value) || null,
      pdf_id: pdf?.file_id || null,
      published: form.published.checked,
    };
    await busy(btn, async () => {
      try {
        book = isNew ? await org.post('/books', body) : await org.put(`/books/${book.id}`, body);
      } catch (err) {
        // A book that cannot be published yet is still saved as hidden.
        if (body.published && /жарияланбады/.test(err.message)) {
          book = isNew ? await org.post('/books', { ...body, published: false }) : await org.put(`/books/${book.id}`, { ...body, published: false });
          toast(`${err.message} Кітап жасырын күйде сақталды.`, 'error');
        } else throw err;
      }
      freshPdf = null;
      dirty = false;
      if (!body.published || book.published) toast(book.published ? 'Сақталды. Кітап оқушыларға көрінеді.' : 'Сақталды. Кітап әзірге жасырын.');
      if (isNew) return ctx.navigate(`/organizer/books/${book.id}`, { replace: true });
      pdf = book.pdf_id ? { file_id: book.pdf_id, name: book.pdf_name, size: book.pdf_size, page_count: book.page_count } : null;
      draw();
    });
  });
}
