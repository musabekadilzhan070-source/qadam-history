import { api } from '../api.js';
import { esc } from '../util.js';
import { pageHead, periodChips, testCard } from '../components.js';
import { site } from '../site.js';
import { GRADES, PUBLISHERS, gradeLabel } from '../catalog.js';

export async function testsView(el, _params, _app, alive) {
  const { periods, tests } = await api.get('/api/tests');
  if (!alive()) return;
  const query = new URLSearchParams(location.search);
  let active = query.get('period') || '';
  if (!periods.some((p) => p.slug === active)) active = '';
  // Grade and publisher filters appear only for values some published test really has.
  const grades = GRADES.filter((g) => tests.some((t) => t.grade === g));
  const publishers = PUBLISHERS.filter((x) => tests.some((t) => t.publisher === x));
  let grade = grades.includes(Number(query.get('grade'))) ? Number(query.get('grade')) : null;
  let publisher = publishers.includes(query.get('publisher')) ? query.get('publisher') : '';

  function draw() {
    const list = tests.filter(
      (t) => (!active || t.period_slug === active) && (!grade || t.grade === grade) && (!publisher || t.publisher === publisher),
    );
    el.querySelector('#test-grid').innerHTML = list.length
      ? list.map(testCard).join('')
      : `<div class="empty">${grade || publisher ? 'Бұл сүзгі бойынша тест жоқ.' : 'Бұл кезеңде тест жоқ.'}</div>`;
    el.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.period === active)));
  }
  function remember() {
    const qs = new URLSearchParams();
    if (active) qs.set('period', active);
    if (grade) qs.set('grade', grade);
    if (publisher) qs.set('publisher', publisher);
    history.replaceState(null, '', qs.toString() ? `/tests?${qs}` : '/tests');
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
      eyebrow: 'Білімді тексеру',
      title: 'Тесттер',
      text: site.texts.tests_page_text || 'Әр тақырыптың өз тесті бар. Кезеңді таңдап, тестті бастаңыз. Нәтиже мен қателердің түсініктемесі тест соңында көрсетіледі.',
    })}
    <div class="toolbar">${periodChips(periods, active)}${filters}</div>
    <div class="card-grid" id="test-grid"></div>`;
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
