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

export async function periodView(el, [slug], app, alive) {
  const period = await api.get(`/api/periods/${encodeURIComponent(slug)}`);
  if (!alive()) return;
  app.setTitle(period.title);
  el.innerHTML = `
    <ol class="breadcrumb"><li><a href="/periods" data-link>Тарихи кезеңдер</a></li><li aria-current="page">${esc(period.title)}</li></ol>
    ${pageHead({
      eyebrow: period.range_label,
      title: period.title,
      text: period.summary,
      number: period.number,
      extra: `<ul class="head-stats"><li><b>${period.topic_count}</b>тақырып</li><li><b>${period.test_count}</b>тест</li><li><b>${period.question_count}</b>сұрақ</li></ul>`,
    })}
    ${period.books?.length ? shelfChooser(period) : topicList(period)}`;
  wireCovers(el);
}

const coverUrl = (b) => `/api/files/${b.cover_id}?v=${b.cover_version}`;
/** «8-сынып | Атамұра», or whichever half the book has. */
const bookLabel = (b) => [gradeLabel(b.grade), b.publisher].filter(Boolean).join(' | ');
const bookHref = (slug, b) => `/periods/${encodeURIComponent(slug)}/books/${b.id}`;

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

/** The books the organizer put on this period: the student picks one, then sees its tests. */
function shelfChooser(period) {
  return `
    <section class="shelf" aria-labelledby="shelf-title">
      <h2 class="shelf-title" id="shelf-title">Кітапты таңдаңыз</h2>
      <p class="shelf-text">Осы кезеңнің тесттері оқулық бойынша топталған. Өз оқулығыңызды таңдаңыз.</p>
      <ul class="shelf-grid">
        ${period.books
          .map(
            (b) => `
          <li class="shelf-card">
            <a href="${bookHref(period.slug, b)}" data-link>
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

/** One book of a period: a compact cover header, then the tests the organizer chose for it. */
export async function periodBookView(el, [slug, entry], app, alive) {
  const page = await api.get(`/api/periods/${encodeURIComponent(slug)}/books/${entry}`);
  if (!alive()) return;
  const { period, book, tests, other_books: others } = page;
  app.setTitle(`${book.title} · ${period.title}`);
  const periodHref = `/periods/${encodeURIComponent(period.slug)}`;
  el.innerHTML = `
    <ol class="breadcrumb">
      <li><a href="/periods" data-link>Тарихи кезеңдер</a></li>
      <li><a href="${periodHref}" data-link>${esc(period.title)}</a></li>
      <li aria-current="page">${esc(bookLabel(book) || book.title)}</li>
    </ol>
    <header class="panel book-head">
      <a class="book-cover" href="/books/${book.book_id}" data-link data-title="${esc(book.title)}" aria-label="${esc(book.title)}: оқу"><img src="${coverUrl(book)}" alt="" decoding="async" /></a>
      <div class="book-head-body">
        <p class="eyebrow">${pad2(period.number)} · ${esc(period.title)}</p>
        <h1>${esc(book.title)}</h1>
        <ul class="book-head-tags">
          ${book.grade ? `<li>${esc(gradeLabel(book.grade))}</li>` : ''}
          ${book.publisher ? `<li>${esc(book.publisher)}</li>` : ''}
          <li>${tests.length} тест</li>
        </ul>
        <div class="book-head-actions">
          <a class="btn btn-sm btn-dark" href="/books/${book.book_id}" data-link>${icon('book')}Кітапты оқу</a>
          ${others.length ? `<a class="btn btn-sm btn-ghost" href="${periodHref}" data-link>Басқа кітапты таңдау</a>` : ''}
        </div>
      </div>
    </header>
    <div class="card-grid">${tests.map(testCard).join('')}</div>`;
  wireCovers(el);
}
