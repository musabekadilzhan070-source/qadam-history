import { api } from '../api.js';
import { esc } from '../util.js';
import { pageHead, periodChips } from '../components.js';
import { site } from '../site.js';
import { GRADES, gradeLabel } from '../catalog.js';
import { quizCard } from './quizgame.js';

// «Quiz» in the menu: every published quiz in one place, with the same period, grade and
// publisher filters as the «Тесттер» page.
export async function quizzesView(el, _params, _app, alive) {
  const { periods, quizzes } = await api.get('/api/quizzes');
  if (!alive()) return;
  const query = new URLSearchParams(location.search);
  let active = query.get('period') || '';
  if (!periods.some((p) => p.slug === active)) active = '';
  const grades = GRADES.filter((g) => quizzes.some((t) => t.grade === g));
  const publishers = [...new Set(quizzes.map((t) => t.publisher).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'kk'));
  let grade = grades.includes(Number(query.get('grade'))) ? Number(query.get('grade')) : null;
  let publisher = publishers.includes(query.get('publisher')) ? query.get('publisher') : '';

  function draw() {
    const list = quizzes.filter(
      (t) => (!active || t.period_slug === active) && (!grade || t.grade === grade) && (!publisher || t.publisher === publisher),
    );
    el.querySelector('#quiz-grid').innerHTML = list.length
      ? list.map(quizCard).join('')
      : `<div class="empty">${grade || publisher ? 'Бұл сүзгі бойынша quiz жоқ.' : 'Бұл кезеңде quiz әзірге жоқ.'}</div>`;
    el.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.period === active)));
  }
  function remember() {
    const qs = new URLSearchParams();
    if (active) qs.set('period', active);
    if (grade) qs.set('grade', grade);
    if (publisher) qs.set('publisher', publisher);
    history.replaceState(null, '', qs.toString() ? `/quiz?${qs}` : '/quiz');
  }

  const filterSelect = (name, label, options, value) => `
    <label class="tag-filter"><span>${label}</span>
      <select name="${name}">
        <option value="">Барлығы</option>
        ${options.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(value || '') ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
      </select></label>`;
  const filters =
    grades.length || publishers.length
      ? `<div class="tag-filters">
          ${grades.length ? filterSelect('grade', 'Сынып', grades.map((g) => ({ value: g, label: gradeLabel(g) })), grade) : ''}
          ${publishers.length ? filterSelect('publisher', 'Баспа', publishers.map((x) => ({ value: x, label: x })), publisher) : ''}
        </div>`
      : '';

  el.innerHTML = `
    ${pageHead({
      eyebrow: 'Ойын форматы',
      title: 'Quiz',
      text: site.texts.quiz_page_text || 'Сұрақтарға 100% дұрыс жауап бергенше ойна. Қате жауап берген сұрақ кейін қайта оралады.',
      extra: `<ul class="head-stats"><li><b>${quizzes.length}</b>quiz</li><li><b>${quizzes.reduce((s, q) => s + q.question_count, 0)}</b>сұрақ</li></ul>`,
    })}
    <div class="toolbar">${periodChips(periods, active)}${filters}</div>
    <div class="qg-grid" id="quiz-grid"></div>`;
  el.querySelector('.chips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    active = chip.dataset.period;
    remember();
    draw();
  });
  el.querySelector('.tag-filters')?.addEventListener('change', (e) => {
    if (e.target.name === 'grade') grade = Number(e.target.value) || null;
    if (e.target.name === 'publisher') publisher = e.target.value;
    remember();
    draw();
  });
  draw();
}
