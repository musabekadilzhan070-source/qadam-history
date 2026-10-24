import { api } from '../api.js';
import { esc, formatDate } from '../util.js';
import { pageHead } from '../components.js';

// «Ұсыныстар»: a student sends a suggestion to the organizer and sees their own suggestions with replies.

const STATUS = {
  new: '<span class="badge">Жіберілді</span>',
  read: '<span class="badge badge-mid">Оқылды</span>',
  answered: '<span class="badge badge-ok">Жауап берілді</span>',
};

const item = (f) => `
  <li class="panel fb-item${f.status === 'answered' && !f.reply_seen ? ' is-new' : ''}">
    <div class="fb-head"><h3>${esc(f.subject)}</h3>${STATUS[f.status] || STATUS.new}</div>
    <p class="fb-date">${esc(formatDate(f.created_at))}</p>
    <p class="fb-body">${esc(f.body)}</p>
    ${
      f.reply
        ? `<div class="fb-reply"><p class="eyebrow">Организатордың жауабы · ${esc(formatDate(f.replied_at))}</p><p>${esc(f.reply)}</p></div>`
        : ''
    }
  </li>`;

export async function feedbackView(el, _params, app, alive) {
  let { items } = await api.get('/api/feedback');
  if (!alive()) return;

  const list = () =>
    items.length
      ? `<ol class="fb-list">${items.map(item).join('')}</ol>`
      : '<div class="panel empty"><p>Сіз әлі ұсыныс жібермедіңіз.</p></div>';

  el.innerHTML = `
    ${pageHead({ eyebrow: 'Кері байланыс', title: 'Ұсыныстар', text: 'Сайт, тесттер немесе сұрақтар туралы ұсынысыңызды организаторға жіберіңіз. Жауап осы бетте көрсетіледі.' })}
    <div class="fb-grid">
      <section class="panel fb-form-panel" aria-labelledby="fb-form-title">
        <h2 id="fb-form-title">Ұсыныс жіберу</h2>
        <form id="fb-form" novalidate>
          <div class="form-msg"></div>
          <div class="field"><label for="fb-subject">Тақырып</label><input id="fb-subject" name="subject" maxlength="120" autocomplete="off" /></div>
          <div class="field"><label for="fb-body">Ұсыныс мәтіні</label><textarea id="fb-body" name="body" rows="6" maxlength="3000"></textarea><small>Кемінде 5 таңба, ең көбі 3000.</small></div>
          <button class="btn" type="submit">Жіберу</button>
        </form>
      </section>
      <section aria-labelledby="fb-list-title">
        <h2 class="section-title fb-list-title" id="fb-list-title">Менің ұсыныстарым</h2>
        <div id="fb-list">${list()}</div>
      </section>
    </div>`;

  // Opening the page shows the replies, so they stop counting as new.
  if (items.some((f) => f.status === 'answered' && !f.reply_seen)) {
    api.post('/api/feedback/seen').then(() => app.refreshBadges?.()).catch(() => {});
  }

  const form = el.querySelector('#fb-form');
  const message = (text, ok) => {
    form.querySelector('.form-msg').innerHTML = `<p class="${ok ? 'form-ok' : 'form-error'}" role="status">${esc(text)}</p>`;
  };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const subject = form.subject.value.trim();
    const body = form.body.value.trim();
    if (subject.length < 3) return message('Тақырыпты жазыңыз (кемінде 3 таңба).');
    if (body.length < 5) return message('Ұсыныс мәтінін жазыңыз (кемінде 5 таңба).');
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const { item: created } = await api.post('/api/feedback', { subject, body });
      items = [created, ...items];
      form.reset();
      message('Ұсынысыңыз жіберілді. Рақмет! Организатор жауап бергенде ол осы бетте көрінеді.', true);
      el.querySelector('#fb-list').innerHTML = list();
    } catch (err) {
      message(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  // New replies appear without reloading the page.
  const timer = setInterval(async () => {
    if (document.hidden) return;
    try {
      const fresh = (await api.get('/api/feedback')).items;
      if (JSON.stringify(fresh) === JSON.stringify(items)) return;
      const gotReply = fresh.some((f) => f.status === 'answered' && !f.reply_seen);
      items = fresh;
      el.querySelector('#fb-list').innerHTML = list();
      if (gotReply) api.post('/api/feedback/seen').then(() => app.refreshBadges?.()).catch(() => {});
    } catch {
      /* try again on the next tick */
    }
  }, 30000);
  return () => clearInterval(timer);
}
