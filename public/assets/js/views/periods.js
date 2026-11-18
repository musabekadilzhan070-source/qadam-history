import { api } from '../api.js';
import { esc, pad2, scoreBadge } from '../util.js';
import { icon } from '../art.js';
import { periodCard, pageHead, testCard } from '../components.js';
import { site, renderIcon } from '../site.js';
import { topicClassLabel, gradeLabel } from '../catalog.js';

export async function periodsView(el, _params, _app, alive) {
  const { periods, totals } = await api.get('/api/overview');
  if (!alive()) return;
  el.innerHTML = `
    ${pageHead({
      eyebrow: 'Қазақстан тарихы',
      title: 'Тарихи кезеңдер',
      text: site.texts.periods_page_text || 'Кезеңді таңдап, әр тақырып бойынша тест тапсыр.',
      extra: `<ul class="head-stats"><li><b>${totals.periods}</b>кезең</li><li><b>${totals.topics}</b>тақырып</li><li><b>${totals.tests}</b>тест</li><li><b>${totals.questions}</b>сұрақ</li></ul>`,
    })}
    <div class="period-grid">${periods.map(periodCard).join('')}</div>`;
}

export const periodView = (el, [slug], app, alive) => periodPage(el, slug, null, app, alive);

/** The same page with one book already chosen (/periods/<slug>/books/<n>). */
export const periodBookView = (el, [slug, entry], app, alive) => periodPage(el, slug, Number(entry), app, alive);

const coverUrl = (b) => `/api/files/${b.cover_id}?v=${b.cover_version}`;
/** «8-сынып | Атамұра», or whichever half the book has. */
const bookLabel = (b) => [gradeLabel(b.grade), b.publisher].filter(Boolean).join(' | ');
const bookHref = (slug, b) => `/periods/${encodeURIComponent(slug)}/books/${b.id}`;

/** The book a student chose last on a period, so the next visit opens it. */
const memoryKey = (slug) => `qadam_period_book_${slug}`;
function remembered(slug) {
  try {
    return Number(localStorage.getItem(memoryKey(slug))) || 0;
  } catch {
    return 0;
  }
}
function remember(slug, entryId) {
  try {
    localStorage.setItem(memoryKey(slug), String(entryId));
  } catch {
    /* private mode: the choice is just not kept */
  }
}

/** A cover that fails to load becomes a plain title card instead of a broken image. */
function wireCovers(el) {
  el.querySelectorAll('.book-cover img').forEach((img) =>
    img.addEventListener('error', () => {
      const cover = img.parentElement;
      cover.classList.add('is-plain');
      cover.textContent = cover.dataset.title || '';
    }),
  );
}

/**
 * A period. Without books: its topics. With books: a button per book at the top
 * («8-сынып | Атамұра», «8-сынып | Мектеп» …); the chosen one is marked and its cover, «Кітапты
 * оқу» and all its tests show below. Switching books stays on the page (no reload); every book
 * is fetched once and kept, the others are fetched in the background.
 */
async function periodPage(el, slug, entryId, app, alive) {
  const period = await api.get(`/api/periods/${encodeURIComponent(slug)}`);
  if (!alive()) return;
  app.setTitle(period.title);
  const books = period.books || [];
  el.innerHTML = `
    <ol class="breadcrumb"><li><a href="/periods" data-link>Тарихи кезеңдер</a></li><li aria-current="page">${esc(period.title)}</li></ol>
    ${pageHead({
      eyebrow: period.range_label,
      title: period.title,
      text: period.summary,
      number: period.number,
      extra: `<ul class="head-stats"><li><b>${period.topic_count}</b>тақырып</li><li><b>${period.test_count}</b>тест</li><li><b>${period.question_count}</b>сұрақ</li></ul>`,
    })}
    ${
      books.length
        ? `<div class="book-tabs">
            <p class="book-tabs-title" id="book-tabs-title">${books.length > 1 ? 'Кітапты таңдаңыз' : 'Кезең кітабы'}</p>
            <div class="chips" role="group" aria-labelledby="book-tabs-title">
              ${books.map((b) => `<a class="chip chip-book" href="${bookHref(period.slug, b)}" data-entry="${b.id}" aria-pressed="false">${icon('book')}${esc(bookLabel(b) || b.title)}</a>`).join('')}
            </div>
          </div>
          <div data-book-pane></div>`
        : topicList(period)
    }`;
  if (!books.length) return;

  const pane = el.querySelector('[data-book-pane]');
  const cache = new Map();
  const load = (id) => {
    if (!cache.has(id)) {
      const p = api.get(`/api/periods/${encodeURIComponent(period.slug)}/books/${id}`);
      p.catch(() => cache.delete(id));
      cache.set(id, p);
    }
    return cache.get(id);
  };
  let shown = 0;

  const mark = () =>
    el.querySelectorAll('.chip-book').forEach((c) => {
      const on = Number(c.dataset.entry) === shown;
      c.setAttribute('aria-pressed', String(on));
      if (on) c.setAttribute('aria-current', 'true');
      else c.removeAttribute('aria-current');
    });

  async function choose(id, { push = false } = {}) {
    const b = books.find((x) => x.id === id);
    if (!b) return;
    shown = id;
    mark();
    remember(period.slug, id);
    const href = bookHref(period.slug, b);
    if (location.pathname !== href) history[push ? 'pushState' : 'replaceState'](null, '', href);
    app.setTitle(`${bookLabel(b) || b.title} · ${period.title}`);
    if (!cache.has(id)) pane.innerHTML = '<div class="panel empty"><p>Жүктелуде…</p></div>';
    let page;
    try {
      page = await load(id);
    } catch (err) {
      if (shown === id && alive()) pane.innerHTML = `<div class="panel empty"><p>${esc(err.message || 'Кітап ашылмады.')}</p></div>`;
      return;
    }
    if (shown !== id || !alive()) return;
    pane.innerHTML = bookPane(period, page);
    wireCovers(pane);
  }

  function chooser() {
    shown = 0;
    mark();
    pane.innerHTML = shelfChooser(period);
    wireCovers(pane);
  }

  el.addEventListener('click', (e) => {
    const a = e.target.closest('[data-entry]');
    if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    const id = Number(a.dataset.entry);
    if (id !== shown) choose(id, { push: true });
  });

  // Which book first: the one in the link, the only one, or the one chosen last time; otherwise
  // the student is asked to choose (the covers below the buttons).
  const valid = (id) => books.some((b) => b.id === id);
  const first = valid(entryId) ? entryId : books.length === 1 ? books[0].id : valid(remembered(period.slug)) ? remembered(period.slug) : 0;
  if (first) await choose(first);
  else chooser();
  // The other books load in the background, so switching is instant.
  for (const b of books) if (b.id !== shown) load(b.id).catch(() => {});
}

/** The books on this period as covers: shown until the student picks one. */
function shelfChooser(period) {
  return `
    <section class="shelf" aria-label="Кітаптар">
      <p class="shelf-text">Осы кезеңнің тесттері оқулық бойынша топталған. Өз оқулығыңызды таңдаңыз.</p>
      <ul class="shelf-grid">
        ${period.books
          .map(
            (b) => `
          <li class="shelf-card">
            <a href="${bookHref(period.slug, b)}" data-entry="${b.id}">
              <span class="book-cover" data-title="${esc(b.title)}"><img src="${coverUrl(b)}" alt="" loading="lazy" decoding="async" /></span>
              <span class="shelf-info">
                ${bookLabel(b) ? `<b class="shelf-label">${esc(bookLabel(b))}</b>` : ''}
                <span class="shelf-name">${esc(b.title)}</span>
                <span class="shelf-count">${icon('tests')}${b.test_count} тест${b.tests_done ? ` · ${b.tests_done} орындалды` : ''}</span>
              </span>
            </a>
          </li>`,
          )
          .join('')}
      </ul>
    </section>`;
}

/** The chosen book: a compact cover header with «Кітапты оқу», then all its tests. */
function bookPane(period, { book, tests }) {
  const readHref = `/books/${book.book_id}?from=${encodeURIComponent(bookHref(period.slug, book))}`;
  return `
    <header class="panel book-head">
      <a class="book-cover" href="${readHref}" data-link data-title="${esc(book.title)}" aria-label="${esc(book.title)}: оқу"><img src="${coverUrl(book)}" alt="" decoding="async" /></a>
      <div class="book-head-body">
        <h2>${esc(book.title)}</h2>
        <ul class="book-head-tags">
          ${book.grade ? `<li>${esc(gradeLabel(book.grade))}</li>` : ''}
          ${book.publisher ? `<li>${esc(book.publisher)}</li>` : ''}
          <li>${tests.length} тест</li>
        </ul>
        <div class="book-head-actions">
          <a class="btn btn-sm btn-dark" href="${readHref}" data-link>${icon('book')}Кітапты оқу</a>
        </div>
      </div>
    </header>
    ${tests.length ? `<div class="card-grid">${tests.map(testCard).join('')}</div>` : '<div class="panel empty"><p>Бұл кітапта әзірге тест жоқ.</p></div>'}`;
}

function topicList(period) {
  return `
    <ol class="topic-list">
      ${period.topics
        .map(
          (t, i) => `
        <li class="panel topic-row">
          <span class="topic-index" aria-hidden="true">${t.icon ? renderIcon(t.icon, null, 'icon topic-icon') : pad2(i + 1)}</span>
          <div>
            ${topicClassLabel(t) ? `<span class="topic-class">${esc(topicClassLabel(t))}</span>` : ''}
            <h2>${t.first_test_id ? `<a href="/tests/${t.first_test_id}" data-link>${esc(t.title)}</a>` : esc(t.title)}</h2>
            <p class="range">${esc(t.range_label)}</p>
            <p>${esc(t.summary)}</p>
            <div class="meta">
              <span>${icon('tests')}${t.question_count} сұрақ</span>
              ${t.best_percent !== null ? `<span>Үздік нәтиже ${scoreBadge(t.best_percent)}</span>` : ''}
            </div>
          </div>
          <div class="topic-actions">
            ${t.first_test_id ? `<a class="btn btn-sm" href="/tests/${t.first_test_id}" data-link>Тестті бастау</a>` : '<span class="range">Тест әлі жоқ</span>'}
          </div>
        </li>`,
        )
        .join('')}
    </ol>`;
}
