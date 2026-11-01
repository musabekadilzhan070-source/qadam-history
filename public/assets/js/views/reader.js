import { api } from '../api.js';
import { esc } from '../util.js';
import { icon } from '../art.js';
import { gradeLabel } from '../catalog.js';
import { openChunked } from '../pdf.js';
import { activity } from '../activity.js';

// The book reader, inside QADAM (no new tab, no other site). Every page is drawn by pdf.js from
// the PDF itself, so fonts, Kazakh letters, tables, pictures and colours look as in the original;
// a scanned book is shown as its page pictures. Nothing is turned into HTML text.
//
// One layout on every screen, as on a phone: the book opens on its first page and every page
// lies under the previous one, read by scrolling down with the wheel, touchpad or finger.
// • Phone: pages take the full width.
// • Laptop and computer: pages stand in a centred column wide enough to read comfortably and
//   never wider than the screen; − / + make the column narrower or wider (never wider than the
//   screen, so there is no sideways scrolling). Page proportions are always the PDF's own.
// Only the pages near the screen are drawn; far ones are dropped again to save memory.

const norm = (s) => s.toLocaleLowerCase('kk').replace(/\s+/g, ' ');
// iOS Safari refuses canvases above ~16.7 million pixels; stay under it.
const MAX_PIXELS = 16_000_000;
/** The default column on a wide screen: an A4 page at about 1.5× its printed size. */
const READ_WIDTH = 920;
const MIN_WIDTH = 320;
/** Below this stage width the page takes the whole width and the zoom buttons are hidden. */
const NARROW = 700;

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
    <div class="reader" data-mode="scroll">
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
        <div class="reader-group" data-zoombar>
          <button type="button" class="reader-btn" data-act="zoom-out" aria-label="Кішірейту">−</button>
          <button type="button" class="reader-btn reader-zoom" data-act="fit" data-zoom title="Әдепкі өлшем / экран еніне сыйдыру">100%</button>
          <button type="button" class="reader-btn" data-act="zoom-in" aria-label="Үлкейту">+</button>
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
      <div class="reader-resume" data-resume hidden></div>
      <div class="reader-stage" data-stage></div>
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
  // The book always opens on its first page; the page where the student stopped is offered.
  let page = 1;
  const lastPage = Math.max(1, book.last_page || 1);
  let colW = null; // the column width chosen with − / + (null: the default for the screen)
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
    // Several pages are kept drawn at once: up to 2× sharpness, within the memory a phone has.
    const ratio = pixelRatio(cssW, cssH, 2);
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
    el.querySelectorAll('[data-act="prev"]').forEach((b) => (b.disabled = page <= 1));
    el.querySelectorAll('[data-act="next"]').forEach((b) => (b.disabled = page >= total));
    activity.page(page);
    activity.touch();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => api.post(`/api/books/${book.id}/progress`, { page, page_count: total }).catch(() => {}), 1200);
  }

  // In full screen the reader itself scrolls (it covers the site); otherwise the page does.
  const siteTop = () => (full ? 0 : parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--top')) || 64);
  const scrollTop = () => (full ? readerEl.scrollTop : window.scrollY);
  const scrollToY = (y) => (full ? readerEl.scrollTo({ top: Math.max(0, y) }) : window.scrollTo({ top: Math.max(0, y) }));
  const viewTop = () => (full ? readerEl.getBoundingClientRect().top : 0);
  /** Height taken at the top of the screen by the site bar and the sticky reader toolbar. */
  const topOffset = () => siteTop() + (getComputedStyle($('.reader-bar')).position === 'sticky' ? 8 + $('.reader-bar').offsetHeight : 0) + 12;

  // ─── Column width ───────────────────────────────────────────────
  const narrow = () => stage.clientWidth < NARROW;
  /** The width the pages are shown at: never wider than the screen. */
  const columnWidth = () => {
    const room = Math.max(200, stage.clientWidth);
    if (narrow()) return room;
    return Math.round(Math.min(room, Math.max(MIN_WIDTH, colW ?? READ_WIDTH)));
  };
  function applyColumn() {
    const w = columnWidth();
    readerEl.style.setProperty('--col', `${w}px`);
    $('[data-zoombar]').hidden = narrow();
    const base = sizes.get(page) || sizes.get(1);
    if (base) $('[data-zoom]').textContent = `${Math.round((w / base.w) * 100)}%`;
    const room = stage.clientWidth;
    el.querySelector('[data-act="zoom-in"]').disabled = w >= room - 1;
    el.querySelector('[data-act="zoom-out"]').disabled = w <= MIN_WIDTH;
    $('[data-zoom]').setAttribute('aria-label', w >= room - 1 && colW ? 'Әдепкі өлшемге қайту' : 'Экран еніне сыйдыру');
    return w;
  }
  /** − / + / fit: a narrower or wider column, kept on the page being read. */
  function setZoom(dir) {
    const keep = page;
    const now = columnWidth();
    const room = stage.clientWidth;
    if (dir === 0) colW = colW !== null && now >= room - 1 ? null : room;
    else if (dir > 0) colW = Math.min(room, now * 1.2);
    else colW = Math.max(MIN_WIDTH, now / 1.2);
    applyColumn();
    for (const n of [...drawn.keys()]) drawSlot(n);
    requestAnimationFrame(() => scrollToPage(keep));
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
    if (stopped) return;
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
    if (scrollRaf) return;
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
    scrollToY(slot.getBoundingClientRect().top - viewTop() + scrollTop() - topOffset());
  }

  function teardownScroll() {
    io?.disconnect();
    io = null;
    for (const d of drawn.values()) d.task?.cancel();
    drawn.clear();
    slots = [];
    stage.replaceChildren();
  }

  // ─── Building and moving ────────────────────────────────────────
  async function build() {
    await sizeOf(1).catch(() => null);
    if (stopped) return;
    applyColumn();
    buildScroll();
    setPage(1);
    if (!statusSticky) status('');
  }

  function show(n, keepStatus = false) {
    if (!keepStatus) statusSticky = false;
    const next = Math.max(1, Math.min(total, Math.round(Number(n)) || 1));
    setPage(next);
    scrollToPage(next);
  }
  const turn = (dir) => show(page + dir);

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
      applyColumn();
      for (const n of [...drawn.keys()]) drawSlot(n);
      scrollToPage(keep);
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
    else if (act === 'resume') {
      $('[data-resume]').hidden = true;
      show(lastPage);
    } else if (act === 'resume-close') $('[data-resume]').hidden = true;
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
    if (e.target.closest('input, textarea, select')) return;
    if (e.key === 'ArrowRight') turn(1);
    if (e.key === 'ArrowLeft') turn(-1);
  };
  document.addEventListener('keydown', onKey);
  let resizeTimer = null;
  let lastWidth = window.innerWidth;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      // A phone's address bar showing or hiding changes only the height: no redraw needed then.
      const widthChanged = Math.abs(window.innerWidth - lastWidth) > 1;
      lastWidth = window.innerWidth;
      if (!widthChanged) return;
      const keep = page;
      applyColumn();
      for (const n of [...drawn.keys()]) drawSlot(n);
      requestAnimationFrame(() => scrollToPage(keep));
    }, 200);
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('scroll', onScroll, { passive: true });
  readerEl.addEventListener('scroll', onScroll, { passive: true });
  const onFullChange = () => {
    if (!document.fullscreenElement && full) setFull(false);
  };
  document.addEventListener('fullscreenchange', onFullChange);

  await build();
  if (lastPage > 1 && lastPage <= total) {
    const box = $('[data-resume]');
    box.innerHTML = `<span>Соңғы рет <b>${lastPage}-бетте</b> тоқтадыңыз.</span>
      <button type="button" class="btn btn-sm" data-act="resume">${lastPage}-беттен жалғастыру</button>
      <button type="button" class="reader-btn" data-act="resume-close" aria-label="Жабу">${icon('cross')}</button>`;
    box.hidden = false;
  }

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
