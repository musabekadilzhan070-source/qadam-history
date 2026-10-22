import { org } from './api.js';
import { esc, toast, dialog, confirmDialog, busy } from './ui.js';
import { formatDate } from '../util.js';

// Student accounts. When email reset is not set up, the organizer gives a temporary password here.
export async function studentsView(el, _params, _ctx, alive) {
  const { students } = await org.get('/students');
  if (!alive()) return;
  let q = '';
  const draw = () => {
    const needle = q.toLocaleLowerCase('kk');
    const list = students.filter((s) => !needle || `${s.display_name} ${s.email || ''} ${s.username}`.toLocaleLowerCase('kk').includes(needle));
    el.querySelector('[data-rows]').innerHTML = list.length
      ? list
          .map(
            (s) => `<li class="o-row" data-id="${s.id}">
              <span class="o-row-icon">${esc(s.display_name.slice(0, 1).toUpperCase())}</span>
              <div class="o-row-body"><b>${esc(s.display_name)}</b><small>${esc(s.email || '@' + s.username)} · ${esc(formatDate(s.created_at).split(',')[0])} · ${s.attempts} тест тапсырған</small></div>
              <div class="o-row-actions"><button type="button" class="btn btn-ghost btn-sm" data-reset>Уақытша құпиясөз беру</button></div>
            </li>`,
          )
          .join('')
      : '<p class="o-muted">Оқушы табылмады.</p>';
  };
  el.innerHTML = `
    <section class="o-card">
      <div class="o-card-head"><div><h2>Оқушылар · ${students.length}</h2>
        <p class="o-muted">Оқушы құпиясөзін ұмытса және поштамен қалпына келтіру қосылмаса, осы жерден уақытша құпиясөз беріңіз. Оқушы кіргеннен кейін оны «Профиль» бетінде өзгертеді.</p></div></div>
      <label class="o-field o-search"><span class="visually-hidden">Іздеу</span><input type="search" data-q placeholder="Аты немесе пошта бойынша іздеу" /></label>
      <ol class="o-rows" data-rows></ol>
    </section>`;
  el.querySelector('[data-q]').addEventListener('input', (e) => {
    q = e.target.value.trim();
    draw();
  });
  el.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-reset]');
    if (!btn) return;
    const s = students.find((x) => x.id === Number(btn.closest('.o-row').dataset.id));
    if (!(await confirmDialog('Уақытша құпиясөз', `${s.display_name} үшін жаңа құпиясөз жасалады. Ескі құпиясөз жұмыс істемейді, барлық құрылғыдан шығарылады.`, { ok: 'Жасау' }))) return;
    await busy(btn, async () => {
      const { password } = await org.post(`/students/${s.id}/password`);
      await dialog({
        title: 'Уақытша құпиясөз',
        body: `<p>Оқушыға беріңіз (бұл терезе жабылғаннан кейін құпиясөз қайта көрсетілмейді):</p>
          <p class="o-temp-pass"><b>Кіру:</b> ${esc(s.email || s.username)}<br /><b>Құпиясөз:</b> <code>${esc(password)}</code></p>`,
        buttons: [{ label: 'Жабу', value: true, kind: 'primary' }],
      });
      toast('Құпиясөз ауыстырылды.');
    });
  });
  draw();
}
