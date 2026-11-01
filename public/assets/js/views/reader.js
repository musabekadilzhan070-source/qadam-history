import { api } from '../api.js';
import { esc } from '../util.js';
import { icon } from '../art.js';
import { gradeLabel } from '../catalog.js';
import { openChunked } from '../pdf.js';
import { activity } from '../activity.js';

// The book reader, inside QADAM (no new tab, no other site). Every page is drawn by pdf.js from
// the PDF itself, so fonts, Kazakh letters, tables, pictures and colours look as in the original;
// a scanned book is shown as its page pictures.
//
// The layout follows the screen and changes on resize or rotation:
//  • wide screen (computer, landscape tablet): one page at a time (or two side by side), prev/next,
//    fit the whole page or the width, zoom;
//  • narrow screen (phone, portrait tablet): every page one under another, full width, scrolled.
//    Only the pages near the screen are drawn; far ones are dropped again to save memory.

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];
const norm = (s) => s.toLocaleLowerCase('kk').replace(/\s+/g, ' ');
const PAGED = '(min-width: 900px)';
const SPREAD = '(min-width: 1200px)';
// iOS Safari refuses canvases above ~16.7 million pixels; stay under it.
const MAX_PIXELS = 16_000_000;

/** Pixel ratio for a page shown at cssW × cssH: sharp on retina screens, within the canvas limit. */
function pixelRatio(cssW, cssH, cap) {
  const want = Math.min(Math.max(window.devicePixelRatio || 1, 1), cap);
  return Math.max(0.5, Math.min(want, Math.sqrt(MAX_PIXELS / Math.max(1, cssW * cssH))));
}

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
        <div class="reader-group" data-paged>
          <button type="button" class="reader-btn" data-act="zoom-out" aria-label="Кішірейту">−</button>
          <button type="button" class="reader-btn reader-zoom" data-act="fit" data-zoom title="Бетті экранға / енге сыйдыру">100%</button>
          <button type="button" class="reader-btn" data-act="zoom-in" aria-label="Үлкейту">+</button>
          <button type="button" class="reader-btn reader-spread" data-act="spread" data-spread aria-pressed="false" title="Екі бетті қатар көрсету">2 бет</button>
        </div>
        <div class="reader-group">
          <button type="button" class="reader-btn reader-text" data-act="full" aria-pressed="false" title="Кітапты бүкіл экранға ашу">Толық экран</button>
          ${book.allow_download ? '<button type="button" class="reader-btn reader-text" data-act="download" title="PDF файлын құрылғыға сақтау">PDF жүктеу</button>' : ''}
        </div>
        <form class="reader-search" data-search role="search">
          <input type="search" placeholder="Кітаптан іздеу" aria-label="Кітаптан іздеу" data-q />
          <button type="submit" class="reader-btn" aria-label="Іздеу">${icon('search')}</button>
        </form>
      </div>
      <p class="reader-status" data-status role="status">Кітап жүктелуде…</p>
      <div class="reader-stage" data-stage></div>
      <div class="reader-foot" data-paged>
        <button type="button" class="btn btn-ghost btn-sm" data-act="prev">${icon('back')} Алдыңғы</button>
        <button type="button" class="btn btn-dark btn-sm" data-act="next">Келесі ${icon('arrow', 'icon icon-arrow')}</button>
      </div>
      <div class="reader-float" data-float aria-hidden="true"></div>
    </div>`;

  const $ = (sel) => el.querySelector(sel);
  const stage = $('[data-stage]');
  const readerEl = $('.reader');
  let statusSticky = false; // a search result stays shown while its page is drawn
  const status = (text, sticky = false) => {
    statusSticky = sticky;
    $('[data-status]').textContent = text;
    $('[data-status]').hidden = !text;
  };
  let doc = null;
  let task = null;
  let page = Math.max(1, book.last_page || 1);
  let mode = null; // 'paged' | 'scroll'
  let fit = 'page'; // paged mode without zoom: the whole page on the screen, or the full width
  let zoom = null; // paged mode: a fixed scale instead of fitting
  let spread = false;
  let full = false;
  let saveTimer = null;
  let stopped = false;
  const sizes = new Map(); // page → {w, h} at scale 1

  try {
    ({ task, doc } = await openChunked(`/api/books/${book.id}/pdf/${book.pdf.file_id}`, book.pdf, (got) => {
      if (got < 0) status('Байланыс үзілді: бет жүктелмеді. Интернетті тексеріп, бетті қайта ашыңыз.');
    }));
  } catch {
    if (!alive()) return;
    status('');
    stage.outerHTML = '<div class="panel empty"><p>Кітапты ашу мүмкін болмады. Интернетті тексеріп, қайталаңыз. Қате қайталанса, организаторға хабарлаңыз.</p></div>';
    return;
  }
  if (!alive()) return task.destroy();
  const total = doc.numPages;
  page = Math.min(page, total);
  $('[data-total]').textContent = total;
  $('[data-page]').max = total;
  activity.set({ kind: 'book', book_id: book.id, page });
  api.post(`/api/books/${book.id}/open`).catch(() => {});

  async function sizeOf(n) {
    if (!sizes.has(n)) {
      const v = (await doc.getPage(n)).getViewport({ scale: 1 });
      sizes.set(n, { w: v.width, h: v.height });
    }
    return sizes.get(n);
  }

  /** Draws page n into `canvas` at a CSS width; returns the pdf.js render task. */
  async function paint(canvas, n, cssW) {
    const p = await doc.getPage(n);
    const base = p.getViewport({ scale: 1 });
    sizes.set(n, { w: base.width, h: base.height });
    const scale = cssW / base.width;
    const cssH = base.height * scale;
    // A scrolled book keeps several pages drawn at once: a little less sharpness, far less memory.
    const ratio = pixelRatio(cssW, cssH, mode === 'scroll' ? 2 : 3);
    const viewport = p.getViewport({ scale: scale * ratio });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${Math.round(cssW)}px`;
    canvas.style.height = `${Math.round(cssH)}px`;
    canvas.setAttribute('aria-label', `${n}-бет`);
    // White paper under transparent pages, exactly like a PDF viewer.
    return p.render({ canvas, canvasContext: canvas.getContext('2d'), viewport, background: '#ffffff' });
  }

  // Page changes: the page box, the buttons, active reading time and the saved last page.
  function setPage(n) {
    page = n;
    // Not while the student is typing a page number into the box.
    if (document.activeElement !== $('[data-page]')) $('[data-page]').value = page;
    $('[data-float]').textContent = `${page} / ${total}`;
    const step = spreadOn() ? pagesOf(page).length : 1;
    el.querySelectorAll('[data-act="prev"]').forEach((b) => (b.disabled = page <= 1));
    el.querySelectorAll('[data-act="next"]').forEach((b) => (b.disabled = page + step - 1 >= total));
    activity.page(page);
    activity.touch();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => api.post(`/api/books/${book.id}/progress`, { page, page_count: total }).catch(() => {}), 1200);
  }

  // ─── Paged mode ─────────────────────────────────────────────────
  // In full screen the reader itself scrolls (it covers the site); otherwise the page does.
  const siteTop = () => (full ? 0 : parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--top')) || 64);
  const scrollTop = () => (full ? readerEl.scrollTop : window.scrollY);
  const scrollToY = (y) => (full ? readerEl.scrollTo({ top: Math.max(0, y) }) : window.scrollTo({ top: Math.max(0, y) }));
  const viewTop = () => (full ? readerEl.getBoundingClientRect().top : 0);
  /** Height taken at the top of the screen by the site bar and the sticky reader toolbar. */
  const topOffset = () => siteTop() + 8 + $('.reader-bar').offsetHeight + 12;
  /** After turning a page, bring the page's top under the toolbar if it is scrolled away. */
  const alignPaged = () => {
    const y = stage.getBoundingClientRect().top - viewTop() + scrollTop() - topOffset();
    if (Math.abs(scrollTop() - y) > 4 && scrollTop() > y) scrollToY(y);
  };
  const spreadOn = () => mode === 'paged' && spread && matchMedia(SPREAD).matches;
  /** The cover is alone, then pages go in pairs as in a printed book: 1 | 2–3 | 4–5 … */
  const pagesOf = (n) => {
    if (!spreadOn() || n === 1) return [n];
    const left = n % 2 === 0 ? n : n - 1;
    return left + 1 <= total ? [left, left + 1] : [left];
  };
  let drawing = null;

  async function renderPaged() {
    if (stopped || mode !== 'paged') return;
    const current = (drawing = {});
    const list = pagesOf(page);
    const dims = await Promise.all(list.map(sizeOf));
    if (current !== drawing) return;
    const gap = 12;
    const availW = Math.max(200, stage.clientWidth - 2 - gap * (list.length - 1));
    // The whole page fits under the sticky top bar and the reader's toolbar.
    // At the top of the page the title is above the stage too: the page still fits on the screen.
    const availH = Math.max(320, window.innerHeight - Math.max(topOffset(), stage.getBoundingClientRect().top) - 16);
    const sumW = dims.reduce((s, d) => s + d.w, 0);
    const maxH = Math.max(...dims.map((d) => d.h));
    const fitWidth = availW / sumW;
    const fitPage = Math.min(fitWidth, availH / maxH);
    const scale = zoom ?? (fit === 'page' ? fitPage : fitWidth);
    const canvases = list.map(() => document.createElement('canvas'));
    await Promise.all(list.map((n, i) => paint(canvases[i], n, dims[i].w * scale).then((t) => t.promise)));
    if (current !== drawing || stopped) return;
    const row = document.createElement('div');
    row.className = 'reader-spreadrow';
    row.append(...canvases);
    stage.replaceChildren(row);
    $('[data-zoom]').textContent = `${Math.round(scale * 100)}%`;
    $('[data-zoom]').setAttribute('aria-label', zoom ? 'Бетті экранға сыйдыру' : fit === 'page' ? 'Енге сыйдыру' : 'Бетті экранға сыйдыру');
    if (!statusSticky) status('');
  }

  // ─── Scroll mode ────────────────────────────────────────────────
  let slots = [];
  let io = null;
  const drawn = new Map(); // page → {canvas, task, width}
  const KEEP = 7; // pages kept drawn around the reading place

  function buildScroll() {
    const first = sizes.get(page) || sizes.get(1);
    const ratio = first ? first.h / first.w : 1.414;
    const list = document.createElement('div');
    list.className = 'reader-scroll';
    slots = Array.from({ length: total }, (_, i) => {
      const slot = document.createElement('div');
      slot.className = 'reader-pg';
      slot.dataset.n = i + 1;
      const s = sizes.get(i + 1);
      slot.style.aspectRatio = `${s ? s.w : 1} / ${s ? s.h : ratio}`;
      slot.innerHTML = `<span class="reader-pg-n">${i + 1}</span>`;
      list.append(slot);
      return slot;
    });
    stage.replaceChildren(list);
    io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) drawSlot(Number(e.target.dataset.n));
      },
      { rootMargin: '120% 0px' },
    );
    slots.forEach((s) => io.observe(s));
  }

  async function drawSlot(n) {
    if (stopped || mode !== 'scroll') return;
    const slot = slots[n - 1];
    const width = slot.clientWidth;
    const have = drawn.get(n);
    if (have && Math.abs(have.width - width) < 2) return;
    have?.task?.cancel();
    const canvas = document.createElement('canvas');
    const entry = { canvas, task: null, width };
    drawn.set(n, entry);
    try {
      entry.task = await paint(canvas, n, width);
      if (drawn.get(n) !== entry) return entry.task.cancel();
      await entry.task.promise;
    } catch {
      if (drawn.get(n) === entry) drawn.delete(n);
      return;
    }
    if (drawn.get(n) !== entry || stopped) return;
    const s = sizes.get(n);
    slot.style.aspectRatio = `${s.w} / ${s.h}`;
    canvas.style.width = '100%';
    canvas.style.height = 'auto';
    slot.replaceChildren(canvas);
    slot.classList.add('is-drawn');
    trim();
  }

  /** Drops drawn pages far from the reading place. */
  function trim() {
    if (drawn.size <= KEEP) return;
    const far = [...drawn.keys()].sort((a, b) => Math.abs(b - page) - Math.abs(a - page));
    for (const n of far.slice(0, drawn.size - KEEP)) {
      drawn.get(n).task?.cancel();
      drawn.delete(n);
      const slot = slots[n - 1];
      slot.classList.remove('is-drawn');
      slot.innerHTML = `<span class="reader-pg-n">${n}</span>`;
    }
  }

  /** The page under the middle of the screen is the one being read. */
  let scrollRaf = 0;
  const onScroll = () => {
    if (mode !== 'scroll' || scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      const mid = window.innerHeight / 2;
      const hit = document.elementFromPoint(stage.getBoundingClientRect().left + stage.clientWidth / 2, mid)?.closest('.reader-pg');
      const n = hit ? Number(hit.dataset.n) : null;
      if (n && n !== page) {
        setPage(n);
        if (!statusSticky) status('');
      }
      const r = stage.getBoundingClientRect();
      $('[data-float]').classList.toggle('is-on', r.top < 0 && r.bottom > window.innerHeight / 2);
    });
  };

  function scrollToPage(n) {
    const slot = slots[n - 1];
    if (!slot) return;
    scrollToY(slot.getBoundingClientRect().top - viewTop() + scrollTop() - siteTop() - 12);
  }

  function teardownScroll() {
    io?.disconnect();
    io = null;
    for (const d of drawn.values()) d.task?.cancel();
    drawn.clear();
    slots = [];
    stage.replaceChildren();
  }

  // ─── Switching layouts ──────────────────────────────────────────
  async function applyMode() {
    const next = matchMedia(PAGED).matches ? 'paged' : 'scroll';
    $('[data-spread]').hidden = !matchMedia(SPREAD).matches;
    if (next === mode) {
      if (mode === 'paged') {
        if (zoom === null) renderPaged().catch(() => {});
      } else {
        // Wider or narrower pages: draw the visible ones again at the new width.
        for (const n of [...drawn.keys()]) drawSlot(n);
      }
      return;
    }
    mode = next;
    el.querySelector('.reader').dataset.mode = mode;
    el.querySelectorAll('[data-paged]').forEach((x) => (x.hidden = mode !== 'paged'));
    $('[data-float]').classList.remove('is-on');
    if (mode === 'paged') {
      teardownScroll();
      show(page);
    } else {
      drawing = null;
      await sizeOf(page).catch(() => null);
      if (stopped) return;
      buildScroll();
      setPage(page);
      if (page > 1) requestAnimationFrame(() => scrollToPage(page));
    }
  }

  function show(n, keepStatus = false) {
    if (!keepStatus) statusSticky = false;
    let next = Math.max(1, Math.min(total, Math.round(Number(n)) || 1));
    if (spreadOn()) next = pagesOf(next)[0];
    setPage(next);
    if (mode === 'paged') {
      alignPaged();
      renderPaged().catch(() => status('Бұл бетті көрсету мүмкін болмады.'));
    }
    else scrollToPage(next);
  }
  const turn = (dir) => {
    if (dir > 0) show(page + pagesOf(page).length);
    else show(spreadOn() ? pagesOf(Math.max(1, page - 1))[0] : page - 1);
  };

  function setZoom(dir) {
    const shown = parseInt($('[data-zoom]').textContent, 10) / 100 || 1;
    if (dir === 0) {
      // Fit button: back to fitting if zoomed, otherwise switch between whole page and full width.
      if (zoom !== null) zoom = null;
      else fit = fit === 'page' ? 'width' : 'page';
    } else if (dir > 0) zoom = ZOOMS.find((z) => z > shown + 0.01) ?? ZOOMS[ZOOMS.length - 1];
    else zoom = [...ZOOMS].reverse().find((z) => z < shown - 0.01) ?? ZOOMS[0];
    renderPaged().catch(() => {});
  }

  // Text search from the current page on; a scanned book has no text to find.
  let search = null;
  async function find(q) {
    const needle = norm(q.trim());
    if (needle.length < 2) return status('Іздеу үшін кемінде 2 әріп жазыңыз.');
    const start = search && search.q === needle ? search.page + 1 : page;
    search = { q: needle, page: start };
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

  // Full screen: the browser's own full screen where it exists (not on iPhone), and in every
  // browser the reader covers the whole window, so only the book and its toolbar are seen.
  async function setFull(on) {
    const keep = page;
    full = on;
    readerEl.classList.toggle('is-full', on);
    document.documentElement.classList.toggle('reader-full-open', on);
    const btn = $('[data-act="full"]');
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = on ? 'Шығу' : 'Толық экран';
    btn.title = on ? 'Толық экраннан шығу (Esc)' : 'Кітапты бүкіл экранға ашу';
    try {
      if (on && readerEl.requestFullscreen && !document.fullscreenElement) await readerEl.requestFullscreen();
      if (!on && document.fullscreenElement) await document.exitFullscreen();
    } catch {
      /* the covering layout works without the browser's full screen */
    }
    requestAnimationFrame(() => {
      if (mode === 'paged') renderPaged().catch(() => {});
      else {
        for (const n of [...drawn.keys()]) drawSlot(n);
        scrollToPage(keep);
      }
    });
  }

  // The organizer allowed saving the PDF: its pieces are joined into one file on the device.
  async function download(btn) {
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    try {
      const { file_id: fileId, chunks } = book.pdf;
      const parts = [];
      for (let i = 0; i < chunks; i += 1) {
        status(`PDF дайындалуда: ${Math.round((i / chunks) * 100)}%`, true);
        const res = await fetch(`/api/books/${book.id}/pdf/${fileId}/${i}`, { credentials: 'same-origin' });
        if (!res.ok) throw new Error();
        parts.push(await res.arrayBuffer());
      }
      const url = URL.createObjectURL(new Blob(parts, { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `qadam-kitap-${book.id}.pdf`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      status('PDF файлы сақталды.', true);
    } catch {
      status('PDF жүктелмеді. Интернетті тексеріп, қайталаңыз.', true);
    } finally {
      btn.disabled = false;
    }
  }

  el.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'prev') turn(-1);
    else if (act === 'next') turn(1);
    else if (act === 'zoom-in') setZoom(1);
    else if (act === 'zoom-out') setZoom(-1);
    else if (act === 'fit') setZoom(0);
    else if (act === 'full') setFull(!full);
    else if (act === 'download') download(e.target.closest('[data-act]'));
    else if (act === 'spread') {
      spread = !spread;
      $('[data-spread]').setAttribute('aria-pressed', String(spread));
      show(page);
    }
  });
  $('[data-page]').addEventListener('change', (e) => {
    e.target.blur();
    show(e.target.value);
  });
  $('[data-search]').addEventListener('submit', (e) => {
    e.preventDefault();
    find($('[data-q]').value).catch(() => status('Іздеу кезінде қате шықты.'));
  });
  $('[data-q]').addEventListener('input', () => {
    search = null;
  });
  const onKey = (e) => {
    if (e.key === 'Escape' && full && !document.fullscreenElement) return setFull(false);
    if (mode !== 'paged' || e.target.closest('input, textarea, select')) return;
    if (e.key === 'ArrowRight') turn(1);
    if (e.key === 'ArrowLeft') turn(-1);
  };
  document.addEventListener('keydown', onKey);
  // Swipe left/right turns the page in paged mode (a landscape tablet) when not zoomed in.
  let touchX = null;
  stage.addEventListener('touchstart', (e) => {
    touchX = mode === 'paged' && e.touches.length === 1 && stage.scrollWidth <= stage.clientWidth + 2 ? e.touches[0].clientX : null;
  }, { passive: true });
  stage.addEventListener('touchend', (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 60) turn(dx < 0 ? 1 : -1);
    touchX = null;
  }, { passive: true });
  let resizeTimer = null;
  let lastWidth = window.innerWidth;
  let lastHeight = window.innerHeight;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      // A phone's address bar showing or hiding changes only the height: no redraw needed then.
      const widthChanged = Math.abs(window.innerWidth - lastWidth) > 1;
      const heightChanged = Math.abs(window.innerHeight - lastHeight) > 80;
      lastWidth = window.innerWidth;
      lastHeight = window.innerHeight;
      if (!widthChanged && !(heightChanged && mode === 'paged')) return;
      const keep = page;
      applyMode().then(() => mode === 'scroll' && widthChanged && scrollToPage(keep)).catch(() => {});
    }, 200);
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('scroll', onScroll, { passive: true });
  readerEl.addEventListener('scroll', onScroll, { passive: true });
  const onFullChange = () => {
    if (!document.fullscreenElement && full) setFull(false);
  };
  document.addEventListener('fullscreenchange', onFullChange);

  await applyMode();

  return () => {
    stopped = true;
    clearTimeout(saveTimer);
    teardownScroll();
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('scroll', onScroll);
    document.removeEventListener('fullscreenchange', onFullChange);
    document.documentElement.classList.remove('reader-full-open');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    activity.set({ kind: 'site' });
    task?.destroy();
  };
}
