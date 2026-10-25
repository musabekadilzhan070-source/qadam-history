import { esc, pad2, scoreBadge } from './util.js';
import { icon, ornamentBand, ROMAN } from './art.js';
import { site, renderIcon, fileUrl } from './site.js';

/** Period card in the original QADAM style: dark field, red line art, big number, red button. */
export function periodCard(p) {
  const href = `/periods/${encodeURIComponent(p.slug)}`;
  const done =
    p.tests_done !== null && p.tests_done !== undefined && p.test_count
      ? `<li class="done">${p.tests_done}/${p.test_count} тест орындалды</li>`
      : '';
  return `
  <article class="period-card">
    <span class="roman" aria-hidden="true">${ROMAN[p.number] || ''}</span>
    ${site.emblem(p.number)}
    <span class="num" aria-hidden="true">${pad2(p.number)}</span>
    <p class="range">${esc(p.range_label)}</p>
    <h3><a href="${href}" data-link>${esc(p.title)}</a></h3>
    <span class="bar" aria-hidden="true"></span>
    <p class="desc">${esc(p.summary)}</p>
    <ul class="stats">
      <li><b>${p.topic_count}</b>тақырып</li>
      <li><b>${p.test_count}</b>тест</li>
      <li><b>${p.question_count}</b>сұрақ</li>
      ${done}
    </ul>
    <a class="btn" href="${href}" data-link tabindex="-1" aria-hidden="true">${site.t('period_button')} ${icon('arrow', 'icon icon-arrow')}</a>
  </article>`;
}

export function pageHead({ eyebrow, title, text = '', number = null, extra = '' }) {
  return `
  <header class="page-head">
    ${number ? site.emblem(number) + `<span class="num" aria-hidden="true">${pad2(number)}</span>` : ''}
    ${eyebrow ? `<p class="eyebrow">${esc(eyebrow)}</p>` : ''}
    <h1>${esc(title)}</h1>
    ${text ? `<p>${esc(text)}</p>` : ''}
    ${extra}
    ${ornamentBand('band')}
  </header>`;
}

export function periodChips(periods, active) {
  return `
  <div class="chips" role="group" aria-label="Кезең бойынша сүзу">
    <button type="button" class="chip chip-all" data-period="" aria-pressed="${!active}">Барлығы</button>
    ${periods
      .map(
        (p) => `<button type="button" class="chip" data-period="${esc(p.slug)}" aria-pressed="${active === p.slug}">
          <span class="chip-num">${pad2(p.number)}</span>${esc(p.title)}</button>`,
      )
      .join('')}
  </div>`;
}

export const loading = () => '<div class="loading">Жүктелуде…</div>';

export const errorBox = (message) => `<div class="panel error-box"><p>${esc(message)}</p><a class="btn btn-dark btn-sm" href="/" data-link>Басты бетке</a></div>`;

/** A published test: topic emblem, description, size and time, and the student's best result. */
export function testCard(t) {
  return `
    <article class="panel test-card">
      ${t.cover_image_id ? `<img class="test-cover" src="${fileUrl(t.cover_image_id)}" alt="" loading="lazy" />` : ''}
      <div class="top">
        <span class="period-tag">${t.topic_icon ? renderIcon(t.topic_icon, null, 'icon test-emblem') : ''}<i>${pad2(t.period_number)}</i>${esc(t.period_title)}</span>
        ${t.best_percent !== null ? scoreBadge(t.best_percent) : ''}
      </div>
      <h3>${esc(t.title)}</h3>
      ${t.title !== t.topic_title ? `<p class="range">${esc(t.topic_title)}</p>` : ''}
      <p>${esc(t.description || t.summary)}</p>
      <div class="meta">
        <span>${icon('tests')}${t.question_count} сұрақ</span>
        ${t.time_limit_min ? `<span>${icon('clock')}${t.time_limit_min} мин</span>` : ''}
        ${t.attempts ? `<span>${t.attempts} рет тапсырылды</span>` : '<span>Әлі тапсырылмаған</span>'}
      </div>
      <div class="actions">
        <a class="btn btn-sm" href="/tests/${t.id}" data-link>${t.attempts ? 'Қайта тапсыру' : 'Тестті бастау'}</a>
      </div>
    </article>`;
}
