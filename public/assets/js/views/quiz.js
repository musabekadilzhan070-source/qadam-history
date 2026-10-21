import { api } from '../api.js';
import { esc, formatDuration } from '../util.js';
import { icon } from '../art.js';
import { letter, resultHero, reviewList } from './review.js';
import { fileUrl } from '../site.js';

/** Old /topics/:slug/test links open the topic's first test. */
export async function legacyQuizView(_el, [slug], app, alive) {
  const { test_id: id } = await api.get(`/api/topics/${encodeURIComponent(slug)}/test`);
  if (alive()) app.navigate(`/tests/${id}`, { replace: true });
}

export async function quizView(el, [id], app, alive) {
  const { topic, questions, title } = await api.get(`/api/tests/${encodeURIComponent(id)}`);
  if (!alive()) return;
  const heading = title && title !== topic.title ? title : topic.title;
  app.setTitle(`Тест: ${heading}`);
  const selfHref = `/tests/${encodeURIComponent(id)}`;

  const answers = {};
  const startedAt = Date.now();
  let index = 0;
  let finished = false;
  let submitting = false;
  let timer = null;

  // A single-answer question holds one option id, a multiple-answer one an array of ids.
  const isAnswered = (q) => (Array.isArray(answers[q.id]) ? answers[q.id].length > 0 : Boolean(answers[q.id]));
  const answeredCount = () => questions.filter(isAnswered).length;
  const elapsed = () => Math.round((Date.now() - startedAt) / 1000);

  const leaveGuard = () => finished || !answeredCount() || confirm('Тест аяқталмады. Жауаптарыңыз сақталмайды. Шығасыз ба?');
  const onUnload = (e) => {
    if (!finished && answeredCount()) e.preventDefault();
  };
  app.guard = leaveGuard;
  window.addEventListener('beforeunload', onUnload);

  function renderQuestion() {
    const q = questions[index];
    const last = index === questions.length - 1;
    const pct = Math.round((answeredCount() / questions.length) * 100);
    el.innerHTML = `
    <div class="quiz">
      <ol class="breadcrumb">
        <li><a href="/tests" data-link>Тесттер</a></li>
        <li><a href="/topics/${encodeURIComponent(topic.slug)}" data-link>${esc(topic.title)}</a></li>
        <li aria-current="page">Тест</li>
      </ol>
      <div class="quiz-head">
        <h1>${esc(heading)}</h1>
        <span class="quiz-timer" aria-label="Өткен уақыт">${icon('clock')}<span id="timer">${formatDuration(elapsed())}</span></span>
      </div>
      <div class="quiz-progress">
        <span>${answeredCount()} / ${questions.length} жауап</span>
        <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${questions.length}" aria-valuenow="${answeredCount()}"><i style="width:${pct}%"></i></div>
      </div>
      <form class="panel question-card" id="q-form">
        <p class="q-num">Сұрақ ${index + 1} / ${questions.length}</p>
        <h2 id="q-text">${esc(q.text)}</h2>
        ${q.image_id ? `<img class="q-image" src="${fileUrl(q.image_id)}" alt="" />` : ''}
        ${q.multiple ? '<p class="q-hint">Бірнеше дұрыс жауап бар: барлығын белгілеңіз.</p>' : ''}
        <fieldset class="options" aria-labelledby="q-text">
          ${q.options
            .map((o, i) => {
              const on = q.multiple ? (answers[q.id] || []).includes(o.id) : answers[q.id] === o.id;
              return `<label class="option${q.multiple ? ' option-multi' : ''}">
                <input type="${q.multiple ? 'checkbox' : 'radio'}" name="opt" value="${o.id}" ${on ? 'checked' : ''} />
                <span class="letter">${letter(i)}</span>${o.image_id ? `<img class="option-image" src="${fileUrl(o.image_id)}" alt="" />` : ''}<span>${esc(o.text)}</span></label>`;
            })
            .join('')}
        </fieldset>
        <div class="quiz-nav">
          <button type="button" class="btn btn-ghost btn-sm" id="prev" ${index === 0 ? 'disabled' : ''}>${icon('back')} Алдыңғы</button>
          ${
            last
              ? `<button type="submit" class="btn" id="finish">Жауаптарды тексеру</button>`
              : `<button type="submit" class="btn btn-dark" id="next">Келесі ${icon('arrow', 'icon icon-arrow')}</button>`
          }
        </div>
      </form>
      <nav class="dots" aria-label="Сұрақтар">
        ${questions
          .map(
            (qq, i) =>
              `<button type="button" class="dot ${isAnswered(qq) ? 'answered' : ''}" data-i="${i}" ${i === index ? 'aria-current="step"' : ''} aria-label="${i + 1}-сұрақ">${i + 1}</button>`,
          )
          .join('')}
      </nav>
      <p class="quiz-note">Жауапты кейін өзгертуге болады. Тексеру соңында жүреді.</p>
    </div>`;

    const form = el.querySelector('#q-form');
    form.addEventListener('change', (e) => {
      if (e.target.name !== 'opt') return;
      if (q.multiple) answers[q.id] = [...form.querySelectorAll('input[name="opt"]:checked')].map((i) => Number(i.value));
      else answers[q.id] = Number(e.target.value);
      const done = answeredCount();
      el.querySelector('.quiz-progress span').textContent = `${done} / ${questions.length} жауап`;
      el.querySelector('.quiz-progress i').style.width = `${Math.round((done / questions.length) * 100)}%`;
      el.querySelector(`.dot[data-i="${index}"]`).classList.toggle('answered', isAnswered(q));
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (last) finish();
      else go(index + 1);
    });
    el.querySelector('#prev').addEventListener('click', () => go(index - 1));
    el.querySelectorAll('.dot').forEach((d) => d.addEventListener('click', () => go(Number(d.dataset.i))));
  }

  function go(i) {
    index = Math.max(0, Math.min(questions.length - 1, i));
    renderQuestion();
    el.querySelector('.option input:checked, .option input')?.focus({ preventScroll: true });
  }

  async function finish() {
    if (submitting) return;
    const missing = questions.length - answeredCount();
    if (missing && !confirm(`${missing} сұраққа жауап берілмеді. Тексеруге жібересіз бе?`)) return;
    submitting = true;
    const btn = el.querySelector('#finish');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Тексерілуде…';
    }
    try {
      const r = await api.post(`/api/tests/${encodeURIComponent(id)}`, { answers, duration_sec: elapsed() });
      finished = true;
      clearInterval(timer);
      if (!alive()) return;
      el.innerHTML = `
        <div class="quiz">
          ${resultHero({ ...r, duration_sec: elapsed() }, { topicSlug: topic.slug, topicTitle: heading, testId: id })}
          ${
            r.saved
              ? `<div class="notice"><span>Нәтиже сақталды.</span><a class="link-more" href="/results" data-link>Менің нәтижелерім ${icon('arrow')}</a></div>`
              : `<div class="notice"><span>Нәтиже сақталмады: оны сақтау үшін аккаунтқа кіріңіз.</span><a class="btn btn-dark btn-sm" href="/login?next=${encodeURIComponent(selfHref)}" data-link>Кіру</a></div>`
          }
          ${reviewList(r.items)}
        </div>`;
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

  renderQuestion();
  timer = setInterval(() => {
    const t = el.querySelector('#timer');
    if (t) t.textContent = formatDuration(elapsed());
  }, 1000);

  return () => {
    clearInterval(timer);
    window.removeEventListener('beforeunload', onUnload);
  };
}
