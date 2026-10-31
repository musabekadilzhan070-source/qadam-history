import { api } from '../api.js';
import { esc } from '../util.js';
import { icon } from '../art.js';
import { gradeLabel } from '../catalog.js';
import { openChunked } from '../pdf.js';
import { activity } from '../activity.js';

// The book reader: one page at a time on a canvas, inside QADAM (no new tab, no other site).
// Prev/next and page number, zoom, text search, and the last page saved on the server.

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];
const norm = (s) => s.toLocaleLowerCase('kk').replace(/\s+/g, ' ');

export async function readerView(el, [id], app, alive) {
  const book = await api.get(`/api/books/${encodeURIComponent(id)}`);
  if (!alive()) return;
  app.setTitle(book.title);
  const meta = [book.subject, gradeLabel(book.grade), book.publisher].filter(Boolean).join(' · ');
  el.innerHTML = `
    <div class="reader">
      <div class="reader-head">
        <a class="link-more reader-back" href="/books" data-link>${icon('back')} Кітаптар</a>
        <div class="reader-title"><h1>${esc(book.title)}</h1><p>${esc(meta)}</p></div>
      </div>
      <div class="reader-bar panel" role="toolbar" aria-label="Кітапты басқару">
        <div class="reader-group">
          <button type="button" class="reader-btn" data-act="prev" aria-label="Алдыңғы бет">${icon('back')}</button>
          <label class="reader-page"><input type="number" inputmode="numeric" min="1" value="1" aria-label="Бет нөмірі" data-page /><span>/ <b data-total>…</b></span></label>
          <button type="button" class="reader-btn" data-act="next" aria-label="Келесі бет">${icon('arrow')}</button>
        </div>
        <div class="reader-group">
          <button type="button" class="reader-btn" data-act="zoom-out" aria-label="Кішірейту">−</button>
          <button type="button" class="reader-btn reader-zoom" data-act="fit" aria-label="Енге сыйдыру" data-zoom>100%</button>
          <button type="button" class="reader-btn" data-act="zoom-in" aria-label="Үлкейту">+</button>
        </div>
        <form class="reader-search" data-search role="search">
          <input type="search" placeholder="Кітаптан іздеу" aria-label="Кітаптан іздеу" data-q />
          <button type="submit" class="reader-btn" aria-label="Іздеу">${icon('search')}</button>
        </form>
      </div>
      <p class="reader-status" data-status role="status">Кітап жүктелуде…</p>
      <div class="reader-stage" data-stage><canvas data-canvas></canvas></div>
      <div class="reader-foot">
        <button type="button" class="btn btn-ghost btn-sm" data-act="prev">${icon('back')} Алдыңғы</button>
        <button type="button" class="btn btn-dark btn-sm" data-act="next">Келесі ${icon('arrow', 'icon icon-arrow')}</button>
      </div>
    </div>`;

  const $ = (sel) => el.querySelector(sel);
  let statusSticky = false; // a search result stays shown while its page is drawn
  const status = (text, sticky = false) => {
    statusSticky = sticky;
    $('[data-status]').textContent = text;
    $('[data-status]').hidden = !text;
  };
  let doc = null;
  let task = null;
  let page = Math.max(1, book.last_page || 1);
  let zoom = null; // null = fit to width
  let rendering = null;
  let saveTimer = null;
  let stopped = false;

  try {
    ({ task, doc } = await openChunked(`/api/books/${book.id}/pdf/${book.pdf.file_id}`, book.pdf, (got) => {
      if (got < 0) status('Байланыс үзілді: бет жүктелмеді. Интернетті тексеріп, бетті қайта ашыңыз.');
    }));
  } catch {
    if (!alive()) return;
    status('');
    $('.reader-stage').outerHTML = '<div class="panel empty"><p>Кітапты ашу мүмкін болмады. Интернетті тексеріп, қайталаңыз. Қате қайталанса, организаторға хабарлаңыз.</p></div>';
    return;
  }
  if (!alive()) return task.destroy();
  page = Math.min(page, doc.numPages);
  $('[data-total]').textContent = doc.numPages;
  $('[data-page]').max = doc.numPages;
  activity.set({ kind: 'book', book_id: book.id, page });
  api.post(`/api/books/${book.id}/open`).catch(() => {});

  async function render() {
    if (stopped) return;
    const n = page;
    const current = (rendering = {});
    const p = await doc.getPage(n);
    if (current !== rendering || stopped) return;
    const stage = $('[data-stage]');
    const base = p.getViewport({ scale: 1 });
    // Fit to the width, but no wider than a comfortable reading column on a big screen.
    const fit = Math.max(0.2, (Math.min(stage.clientWidth, 880) - 2) / base.width);
    const scale = zoom ?? fit;
    const ratio = Math.min(window.devicePixelRatio || 1, 2.5);
    const viewport = p.getViewport({ scale: scale * ratio });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
    canvas.style.height = `${Math.floor(viewport.height / ratio)}px`;
    canvas.dataset.canvas = '';
    canvas.setAttribute('aria-label', `${n}-бет`);
    await p.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
    if (current !== rendering || stopped) return;
    stage.replaceChildren(canvas);
    $('[data-zoom]').textContent = `${Math.round(scale * 100)}%`;
    if (!statusSticky) status('');
  }

  function show(n, keepStatus = false) {
    if (!keepStatus) statusSticky = false;
    const next = Math.max(1, Math.min(doc.numPages, Math.round(Number(n)) || 1));
    page = next;
    $('[data-page]').value = page;
    el.querySelectorAll('[data-act="prev"]').forEach((b) => (b.disabled = page <= 1));
    el.querySelectorAll('[data-act="next"]').forEach((b) => (b.disabled = page >= doc.numPages));
    activity.page(page);
    activity.touch();
    render().catch(() => status('Бұл бетті көрсету мүмкін болмады.'));
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => api.post(`/api/books/${book.id}/progress`, { page, page_count: doc.numPages }).catch(() => {}), 1200);
  }

  function setZoom(dir) {
    const shown = parseInt($('[data-zoom]').textContent, 10) / 100 || 1;
    if (dir === 0) zoom = null;
    else if (dir > 0) zoom = ZOOMS.find((z) => z > shown + 0.01) ?? ZOOMS[ZOOMS.length - 1];
    else zoom = [...ZOOMS].reverse().find((z) => z < shown - 0.01) ?? ZOOMS[0];
    render().catch(() => {});
  }

  // Text search from the current page on; a scanned book has no text to find.
  let search = null;
  async function find(q) {
    const needle = norm(q.trim());
    if (needle.length < 2) return status('Іздеу үшін кемінде 2 әріп жазыңыз.');
    const start = search && search.q === needle ? search.page + 1 : page;
    search = { q: needle, page: start };
    const total = doc.numPages;
    let anyText = false;
    for (let k = 0; k < total; k += 1) {
      if (stopped || search.q !== needle) return;
      const n = ((start - 1 + k) % total) + 1;
      status(`Іздеу: ${n}-бет…`);
      const text = await (await doc.getPage(n)).getTextContent();
      const joined = norm(text.items.map((i) => i.str).join(' '));
      if (joined.trim()) anyText = true;
      const at = joined.indexOf(needle);
      if (at >= 0) {
        search.page = n;
        statusSticky = true;
        show(n, true);
        const snippet = joined.slice(Math.max(0, at - 40), at + needle.length + 60);
        status(`Табылды: ${n}-бет. «…${snippet}…» Келесісін іздеу үшін тағы басыңыз.`, true);
        return;
      }
    }
    search = null;
    status(anyText ? `«${q.trim()}» кітаптан табылмады.` : 'Бұл кітапта іздеуге болатын мәтін жоқ (беттері сурет ретінде сканерленген).');
  }

  el.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'prev') show(page - 1);
    else if (act === 'next') show(page + 1);
    else if (act === 'zoom-in') setZoom(1);
    else if (act === 'zoom-out') setZoom(-1);
    else if (act === 'fit') setZoom(0);
  });
  $('[data-page]').addEventListener('change', (e) => show(e.target.value));
  $('[data-search]').addEventListener('submit', (e) => {
    e.preventDefault();
    find($('[data-q]').value).catch(() => status('Іздеу кезінде қате шықты.'));
  });
  $('[data-q]').addEventListener('input', () => {
    search = null;
  });
  const onKey = (e) => {
    if (e.target.closest('input, textarea, select')) return;
    if (e.key === 'ArrowRight') show(page + 1);
    if (e.key === 'ArrowLeft') show(page - 1);
  };
  document.addEventListener('keydown', onKey);
  // Swipe left/right on a phone turns the page when the page is not zoomed in.
  let touchX = null;
  const stage = $('[data-stage]');
  stage.addEventListener('touchstart', (e) => {
    touchX = e.touches.length === 1 && stage.scrollWidth <= stage.clientWidth + 2 ? e.touches[0].clientX : null;
  }, { passive: true });
  stage.addEventListener('touchend', (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 60) show(page + (dx < 0 ? 1 : -1));
    touchX = null;
  }, { passive: true });
  let resizeTimer = null;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => zoom === null && render().catch(() => {}), 200);
  };
  window.addEventListener('resize', onResize);

  show(page);

  return () => {
    stopped = true;
    clearTimeout(saveTimer);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    activity.set({ kind: 'site' });
    task?.destroy();
  };
}
