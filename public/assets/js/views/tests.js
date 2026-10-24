import { api } from '../api.js';
import { pageHead, periodChips, testCard } from '../components.js';
import { site } from '../site.js';

export async function testsView(el, _params, _app, alive) {
  const { periods, tests } = await api.get('/api/tests');
  if (!alive()) return;
  let active = new URLSearchParams(location.search).get('period') || '';
  if (!periods.some((p) => p.slug === active)) active = '';

  function draw() {
    const list = tests.filter((t) => !active || t.period_slug === active);
    el.querySelector('#test-grid').innerHTML = list.length ? list.map(testCard).join('') : '<div class="empty">Бұл кезеңде тест жоқ.</div>';
    el.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.period === active)));
  }

  el.innerHTML = `
    ${pageHead({
      eyebrow: 'Білімді тексеру',
      title: 'Тесттер',
      text: site.texts.tests_page_text || 'Әр тақырыптың өз тесті бар. Кезеңді таңдап, тестті бастаңыз. Нәтиже мен қателердің түсініктемесі тест соңында көрсетіледі.',
    })}
    <div class="toolbar">${periodChips(periods, active)}</div>
    <div class="card-grid" id="test-grid"></div>`;
  el.querySelector('.chips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    active = chip.dataset.period;
    history.replaceState(null, '', active ? `/tests?period=${active}` : '/tests');
    draw();
  });
  draw();
}
