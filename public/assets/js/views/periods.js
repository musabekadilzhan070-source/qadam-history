import { api } from '../api.js';
import { esc, pad2, scoreBadge } from '../util.js';
import { icon } from '../art.js';
import { periodCard, pageHead } from '../components.js';

export async function periodsView(el, _params, _app, alive) {
  const { periods, totals } = await api.get('/api/overview');
  if (!alive()) return;
  el.innerHTML = `
    ${pageHead({
      eyebrow: 'Қазақстан тарихы',
      title: 'Тарихи кезеңдер',
      text: 'Кезеңді таңдап, оның тақырыптарын ретімен оқып, әр тақырып бойынша тест тапсыр.',
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
    <ol class="topic-list">
      ${period.topics
        .map(
          (t, i) => `
        <li class="panel topic-row">
          <span class="topic-index" aria-hidden="true">${pad2(i + 1)}</span>
          <div>
            <h2><a href="/topics/${encodeURIComponent(t.slug)}" data-link>${esc(t.title)}</a></h2>
            <p class="range">${esc(t.range_label)}</p>
            <p>${esc(t.summary)}</p>
            <div class="meta">
              <span>${icon('tests')}${t.question_count} сұрақ</span>
              ${t.best_percent !== null ? `<span>Үздік нәтиже ${scoreBadge(t.best_percent)}</span>` : ''}
            </div>
          </div>
          <div class="topic-actions">
            <a class="btn btn-dark btn-sm" href="/topics/${encodeURIComponent(t.slug)}" data-link>${icon('book')} Оқу</a>
            ${t.question_count ? `<a class="btn btn-sm" href="/topics/${encodeURIComponent(t.slug)}/test" data-link>Тест</a>` : ''}
          </div>
        </li>`,
        )
        .join('')}
    </ol>`;
}
