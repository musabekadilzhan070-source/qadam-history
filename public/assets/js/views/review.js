import { esc, formatDuration } from '../util.js';
import { icon, ornamentBand } from '../art.js';
import { fileUrl } from '../site.js';

const LETTERS = ['А', 'Ә', 'Б', 'В', 'Г', 'Д'];
export const letter = (i) => LETTERS[i] || String(i + 1);

const verdict = (p) =>
  p >= 90 ? 'Керемет нәтиже!' : p >= 70 ? 'Жақсы нәтиже' : p >= 50 ? 'Жаман емес' : 'Тақырыпты қайталау керек';

export function resultHero(r, { topicSlug, topicTitle, testId = null, retry = true }) {
  const wrong = r.total - r.correct;
  return `
  <section class="result-hero" aria-labelledby="result-title">
    <div class="score" style="--p:${r.percent}" role="img" aria-label="Нәтиже ${r.percent}%">
      <div><b>${r.percent}%</b><span>нәтиже</span></div>
    </div>
    <div>
      <p class="eyebrow">${esc(topicTitle)}</p>
      <h1 id="result-title">${verdict(r.percent)}</h1>
      <ul class="result-counts">
        <li class="ok">${r.correct} дұрыс</li>
        <li class="bad">${wrong} қате</li>
        <li>${r.total} сұрақ</li>
        ${r.duration_sec ? `<li>${formatDuration(r.duration_sec)} уақыт</li>` : ''}
      </ul>
      <div class="banner-actions">
        ${retry && testId ? `<a class="btn" href="/tests/${testId}" data-link>Қайта тапсыру</a>` : ''}
        ${topicSlug ? `<a class="btn btn-ghost-light" href="/topics/${encodeURIComponent(topicSlug)}" data-link>Тақырыпқа оралу</a>` : ''}
      </div>
    </div>
    ${ornamentBand('band')}
  </section>`;
}

export function reviewList(items) {
  return `
  <div class="section-head"><div><p class="eyebrow">Тексеру</p><h2 class="section-title">Жауаптарды талдау</h2></div></div>
  <ol class="review">
    ${items
      .map((q, i) => {
        const ok = q.is_correct;
        return `
      <li class="panel review-item ${ok ? 'is-ok' : 'is-bad'}">
        <h3>${icon(ok ? 'check' : 'cross')}<span>${i + 1}. ${esc(q.text)}</span></h3>
        ${q.image_id ? `<img class="q-image" src="${fileUrl(q.image_id)}" alt="" loading="lazy" />` : ''}
        ${q.multiple ? '<p class="q-hint">Бірнеше дұрыс жауабы бар сұрақ</p>' : ''}
        <ul class="review-options">
          ${q.options
            .map((o, oi) => {
              const isRight = q.correct_option_ids.includes(o.id);
              const isChosen = q.chosen_option_ids.includes(o.id);
              const cls = isRight ? 'correct' : isChosen ? 'wrong' : '';
              const tag = isRight ? (isChosen ? 'Сіздің жауабыңыз · дұрыс' : 'Дұрыс жауап') : isChosen ? 'Сіздің жауабыңыз' : '';
              const img = o.image_id ? `<img class="option-image" src="${fileUrl(o.image_id)}" alt="" loading="lazy" />` : '';
              return `<li class="${cls}"><span>${letter(oi)}. ${img}${esc(o.text)}</span>${tag ? `<small>${tag}</small>` : ''}</li>`;
            })
            .join('')}
        </ul>
        ${!q.chosen_option_ids.length ? '<p class="explain"><b>Жауап берілмеді.</b></p>' : ''}
        ${q.explanation ? `<p class="explain"><b>Түсініктеме:</b> ${esc(q.explanation)}</p>` : ''}
      </li>`;
      })
      .join('')}
  </ol>`;
}
