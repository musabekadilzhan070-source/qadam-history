import { esc, formatDuration } from '../util.js';
import { icon, ornamentBand } from '../art.js';
import { fileUrl } from '../site.js';
import { letter } from '../quiz-player.js';

export { letter };

const verdict = (p) =>
  p >= 90 ? 'Керемет нәтиже!' : p >= 70 ? 'Жақсы нәтиже' : p >= 50 ? 'Жаман емес' : 'Тақырыпты қайталау керек';

const num = (n) => String(Math.round(Number(n) * 100) / 100).replace('.', ',');

export function resultHero(r, { topicSlug, topicTitle, testId = null, retry = true }) {
  const wrong = r.total - r.correct;
  const passed = r.pass_percent !== undefined && r.passed !== undefined;
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
        ${r.max_score ? `<li>${num(r.score)} / ${num(r.max_score)} ұпай</li>` : ''}
        ${r.duration_sec ? `<li>${formatDuration(r.duration_sec)} уақыт</li>` : ''}
        ${passed ? `<li class="${r.passed ? 'ok' : 'bad'}">${r.passed ? 'Өтті' : 'Өтпеді'} (шегі ${r.pass_percent}%)</li>` : ''}
      </ul>
      <div class="banner-actions">
        ${retry && testId ? `<a class="btn" href="/tests/${testId}" data-link data-reload>Қайта тапсыру</a>` : ''}
        ${topicSlug ? `<a class="btn btn-ghost-light" href="/topics/${encodeURIComponent(topicSlug)}" data-link>Тақырыпқа оралу</a>` : ''}
      </div>
    </div>
    ${ornamentBand('band')}
  </section>`;
}

function choiceReview(q) {
  const right = q.correct_option_ids || [];
  return `
    <ul class="review-options">
      ${q.options
        .map((o, oi) => {
          const isRight = right.includes(o.id);
          const isChosen = q.chosen_option_ids.includes(o.id);
          const cls = isRight ? 'correct' : isChosen ? (q.answers_hidden ? (q.is_correct ? 'correct' : 'wrong') : 'wrong') : '';
          const tag = isRight ? (isChosen ? 'Сіздің жауабыңыз · дұрыс' : 'Дұрыс жауап') : isChosen ? 'Сіздің жауабыңыз' : '';
          const img = o.image_id ? `<img class="option-image" src="${fileUrl(o.image_id)}" alt="" loading="lazy" />` : '';
          return `<li class="${cls}"><span>${letter(oi)}. ${img}${esc(o.text)}</span>${tag ? `<small>${tag}</small>` : ''}</li>`;
        })
        .join('')}
    </ul>`;
}

function matchingReview(q) {
  return `
    <ul class="review-pairs">
      ${q.pairs
        .map(
          (p) => `<li class="${p.ok ? 'correct' : 'wrong'}">
            <span class="pair-left">${esc(p.left)}</span>
            <span class="pair-arrow" aria-hidden="true">→</span>
            <span class="pair-right">${p.chosen ? esc(p.chosen) : '<em>таңдалмаған</em>'}${!p.ok && p.right ? `<small>Дұрысы: ${esc(p.right)}</small>` : ''}</span>
          </li>`,
        )
        .join('')}
    </ul>`;
}

function orderingReview(q) {
  const item = (x, i) => `<li><b>${i + 1}</b><span>${esc(x.text)}${x.date ? ` <small>(${esc(x.date)})</small>` : ''}</span></li>`;
  const correctKeys = (q.correct_order || []).map((x) => x.text);
  return `
    <div class="review-orders">
      <div><h4>Сіздің ретіңіз</h4><ol class="review-order">${
        q.chosen_order.length
          ? q.chosen_order
              .map((x, i) => item({ ...x, date: q.correct_order ? x.date : '' }, i).replace('<li>', `<li class="${correctKeys.length ? (correctKeys[i] === x.text ? 'correct' : 'wrong') : ''}">`))
              .join('')
          : '<li><span>Жауап берілмеді.</span></li>'
      }</ol></div>
      ${q.correct_order ? `<div><h4>Дұрыс рет</h4><ol class="review-order is-key">${q.correct_order.map(item).join('')}</ol></div>` : ''}
    </div>`;
}

function openReview(q) {
  return `
    <ul class="review-options">
      <li class="${q.is_correct ? 'correct' : 'wrong'}"><span>${q.answer ? esc(q.answer) : '<em>Жауап берілмеді</em>'}</span><small>Сіздің жауабыңыз</small></li>
      ${!q.is_correct && q.accepted?.length ? `<li class="correct"><span>${q.accepted.map(esc).join(' / ')}</span><small>Дұрыс жауап</small></li>` : ''}
    </ul>`;
}

export function reviewList(items) {
  let lastContext = null;
  return `
  <div class="section-head"><div><p class="eyebrow">Тексеру</p><h2 class="section-title">Жауаптарды талдау</h2></div></div>
  <ol class="review">
    ${items
      .map((q, i) => {
        const ok = q.is_correct;
        // A context is shown once, above its first question.
        const ctx = q.context && q.context.id !== lastContext ? q.context : null;
        lastContext = q.context ? q.context.id : null;
        const body =
          q.type === 'matching' ? matchingReview(q) : q.type === 'ordering' ? orderingReview(q) : q.type === 'open' ? openReview(q) : choiceReview(q);
        return `
      ${
        ctx
          ? `<li class="panel context-box review-context"><p class="eyebrow">Контекст</p>${ctx.title ? `<h3>${esc(ctx.title)}</h3>` : ''}
              ${ctx.image_id ? `<img class="q-image" src="${fileUrl(ctx.image_id)}" alt="" loading="lazy" />` : ''}
              ${ctx.body ? `<div class="context-text">${esc(ctx.body).replace(/\n/g, '<br />')}</div>` : ''}</li>`
          : ''
      }
      <li class="panel review-item ${ok ? 'is-ok' : 'is-bad'}">
        <h3>${icon(ok ? 'check' : 'cross')}<span>${i + 1}. ${esc(q.text)}</span><em class="review-points">${num(q.earned)} / ${num(q.points)} ұпай</em></h3>
        ${q.image_id ? `<img class="q-image" src="${fileUrl(q.image_id)}" alt="" loading="lazy" />` : ''}
        ${q.multiple ? '<p class="q-hint">Бірнеше дұрыс жауабы бар сұрақ</p>' : ''}
        ${body}
        ${!q.answered ? '<p class="explain"><b>Жауап берілмеді.</b></p>' : ''}
        ${q.explanation ? `<p class="explain"><b>Түсініктеме:</b> ${esc(q.explanation)}</p>` : ''}
        ${q.answers_hidden ? '<p class="explain">Дұрыс жауаптарды организатор жасырған.</p>' : ''}
      </li>`;
      })
      .join('')}
  </ol>`;
}
