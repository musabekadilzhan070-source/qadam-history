import { api } from '../api.js';
import { esc } from '../util.js';
import { pageHead } from '../components.js';
import { gradeLabel } from '../catalog.js';
import { icon } from '../art.js';

// «Кітаптар»: textbook covers in a grid; a cover opens the book in the reader inside QADAM.

/** The official note on where the books come from, shown above the shelves. */
const NOTICE =
  'Бұл бөлімде ұсынылған кітаптар Қазақстан тарихы пәні бойынша ҰБТ спецификациясында қамтылған оқу әдебиеттеріне сәйкес жинақталған. Кітаптардың электрондық нұсқалары OKULYK.KZ платформасынан алынған.';

const coverUrl = (b) => `/api/files/${b.cover_id}?v=${b.cover_version}`;

const card = (b) => `
  <li class="book-card">
    <a href="/books/${b.id}" data-link aria-label="${esc(b.title)}: оқу">
      <span class="book-cover"><img src="${coverUrl(b)}" alt="" loading="lazy" decoding="async" /></span>
      <span class="book-info">
        <b>${esc(b.title)}</b>
        <span class="book-meta">${[gradeLabel(b.grade), b.publisher].filter(Boolean).map(esc).join(' · ') || esc(b.subject)}</span>
        ${b.last_page > 1 ? `<span class="book-progress">${b.last_page}-беттен жалғастыру</span>` : ''}
      </span>
    </a>
  </li>`;

/** The publishers that get their own section, in this order; other books follow under «Басқа кітаптар». */
const PUBLISHER_GROUPS = [
  { publisher: 'Атамұра', title: 'Атамұра баспасының кітаптары' },
  { publisher: 'Мектеп', title: 'Мектеп баспасының кітаптары' },
];
const samePublisher = (a, b) => String(a || '').trim().toLowerCase() === b.toLowerCase();

/** Books by publisher (Атамұра, then Мектеп, then the rest), each in the organizer's order. */
function groups(books) {
  const out = PUBLISHER_GROUPS.map((g) => ({ title: g.title, books: books.filter((b) => samePublisher(b.publisher, g.publisher)) }));
  const known = new Set(out.flatMap((g) => g.books));
  out.push({ title: 'Басқа кітаптар', books: books.filter((b) => !known.has(b)) });
  return out.filter((g) => g.books.length);
}

export async function booksView(el, _params, _app, alive) {
  const { books } = await api.get('/api/books');
  if (!alive()) return;
  el.innerHTML = `
    ${pageHead({ eyebrow: 'Оқулықтар', title: 'Кітаптар', text: 'Оқулықты ашып, осы сайттың ішінде оқыңыз. Соңғы оқыған бетіңіз сақталады.' })}
    <aside class="official-note" role="note">${icon('info', 'icon official-note-icon')}<p>${NOTICE}</p></aside>
    ${
      books.length
        ? groups(books)
            .map((g) => `<h2 class="book-group">${esc(g.title)}</h2><ul class="book-grid">${g.books.map(card).join('')}</ul>`)
            .join('')
        : '<div class="panel empty"><p>Әзірге кітап жарияланбаған. Организатор кітап қосқанда осы жерде көрінеді.</p></div>'
    }`;
  // A cover that fails to load becomes a plain title card instead of a broken image.
  el.querySelectorAll('.book-cover img').forEach((img) =>
    img.addEventListener('error', () => {
      const cover = img.parentElement;
      cover.classList.add('is-plain');
      cover.textContent = img.closest('a').querySelector('b').textContent;
    }),
  );
}
