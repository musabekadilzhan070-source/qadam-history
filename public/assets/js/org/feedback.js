import { org } from './api.js';
import { esc, toast, busy } from './ui.js';
import { formatDate } from '../util.js';

// «Келген ұсыныстар»: every student suggestion, newest first. New ones are marked until read;
// a reply is shown to the student on their «Ұсыныстар» page. The list refreshes itself.

const STATUS = {
  new: '<span class="o-badge o-badge-warn">Жаңа</span>',
  read: '<span class="o-badge o-badge-off">Оқылды</span>',
  answered: '<span class="o-badge o-badge-on">Жауап берілді</span>',
};
const POLL_MS = 20000;

export async function feedbackView(el, _params, ctx, alive) {
  const filters = { status: '', from: '', to: '', q: '' };
  const drafts = new Map(); // reply text being typed, kept across refreshes
  let data = await load();
  if (!alive()) return;

  async function load() {
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
    return org.get(`/feedback${qs.toString() ? `?${qs}` : ''}`);
  }

  const card = (f) => `
    <li class="o-card o-fb${f.status === 'new' ? ' is-new' : ''}" data-id="${f.id}">
      <div class="o-fb-head">
        <div><h3>${esc(f.subject)}</h3>
          <p class="o-muted"><b>${esc(f.display_name)}</b> · ${esc(f.contact)} · ${esc(formatDate(f.created_at))}</p></div>
        ${STATUS[f.status]}
      </div>
      <p class="o-fb-body">${esc(f.body)}</p>
      ${f.reply ? `<div class="o-fb-reply"><p class="o-label">Сіздің жауабыңыз · ${esc(formatDate(f.replied_at))}</p><p>${esc(f.reply)}</p></div>` : ''}
      <details class="o-fb-answer" ${drafts.has(f.id) ? 'open' : ''}>
        <summary class="btn btn-ghost btn-sm">${f.reply ? 'Жауапты өзгерту' : 'Жауап беру'}</summary>
        <label class="o-field"><span class="o-label">Жауап мәтіні</span>
          <textarea rows="4" maxlength="3000" data-reply>${esc(drafts.get(f.id) ?? f.reply ?? '')}</textarea></label>
        <button type="button" class="btn btn-sm" data-act="reply">Жауапты жіберу</button>
      </details>
      <div class="o-row-actions">
        ${
          f.status === 'new'
            ? '<button type="button" class="btn btn-ghost btn-sm" data-act="read">Оқылды деп белгілеу</button>'
            : f.status === 'read'
              ? '<button type="button" class="btn btn-ghost btn-sm" data-act="unread">Жаңа деп белгілеу</button>'
              : ''
        }
      </div>
    </li>`;

  const drawList = () => {
    const c = data.counts;
    el.querySelector('[data-counts]').innerHTML = `Барлығы ${c.new + c.read + c.answered} · <b>${c.new} жаңа</b> · ${c.read} оқылған · ${c.answered} жауап берілген`;
    el.querySelector('[data-list]').innerHTML = data.items.length
      ? data.items.map(card).join('')
      : '<li class="o-card o-empty"><p>Бұл сүзгі бойынша ұсыныс жоқ.</p></li>';
  };

  el.innerHTML = `
    <section class="o-card">
      <div class="o-card-head"><div><h2>Келген ұсыныстар</h2><p class="o-muted" data-counts></p></div></div>
      <form class="o-fb-filters" data-filters>
        <label class="o-field"><span class="o-label">Күйі</span>
          <select name="status">
            <option value="">Барлығы</option><option value="new">Жаңа (оқылмаған)</option><option value="read">Оқылған</option>
            <option value="open">Жауап берілмеген</option><option value="answered">Жауап берілген</option>
          </select></label>
        <label class="o-field"><span class="o-label">Күннен</span><input type="date" name="from" /></label>
        <label class="o-field"><span class="o-label">Күнге дейін</span><input type="date" name="to" /></label>
        <label class="o-field o-fb-q"><span class="o-label">Іздеу</span><input type="search" name="q" placeholder="Тақырып, мәтін, оқушы" /></label>
      </form>
      <p class="o-muted o-fb-note">Тізім әр ${POLL_MS / 1000} секунд сайын өзі жаңарады.</p>
    </section>
    <ol class="o-fb-list" data-list></ol>`;
  drawList();

  let searchTimer = null;
  const refresh = async () => {
    data = await load();
    if (alive()) drawList();
  };
  el.querySelector('[data-filters]').addEventListener('input', (e) => {
    filters[e.target.name] = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => refresh().catch((err) => toast(err.message, 'error')), e.target.name === 'q' ? 300 : 0);
  });
  el.querySelector('[data-filters]').addEventListener('submit', (e) => e.preventDefault());
  el.addEventListener('input', (e) => {
    if (e.target.matches('[data-reply]')) drafts.set(Number(e.target.closest('[data-id]').dataset.id), e.target.value);
  });

  el.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = Number(btn.closest('[data-id]').dataset.id);
    const act = btn.dataset.act;
    await busy(btn, async () => {
      if (act === 'reply') {
        const text = btn.closest('[data-id]').querySelector('[data-reply]').value.trim();
        if (text.length < 2) return toast('Жауап мәтінін жазыңыз.', 'error');
        await org.post(`/feedback/${id}/reply`, { reply: text });
        drafts.delete(id);
        toast('Жауап жіберілді: оқушы оны «Ұсыныстар» бетінде көреді.');
      } else {
        await org.post(`/feedback/${id}/read`, { read: act === 'read' });
      }
      await refresh();
      ctx.refreshFeedback?.();
    });
  });

  // New suggestions arrive while the page is open; a reply being typed is kept.
  const timer = setInterval(async () => {
    if (!alive()) return clearInterval(timer);
    if (document.hidden || el.contains(document.activeElement) && document.activeElement.matches('[data-reply], [name="q"]')) return;
    try {
      const fresh = await load();
      if (JSON.stringify(fresh) === JSON.stringify(data)) return;
      data = fresh;
      drawList();
    } catch {
      /* next tick */
    }
  }, POLL_MS);
}
