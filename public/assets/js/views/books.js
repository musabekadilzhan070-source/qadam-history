import { api } from '../api.js';
import { esc } from '../util.js';
import { pageHead } from '../components.js';
import { gradeLabel } from '../catalog.js';

// «Кітаптар»: textbook covers in a grid; a cover opens the book in the reader inside QADAM.

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

/** Books grouped by the organizer's category, in their order; no categories → one plain grid. */
function groups(books) {
  const out = [];
  for (const b of books) {
    const title = b.category || '';
    let g = out.find((x) => x.title === title);
    if (!g) out.push((g = { title, books: [] }));
    g.books.push(b);
  }
  if (out.length > 1) for (const g of out) if (!g.title) g.title = 'Басқа кітаптар';
  return out;
}

export async function booksView(el, _params, _app, alive) {
  const { books } = await api.get('/api/books');
  if (!alive()) return;
  el.innerHTML = `
    ${pageHead({ eyebrow: 'Оқулықтар', title: 'Кітаптар', text: 'Оқулықты ашып, осы сайттың ішінде оқыңыз. Соңғы оқыған бетіңіз сақталады.' })}
    ${
      books.length
        ? groups(books)
            .map((g) => `${g.title ? `<h2 class="book-group">${esc(g.title)}</h2>` : ''}<ul class="book-grid">${g.books.map(card).join('')}</ul>`)
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
