import { api } from '../api.js';
import { esc, pad2, scoreBadge } from '../util.js';
import { icon } from '../art.js';
import { periodCard, pageHead } from '../components.js';
import { site, renderIcon } from '../site.js';

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
    <ol class="topic-list">
      ${period.topics
        .map(
          (t, i) => `
        <li class="panel topic-row">
          <span class="topic-index" aria-hidden="true">${t.icon ? renderIcon(t.icon, null, 'icon topic-icon') : pad2(i + 1)}</span>
          <div>
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
