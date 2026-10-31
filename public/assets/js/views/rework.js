import { api } from '../api.js';
import { esc, formatDate } from '../util.js';
import { icon } from '../art.js';
import { runQuiz } from './quiz.js';
import { resultHero, reviewList } from './review.js';

// «Қателермен қайта жұмыс істеу»: the questions answered wrongly in one attempt, in their own formats.
// The answers are saved as a separate rework attempt; the original result does not change.

export async function reworkView(el, [id], app, alive) {
  let first;
  try {
    first = await api.get(`/api/results/${encodeURIComponent(id)}/rework`);
  } catch (err) {
    if (!alive()) return;
    el.innerHTML = `
      <div class="quiz">
        <ol class="breadcrumb"><li><a href="/results" data-link>Менің нәтижелерім</a></li><li><a href="/results/${esc(id)}" data-link>Нәтиже</a></li><li aria-current="page">Қателермен жұмыс</li></ol>
        <div class="panel empty"><p>${esc(err.message)}</p><a class="btn btn-dark btn-sm" href="/results/${esc(id)}" data-link>Нәтижеге оралу</a></div>
      </div>`;
    return;
  }
  if (!alive()) return;
  const { topic, title, original } = first;
  const heading = title && title !== topic.title ? title : topic.title;
  app.setTitle(`Қателермен жұмыс: ${heading}`);
  const quiz = runQuiz(el, {
    app,
    heading: `Қателермен жұмыс: ${heading}`,
    crumbs: `<ol class="breadcrumb">
        <li><a href="/results" data-link>Менің нәтижелерім</a></li>
        <li><a href="/results/${first.rework_of}" data-link>${esc(topic.title)}</a></li>
        <li aria-current="page">Қателермен жұмыс</li>
      </ol>
      <div class="notice"><span>Мұнда тек қате жауап берілген ${first.question_count} сұрақ берілді. Бастапқы нәтиже (${original.percent}%) өзгермейді, жаңа нәтиже бөлек сақталады.</span></div>`,
    load: async () => first,
    submit: (answers, paper) => api.post(`/api/results/${encodeURIComponent(id)}/rework`, { answers, token: paper.token }),
    onResult: (r) => {
      if (!alive()) return;
      el.innerHTML = `
        <div class="quiz">
          ${resultHero(r, {
            topicSlug: topic.slug,
            topicTitle: `Қателермен жұмыс · ${heading}`,
            testId: r.test.id,
            attemptId: r.attempt_id,
            title: r.correct === r.total ? 'Барлық қате түзетілді!' : `${r.correct} / ${r.total} қате түзетілді`,
            extra: `<p class="rework-compare">Бастапқы нәтиже: ${original.percent}% (${original.correct}/${original.total}) · ${esc(formatDate(original.created_at || ''))}</p>`,
          })}
          ${r.saved ? `<div class="notice"><span>Қателермен жұмыс нәтижесі бөлек сақталды.</span><a class="link-more" href="/results" data-link>Менің нәтижелерім ${icon('arrow')}</a></div>` : ''}
          ${reviewList(r.items)}
        </div>`;
    },
  });
  await quiz.start();
  return () => quiz.stop();
}
