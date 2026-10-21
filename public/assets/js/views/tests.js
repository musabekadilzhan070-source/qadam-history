import { api } from '../api.js';
import { esc, pad2, scoreBadge } from '../util.js';
import { icon } from '../art.js';
import { pageHead, periodChips } from '../components.js';
import { site } from '../site.js';

export async function testsView(el, _params, _app, alive) {
  const { periods, tests } = await api.get('/api/tests');
  if (!alive()) return;
  let active = new URLSearchParams(location.search).get('period') || '';
  if (!periods.some((p) => p.slug === active)) active = '';

  const card = (t) => `
    <article class="panel test-card">
      <div class="top">
        <span class="period-tag"><i>${pad2(t.period_number)}</i>${esc(t.period_title)}</span>
        ${t.best_percent !== null ? scoreBadge(t.best_percent) : ''}
      </div>
      <h3>${esc(t.title)}</h3>
      ${t.title !== t.topic_title ? `<p class="range">${esc(t.topic_title)}</p>` : ''}
      <p>${esc(t.summary)}</p>
      <div class="meta">
        <span>${icon('tests')}${t.question_count} сұрақ</span>
        ${t.attempts ? `<span>${t.attempts} рет тапсырылды</span>` : '<span>Әлі тапсырылмаған</span>'}
      </div>
      <div class="actions">
        <a class="btn btn-ghost btn-sm" href="/topics/${encodeURIComponent(t.slug)}" data-link>Оқу</a>
        <a class="btn btn-sm" href="/tests/${t.id}" data-link>${t.attempts ? 'Қайта тапсыру' : 'Тестті бастау'}</a>
      </div>
    </article>`;

  function draw() {
    const list = tests.filter((t) => !active || t.period_slug === active);
    el.querySelector('#test-grid').innerHTML = list.length ? list.map(card).join('') : '<div class="empty">Бұл кезеңде тест жоқ.</div>';
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
