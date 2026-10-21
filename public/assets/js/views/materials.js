import { api } from '../api.js';
import { esc, pad2 } from '../util.js';
import { icon } from '../art.js';
import { pageHead, periodChips } from '../components.js';

export async function materialsView(el, _params, _app, alive) {
  const { periods, materials } = await api.get('/api/materials');
  if (!alive()) return;
  let active = new URLSearchParams(location.search).get('period') || '';
  if (!periods.some((p) => p.slug === active)) active = '';

  const item = (m) => `
    <article class="panel material">
      <div>
        <span class="period-tag"><i>${pad2(m.period_number)}</i>${esc(m.period_title)}</span>
        <h2><a href="/topics/${encodeURIComponent(m.slug)}" data-link>${esc(m.title)}</a></h2>
        <p class="range">${esc(m.range_label)}</p>
        <p>${esc(m.summary)}</p>
        <div class="meta" style="margin-bottom:16px"><span>${icon('clock')}${m.read_minutes} мин оқу</span><span>${m.key_points.length} негізгі дерек</span></div>
        <a class="btn btn-dark btn-sm" href="/topics/${encodeURIComponent(m.slug)}" data-link>${icon('book')} Материалды оқу</a>
      </div>
      <ul class="key-list">${m.key_points.map((k) => `<li><b>${esc(k.label)}</b><span>${esc(k.text)}</span></li>`).join('')}</ul>
    </article>`;

  function draw() {
    const list = materials.filter((m) => !active || m.period_slug === active);
    el.querySelector('#materials').innerHTML = list.map(item).join('') || '<div class="empty">Материал жоқ.</div>';
    el.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.period === active)));
  }

  el.innerHTML = `
    ${pageHead({
      eyebrow: 'Оқу материалдары',
      title: 'Материалдар',
      text: 'Барлық тақырыптың қысқаша мазмұны мен есте сақтайтын даталары, ұғымдары бір жерде. Толық мәтінді тақырып бетінен оқыңыз.',
    })}
    <div class="toolbar">${periodChips(periods, active)}</div>
    <div id="materials"></div>`;
  el.querySelector('.chips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    active = chip.dataset.period;
    history.replaceState(null, '', active ? `/materials?period=${active}` : '/materials');
    draw();
  });
  draw();
}
