import { api } from '../api.js';
import { esc, pad2, scoreBadge, formatDate, formatDuration } from '../util.js';
import { icon } from '../art.js';
import { pageHead } from '../components.js';
import { resultHero, reviewList } from './review.js';

export async function resultsView(el, _params, app, alive) {
  const { summary, attempts } = await api.get('/api/results');
  if (!alive()) return;
  el.innerHTML = `
    ${pageHead({
      eyebrow: app.user.display_name,
      title: 'Менің нәтижелерім',
      text: 'Тапсырған тесттеріңіздің тарихы. Кез келген нәтижені ашып, жауаптарыңызды қайта қарай аласыз.',
    })}
    <div class="summary-grid">
      <div class="panel"><b>${summary.average_percent ?? '—'}${summary.average_percent !== null ? '%' : ''}</b><span>Орташа нәтиже</span></div>
      <div class="panel"><b>${summary.tests_done}</b><span>Тапсырылған тест</span></div>
      <div class="panel"><b>${summary.attempts}</b><span>Барлық әрекет</span></div>
      <div class="panel"><b>${summary.correct}/${summary.answered}</b><span>Дұрыс жауап</span></div>
    </div>
    ${
      attempts.length
        ? `<div class="panel" style="overflow:hidden">
            <table class="results-table">
              <thead><tr><th>Тақырып</th><th>Күні</th><th>Уақыт</th><th>Нәтиже</th><th></th></tr></thead>
              <tbody>
                ${attempts
                  .map(
                    (a) => `<tr>
                      <td><a href="/results/${a.id}" data-link>${esc(a.topic_title)}</a><span class="sub">${pad2(a.period_number)} · ${esc(a.period_title)}</span></td>
                      <td data-label="Күні">${esc(formatDate(a.created_at))}</td>
                      <td data-label="Уақыт" class="num">${formatDuration(a.duration_sec)}</td>
                      <td><span class="num">${a.correct}/${a.total}</span> ${scoreBadge(a.percent)}</td>
                      <td><a class="link-more" href="/results/${a.id}" data-link>Талдау ${icon('arrow')}</a></td>
                    </tr>`,
                  )
                  .join('')}
              </tbody>
            </table>
          </div>`
        : `<div class="panel empty"><p>Әзірге бірде-бір тест тапсырылмаған.</p><a class="btn" href="/tests" data-link>Тесттерге өту</a></div>`
    }`;
}

export async function attemptView(el, [id], app, alive) {
  const a = await api.get(`/api/results/${encodeURIComponent(id)}`);
  if (!alive()) return;
  app.setTitle(`Нәтиже: ${a.topic_title}`);
  el.innerHTML = `
    <div class="quiz">
      <ol class="breadcrumb"><li><a href="/results" data-link>Менің нәтижелерім</a></li><li aria-current="page">${esc(formatDate(a.created_at))}</li></ol>
      ${resultHero(a, { topicSlug: a.topic_slug, topicTitle: a.test_title && a.test_title !== a.topic_title ? `${a.topic_title} · ${a.test_title}` : a.topic_title, testId: a.test_id })}
      ${reviewList(a.items)}
    </div>`;
}
