import { api } from '../api.js';
import { esc, formatDuration } from '../util.js';
import { icon } from '../art.js';
import { resultHero, reviewList } from './review.js';
import { bookBox } from '../catalog.js';
import { unitHtml, bindUnit, unitQuestions, initialAnswers, isAnswered } from '../quiz-player.js';

/** Old /topics/:slug/test links open the topic's first test. */
export async function legacyQuizView(_el, [slug], app, alive) {
  const { test_id: id } = await api.get(`/api/topics/${encodeURIComponent(slug)}/test`);
  if (alive()) app.navigate(`/tests/${id}`, { replace: true });
}

/**
 * Runs a test. `load()` starts it (questions + session), `submit(answers, paper)` grades it.
 * Shared by the student page and the organizer preview (which passes its own load/submit).
 */
export function runQuiz(el, { load, submit, heading, crumbs = '', onResult, app = null }) {
  let paper = null;
  let answers = {};
  let touched = new Set();
  let page = 0;
  let finished = false;
  let submitting = false;
  let tick = null;
  let startedAt = 0;
  let pageStartedAt = 0;
  let maxPage = 0; // with a per-question timer the student cannot go back to a timed-out page

  const questions = () => paper.units.flatMap(unitQuestions);
  const total = () => questions().length;
  const doneCount = () => questions().filter((q) => isAnswered(q, answers, touched)).length;
  const firstNumber = (i) => paper.units.slice(0, i).reduce((n, u) => n + unitQuestions(u).length, 0) + 1;
  const elapsed = () => Math.round((Date.now() - startedAt) / 1000);
  const pageLimit = () => (paper.question_time_sec ? paper.question_time_sec * unitQuestions(paper.units[page]).length : 0);

  const onUnload = (e) => {
    if (!finished && doneCount()) e.preventDefault();
  };
  if (app) {
    app.guard = () => finished || !doneCount() || confirm('Тест аяқталмады. Жауаптарыңыз сақталмайды. Шығасыз ба?');
    window.addEventListener('beforeunload', onUnload);
  }

  function timerText() {
    if (paper.time_limit_sec) return formatDuration(Math.max(0, paper.time_limit_sec - elapsed()));
    return formatDuration(elapsed());
  }

  function updateProgress() {
    const done = doneCount();
    el.querySelector('.quiz-progress span').textContent = `${done} / ${total()} жауап`;
    el.querySelector('.quiz-progress i').style.width = `${Math.round((done / total()) * 100)}%`;
    paper.units.forEach((u, i) => {
      const all = unitQuestions(u).every((q) => isAnswered(q, answers, touched));
      el.querySelector(`.dot[data-i="${i}"]`)?.classList.toggle('answered', all);
    });
  }

  function renderPage() {
    const unit = paper.units[page];
    const last = page === paper.units.length - 1;
    const locked = Boolean(paper.question_time_sec);
    pageStartedAt = Date.now();
    el.innerHTML = `
    <div class="quiz">
      ${crumbs}
      <div class="quiz-head">
        <h1>${esc(heading)}</h1>
        <span class="quiz-timer${paper.time_limit_sec ? ' is-countdown' : ''}" aria-label="${paper.time_limit_sec ? 'Қалған уақыт' : 'Өткен уақыт'}">${icon('clock')}<span id="timer">${timerText()}</span></span>
      </div>
      ${paper.book ? bookBox(paper.book) : ''}
      <div class="quiz-progress">
        <span></span>
        <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${total()}"><i></i></div>
      </div>
      <form class="panel question-card" id="q-form" novalidate>
        ${locked ? `<p class="q-countdown" aria-live="off">Бұл бетке уақыт: <b id="page-timer">${formatDuration(pageLimit())}</b></p>` : ''}
        ${unitHtml(unit, answers, firstNumber(page), total())}
        <div class="quiz-nav">
          <button type="button" class="btn btn-ghost btn-sm" id="prev" ${page === 0 || locked ? 'disabled' : ''}>${icon('back')} Алдыңғы</button>
          ${
            last
              ? `<button type="submit" class="btn" id="finish">Жауаптарды тексеру</button>`
              : `<button type="submit" class="btn btn-dark" id="next">Келесі ${icon('arrow', 'icon icon-arrow')}</button>`
          }
        </div>
      </form>
      <nav class="dots" aria-label="Сұрақтар">
        ${paper.units
          .map((u, i) => {
            const n = firstNumber(i);
            const label = u.type === 'context' ? `${n}–${n + u.children.length - 1}` : String(n);
            return `<button type="button" class="dot${u.type === 'context' ? ' dot-wide' : ''}" data-i="${i}" ${i === page ? 'aria-current="step"' : ''} ${locked && i !== page ? 'disabled' : ''} aria-label="${label}-сұрақ">${label}</button>`;
          })
          .join('')}
      </nav>
      <p class="quiz-note">${locked ? 'Әр сұраққа уақыт берілген: уақыт біткенде келесі сұраққа өтесіз.' : 'Жауапты кейін өзгертуге болады. Тексеру соңында жүреді.'}</p>
    </div>`;
    const form = el.querySelector('#q-form');
    bindUnit(form, unit, answers, touched, updateProgress);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (last) finish();
      else go(page + 1);
    });
    el.querySelector('#prev').addEventListener('click', () => go(page - 1));
    el.querySelectorAll('.dot').forEach((d) => d.addEventListener('click', () => go(Number(d.dataset.i))));
    updateProgress();
  }

  function go(i) {
    if (paper.question_time_sec && i < maxPage) return;
    page = Math.max(0, Math.min(paper.units.length - 1, i));
    maxPage = Math.max(maxPage, page);
    renderPage();
    window.scrollTo(0, 0);
    el.querySelector('#q-form input, #q-form select, #q-form button')?.focus({ preventScroll: true });
  }

  async function finish({ auto = false } = {}) {
    if (submitting || finished) return;
    const missing = total() - doneCount();
    if (!auto && missing && !confirm(`${missing} сұраққа жауап берілмеді. Тексеруге жібересіз бе?`)) return;
    submitting = true;
    const btn = el.querySelector('#finish');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Тексерілуде…';
    }
    try {
      const r = await submit(answers, paper);
      finished = true;
      clearInterval(tick);
      onResult(r, { duration: elapsed(), auto });
      window.scrollTo(0, 0);
    } catch (err) {
      submitting = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Жауаптарды тексеру';
      }
      alert(err.message);
    }
  }

  function onTick() {
    const t = el.querySelector('#timer');
    if (t) t.textContent = timerText();
    if (paper.time_limit_sec && elapsed() >= paper.time_limit_sec) {
      finish({ auto: true });
      return;
    }
    if (paper.question_time_sec) {
      const left = pageLimit() - Math.round((Date.now() - pageStartedAt) / 1000);
      const pt = el.querySelector('#page-timer');
      if (pt) pt.textContent = formatDuration(Math.max(0, left));
      if (left <= 0) {
        if (page === paper.units.length - 1) finish({ auto: true });
        else go(page + 1);
      }
    }
  }

  return {
    async start() {
      paper = await load();
      answers = initialAnswers(paper.units);
      touched = new Set();
      page = 0;
      maxPage = 0;
      startedAt = Date.now();
      if (!paper.units.length) {
        el.innerHTML = '<div class="panel empty"><p>Бұл тестте әзірге сұрақ жоқ.</p></div>';
        return;
      }
      renderPage();
      tick = setInterval(onTick, 1000);
    },
    stop() {
      clearInterval(tick);
      window.removeEventListener('beforeunload', onUnload);
    },
  };
}

export async function quizView(el, [id], app, alive) {
  const first = await api.get(`/api/tests/${encodeURIComponent(id)}`);
  if (!alive()) return;
  const { topic, title } = first;
  const heading = title && title !== topic.title ? title : topic.title;
  app.setTitle(`Тест: ${heading}`);
  const quiz = runQuiz(el, {
    app,
    heading,
    crumbs: `<ol class="breadcrumb">
        <li><a href="/tests" data-link>Тесттер</a></li>
        <li>${esc(topic.title)}</li>
        <li aria-current="page">Тест</li>
      </ol>`,
    // «Қайта тапсыру» opens the page again, which starts a new session.
    load: async () => first,
    submit: (answers, paper) => api.post(`/api/tests/${encodeURIComponent(id)}`, { answers, token: paper.token }),
    onResult: (r, { auto }) => {
      if (!alive()) return;
      el.innerHTML = `
        <div class="quiz">
          ${auto ? '<div class="notice"><span>Уақыт аяқталды: жауаптар автоматты түрде тексерілді.</span></div>' : ''}
          ${resultHero(r, { topicSlug: topic.slug, topicTitle: heading, testId: id, attemptId: r.attempt_id })}
          ${bookBox(first.book)}
          ${r.saved ? `<div class="notice"><span>Нәтиже сақталды.</span><a class="link-more" href="/results" data-link>Менің нәтижелерім ${icon('arrow')}</a></div>` : ''}
          ${reviewList(r.items)}
        </div>`;
    },
  });
  await quiz.start();
  return () => quiz.stop();
}
