import { org } from './api.js';
import { formatDate } from '../util.js';
import { esc, toast, confirmDialog } from './ui.js';

export async function publishView(el, _params, ctx, alive) {
  const { status, publications } = await org.get('/publications');
  if (!alive()) return;
  el.innerHTML = `
    <section class="o-card o-publish ${status.has_unpublished ? 'is-pending' : ''}">
      <div>
        <h2>${status.has_unpublished ? 'Жарияланбаған өзгерістер бар' : 'Барлық өзгеріс жарияланған'}</h2>
        <p class="o-muted">«Сақтау» — өзгерісті кабинетте сақтайды (оқушылар әлі көрмейді). «Жариялау» — сақталғанның бәрін оқушыларға көрсетеді.
          Әр жариялау нұсқа ретінде сақталады, қажет болса бұрынғы нұсқаға қайтаруға болады.</p>
        ${status.latest ? `<p class="o-muted">Соңғы жариялау: ${esc(formatDate(status.latest.created_at))}${status.latest.note ? ` · ${esc(status.latest.note)}` : ''}</p>` : ''}
      </div>
      <button type="button" class="btn" data-act="publish" ${status.has_unpublished ? '' : 'disabled'}>Жариялау</button>
    </section>
    <section class="o-card">
      <div class="o-card-head"><div><h2>Жариялау тарихы</h2><p class="o-muted">Соңғы 30 нұсқа. Қайтарғанда кабинеттегі мазмұн сол нұсқаға ауысады, содан кейін оны жариялайсыз. Оқушылар мен олардың нәтижелері өзгермейді.</p></div></div>
      <ol class="o-rows">
        ${publications
          .map(
            (p, i) => `<li class="o-row" data-id="${p.id}">
              <span class="o-row-icon">${publications.length - i}</span>
              <div class="o-row-body"><b>${esc(p.note || 'Түсініктемесіз')}</b><small>${esc(formatDate(p.created_at))}${i === 0 ? ' · қазір сайтта' : ''}</small></div>
              <div class="o-row-actions"><button type="button" class="btn btn-ghost btn-sm" data-act="restore">Осы нұсқаға қайтару</button></div>
            </li>`,
          )
          .join('')}
      </ol>
    </section>`;
  el.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'publish') {
      // On success the page is drawn again with the new status and history.
      await ctx.publish();
    } else if (act === 'restore') {
      const id = Number(e.target.closest('.o-row').dataset.id);
      if (
        !(await confirmDialog(
          'Бұрынғы нұсқаға қайтару',
          'Кабинеттегі тақырыптар, тесттер, тұлғалар мен мәтіндер осы нұсқадағыдай болады. Сақталған, бірақ жарияланбаған өзгерістер жойылады. Жалғастырасыз ба?',
          { ok: 'Қайтару', danger: true },
        ))
      ) {
        return;
      }
      try {
        await org.post(`/publications/${id}/restore`);
        toast('Нұсқа қайтарылды. Оқушыларға көрсету үшін «Жариялау» батырмасын басыңыз.');
        await ctx.reload();
        ctx.navigate('/organizer/publish', { replace: true, force: true });
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });
}
