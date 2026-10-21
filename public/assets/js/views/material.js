import { api } from '../api.js';
import { esc, renderProse } from '../util.js';
import { icon } from '../art.js';
import { fileUrl } from '../site.js';

/** One extra material the organizer added: text, an image and/or a PDF. */
export async function materialView(el, [id], app, alive) {
  const m = await api.get(`/api/materials/${encodeURIComponent(id)}`);
  if (!alive()) return;
  app.setTitle(m.title);
  el.innerHTML = `
    <ol class="breadcrumb">
      <li><a href="/materials" data-link>Материалдар</a></li>
      ${m.topic ? `<li><a href="/topics/${encodeURIComponent(m.topic.slug)}" data-link>${esc(m.topic.title)}</a></li>` : ''}
      <li aria-current="page">${esc(m.title)}</li>
    </ol>
    <article class="panel article">
      <header class="article-head">
        <p class="eyebrow">${m.topic ? esc(m.topic.title) : 'Материал'}</p>
        <h1>${esc(m.title)}</h1>
        ${m.body ? `<div class="meta"><span>${icon('clock')}${m.read_minutes} мин оқу</span></div>` : ''}
      </header>
      ${m.image_id ? `<img class="topic-photo" src="${fileUrl(m.image_id)}" alt="${esc(m.title)}" />` : ''}
      ${m.body ? `<div class="prose">${renderProse(m.body)}</div>` : ''}
      ${
        m.pdf_id
          ? `<div class="notice"><span>${icon('book')} PDF құжат</span><a class="btn btn-sm" href="${fileUrl(m.pdf_id)}" target="_blank" rel="noopener">PDF ашу</a></div>`
          : ''
      }
    </article>`;
}
