import { api } from '../api.js';
import { esc, pad2, scoreBadge, formatDate, formatDuration } from '../util.js';
import { icon } from '../art.js';
import { pageHead } from '../components.js';
import { resultHero, reviewList } from './review.js';
import { quizTitle } from './quizgame.js';

export async function resultsView(el, _params, app, alive) {
  const [{ summary, attempts }, quiz] = await Promise.all([api.get('/api/results'), api.get('/api/quiz-results')]);
  if (!alive()) return;
  el.innerHTML = `
    ${pageHead({
      eyebrow: app.user.display_name,
      title: 'Менің нәтижелерім',
      text: 'Тапсырған тесттеріңіздің тарихы. Кез келген нәтижені ашып, жауаптарыңызды қайта қарай аласыз.',
    })}
    <div class="notice report-cta"><span><b>Кураторға есеп беру.</b> Тесттер мен нәтижелер, аяқталмаған тесттер, кітаптар және сайтта өткізген уақыт бір суретте (PNG, JPG, PDF).</span>
      <a class="btn btn-sm" href="/report" data-link>Кураторға есеп беру</a></div>
    <div class="summary-grid">
      <div class="panel"><b>${summary.average_percent ?? '—'}${summary.average_percent !== null ? '%' : ''}</b><span>Орташа нәтиже</span></div>
      <div class="panel"><b>${summary.tests_done}</b><span>Тапсырылған тест</span></div>
      <div class="panel"><b>${summary.attempts}</b><span>Барлық әрекет</span></div>
      <div class="panel"><b>${summary.correct}/${summary.answered}</b><span>Дұрыс жауап</span></div>
      <div class="panel"><b>${summary.reworks}</b><span>Қателермен жұмыс${summary.reworks ? ` · ${summary.rework_correct}/${summary.rework_answered} түзетілді` : ''}</span></div>
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
                      <td><a href="/results/${a.id}" data-link>${esc(a.topic_title)}</a><span class="sub">${a.kind === 'rework' ? '<span class="kind-tag">Қателермен жұмыс</span> ' : ''}${pad2(a.period_number)} · ${esc(a.period_title)}</span></td>
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
    }
    ${quizResults(quiz)}`;
}

/** Quiz results: kept apart from the classic tests (a quiz always ends at 100%). */
function quizResults({ summary, runs }) {
  return `
    <section class="quiz-results" aria-labelledby="qr-title">
      <h2 id="qr-title" class="section-title">${icon('quiz')} Quiz нәтижелері</h2>
      <div class="summary-grid">
        <div class="panel"><b>${summary.finished}</b><span>Аяқталған Quiz</span></div>
        <div class="panel"><b>${summary.in_progress}</b><span>Жалғасып жатқан</span></div>
        <div class="panel"><b>${summary.first_correct}/${summary.questions}</b><span>Бірден дұрыс</span></div>
        <div class="panel"><b>${summary.wrong_answers}</b><span>Қате жауап</span></div>
      </div>
      ${
        runs.length
          ? `<div class="panel" style="overflow:hidden">
              <table class="results-table">
                <thead><tr><th>Quiz</th><th>Басталды</th><th>Аяқталды</th><th>Бірден дұрыс</th><th>Қайталанды</th><th>Қате</th><th>Уақыт</th><th>Нәтиже</th></tr></thead>
                <tbody>
                  ${runs
                    .map(
                      (r) => `<tr>
                        <td><a href="/quiz/${r.test_id}" data-link>${esc(quizTitle(r.title))}</a><span class="sub">${r.total} сұрақ</span></td>
                        <td data-label="Басталды">${esc(formatDate(r.started_at))}</td>
                        <td data-label="Аяқталды">${r.finished ? esc(formatDate(r.finished_at)) : '<span class="kind-tag">Жалғасуда</span>'}</td>
                        <td data-label="Бірден дұрыс" class="num">${r.first_correct}/${r.total}</td>
                        <td data-label="Қайталанды" class="num">${r.repeated}</td>
                        <td data-label="Қате" class="num">${r.wrong_answers}</td>
                        <td data-label="Уақыт" class="num">${formatDuration(r.duration_sec)}</td>
                        <td>${r.finished ? scoreBadge(100) : `<span class="num">${r.done}/${r.total}</span> <a class="link-more" href="/quiz/${r.test_id}" data-link>Жалғастыру ${icon('arrow')}</a>`}</td>
                      </tr>`,
                    )
                    .join('')}
                </tbody>
              </table>
            </div>`
          : '<div class="panel empty"><p>Әзірге Quiz ойнамадыңыз. Кезең бетінде «Quiz» форматын таңдаңыз.</p><a class="btn" href="/periods" data-link>Кезеңдерге өту</a></div>'
      }
    </section>`;
}

export async function attemptView(el, [id], app, alive) {
  const a = await api.get(`/api/results/${encodeURIComponent(id)}`);
  if (!alive()) return;
  app.setTitle(`Нәтиже: ${a.topic_title}`);
  el.innerHTML = `
    <div class="quiz">
      <ol class="breadcrumb"><li><a href="/results" data-link>Менің нәтижелерім</a></li><li aria-current="page">${esc(formatDate(a.created_at))}</li></ol>
      ${resultHero(a, {
        topicSlug: a.topic_slug,
        topicTitle: `${a.kind === 'rework' ? 'Қателермен жұмыс · ' : ''}${a.test_title && a.test_title !== a.topic_title ? `${a.topic_title} · ${a.test_title}` : a.topic_title}`,
        testId: a.test_id,
        attemptId: a.id,
        canRework: a.can_rework,
        extra: a.kind === 'rework' && a.parent_id ? `<p class="rework-compare"><a href="/results/${a.parent_id}" data-link>Бастапқы нәтижені ашу</a></p>` : '',
      })}
      ${
        a.reworks.length
          ? `<section class="panel rework-history" aria-labelledby="rw-title">
              <h2 id="rw-title">Қателермен жұмыс тарихы</h2>
              <ul class="mini-list">
                ${a.reworks
                  .map(
                    (w, i) => `<li><a href="/results/${w.id}" data-link>
                      <span class="mini-num">${i + 1}</span>
                      <span class="mini-body"><b>${w.correct} / ${w.total} қате түзетілді</b><span>${esc(formatDate(w.created_at))}</span></span>
                      ${scoreBadge(w.percent)}</a></li>`,
                  )
                  .join('')}
              </ul>
            </section>`
          : ''
      }
      ${reviewList(a.items)}
    </div>`;
}
