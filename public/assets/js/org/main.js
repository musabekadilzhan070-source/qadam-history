import { ornamentMark } from '../art.js';
import { org, setUnauthorizedHandler } from './api.js';
import { esc, icon, toast, dialog, confirmDialog } from './ui.js';
import { dashboardView } from './dashboard.js';
import { topicsView, topicEditView } from './topics.js';
import { emblemsView } from './emblems.js';
import { studentsView } from './students.js';
import { testsView, testEditView } from './tests.js';
import { imagesView } from './images.js';
import { iconsView } from './icons.js';
import { personsView, personEditView } from './persons.js';
import { siteView } from './site.js';
import { publishView } from './publish.js';
import { SECTIONS } from './sections.js';



const ROUTES = [
  { re: /^\/organizer\/?$/, nav: 'home', view: dashboardView, title: 'Басқару тақтасы' },
  { re: /^\/organizer\/topics\/?$/, nav: 'topics', view: topicsView, title: 'Тақырыптар' },
  { re: /^\/organizer\/topics\/(new|\d+)\/?$/, nav: 'topics', view: topicEditView, title: 'Тақырып' },
  { re: /^\/organizer\/tests\/?$/, nav: 'tests', view: testsView, title: 'Тесттер' },
  { re: /^\/organizer\/tests\/(\d+)\/?$/, nav: 'tests', view: testEditView, title: 'Тест' },
  { re: /^\/organizer\/images\/?$/, nav: 'images', view: imagesView, title: 'Суреттер' },
  { re: /^\/organizer\/emblems\/?$/, nav: 'emblems', view: emblemsView, title: 'Эмблемалар кітапханасы' },
  { re: /^\/organizer\/students\/?$/, nav: 'students', view: studentsView, title: 'Оқушылар' },
  { re: /^\/organizer\/icons\/?$/, nav: 'icons', view: iconsView, title: 'Белгішелер' },
  { re: /^\/organizer\/persons\/?$/, nav: 'persons', view: personsView, title: 'Хандар мен тұлғалар' },
  { re: /^\/organizer\/persons\/(new|\d+)\/?$/, nav: 'persons', view: personEditView, title: 'Тұлға' },
  { re: /^\/organizer\/site\/?$/, nav: 'site', view: siteView, title: 'Сайт мазмұны' },
  { re: /^\/organizer\/publish\/?$/, nav: 'publish', view: publishView, title: 'Сақтау және жариялау' },
];

const root = document.getElementById('org-root');
let dirtyCheck = null;
let token = 0;

const ctx = {
  state: null,
  async reload() {
    ctx.state = await org.get('/state');
    paintStatus();
    return ctx.state;
  },
  navigate(href, { replace = false, force = false } = {}) {
    if (!force && !leaveOk()) return;
    dirtyCheck = null;
    if (replace) history.replaceState(null, '', href);
    else history.pushState(null, '', href);
    render();
  },
  setDirtyCheck(fn) {
    dirtyCheck = fn;
  },
  /** Called after any successful save, so the "unpublished" indicator stays true. */
  async refreshStatus() {
    try {
      const { status } = await org.get('/publications');
      ctx.state.status = status;
      paintStatus();
    } catch {
      /* the next reload shows it */
    }
  },
  publish,
};

const leaveOk = () => !dirtyCheck?.() || confirm('Сақталмаған өзгерістер бар. Беттен кетсеңіз, олар жоғалады. Кетесіз бе?');

window.addEventListener('beforeunload', (e) => {
  if (dirtyCheck?.()) e.preventDefault();
});

// ─── Login ────────────────────────────────────────────────────────
function loginView(message = '') {
  document.title = 'Организатор кабинеті · QADAM';
  root.innerHTML = `
  <main class="o-login">
    <form class="o-login-card" id="pin-form" autocomplete="off">
      <span class="o-login-mark">${ornamentMark()}</span>
      <p class="eyebrow">QADAM</p>
      <h1>Организатор кабинеті</h1>
      <p class="o-muted">Кабинетке кіру үшін организатордың PIN-кодын енгізіңіз.</p>
      <label class="o-field"><span class="o-label">PIN-код</span>
        <input id="pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="12" autocomplete="one-time-code" required />
      </label>
      <p class="o-error" id="pin-error" role="alert" ${message ? '' : 'hidden'}>${esc(message)}</p>
      <button class="btn btn-block" type="submit">Кіру</button>
      <a class="o-back" href="/">← Сайтқа оралу</a>
    </form>
  </main>`;
  const form = root.querySelector('#pin-form');
  const pin = form.querySelector('#pin');
  pin.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button');
    const err = form.querySelector('#pin-error');
    btn.disabled = true;
    try {
      await org.post('/login', { pin: pin.value.trim() });
      await start();
    } catch (error) {
      err.textContent = error.message;
      err.hidden = false;
      pin.value = '';
      pin.focus();
    } finally {
      btn.disabled = false;
    }
  });
}

setUnauthorizedHandler(() => {
  dirtyCheck = null;
  loginView('Сессия аяқталды. PIN-кодты қайта енгізіңіз.');
});

// ─── Layout ───────────────────────────────────────────────────────
function layout() {
  root.innerHTML = `
  <div class="o-app">
    <aside class="o-side">
      <a class="o-brand" href="/organizer" data-link>${ornamentMark()}<span><b>QADAM</b><small>Организатор кабинеті</small></span></a>
      <nav class="o-nav" id="o-nav" aria-label="Кабинет бөлімдері">
        <a href="/organizer" data-link data-key="home">${icon('home')}<span>Басқару тақтасы</span></a>
        ${SECTIONS.map((s) => `<a href="${s.href}" data-link data-key="${s.key}">${icon(s.icon)}<span>${s.label}</span></a>`).join('')}
      </nav>
      <div class="o-side-foot">
        <a href="/" target="_blank" rel="noopener">${icon('arrow')}<span>Сайтты ашу</span></a>
        <button type="button" id="logout">${icon('logout')}<span>Шығу</span></button>
      </div>
    </aside>
    <div class="o-main">
      <header class="o-top">
        <h1 id="o-title"></h1>
        <div class="o-top-actions">
          <span class="o-status" id="o-status"></span>
          <button type="button" class="btn btn-sm" id="publish-btn">Жариялау</button>
        </div>
      </header>
      <main id="o-view" tabindex="-1"></main>
    </div>
  </div>`;
  root.querySelector('#logout').addEventListener('click', async () => {
    if (!leaveOk()) return;
    if (!(await confirmDialog('Кабинеттен шығу', 'Кабинеттен шығасыз ба? Қайта кіру үшін PIN-код қажет болады.', { ok: 'Шығу' }))) return;
    await org.post('/logout').catch(() => {});
    dirtyCheck = null;
    history.replaceState(null, '', '/organizer');
    loginView();
  });
  root.querySelector('#publish-btn').addEventListener('click', () => publish());
}

function paintStatus() {
  const el = document.getElementById('o-status');
  if (!el || !ctx.state) return;
  const s = ctx.state.status;
  el.className = `o-status ${s.has_unpublished ? 'is-pending' : 'is-clean'}`;
  el.textContent = s.has_unpublished ? 'Жарияланбаған өзгерістер бар' : 'Барлығы жарияланған';
}

/** Publishes the saved draft to students, after a confirmation. */
async function publish() {
  if (dirtyCheck?.()) {
    toast('Алдымен осы беттегі өзгерістерді «Сақтау» батырмасымен сақтаңыз.', 'error');
    return false;
  }
  let note = '';
  const choice = await dialog({
    title: 'Сайтқа жариялау',
    body: `<p>Сақталған барлық өзгерістер оқушыларға көрінеді. Жасырын деп белгіленген тақырып, тест және тұлғалар көрінбейді.</p>
      <label class="o-field"><span class="o-label">Қысқаша түсініктеме (міндетті емес)</span><input id="pub-note" maxlength="200" placeholder="Мысалы: жаңа тест қосылды" /></label>`,
    buttons: [
      { label: 'Болдырмау', value: null, kind: 'ghost' },
      { label: 'Жариялау', value: '__ok', kind: 'primary' },
    ],
    onOpen(box) {
      box.querySelector('#pub-note').addEventListener('input', (e) => {
        note = e.target.value;
      });
    },
  });
  if (choice !== '__ok') return false;
  try {
    await org.post('/publish', { note });
    toast('Жарияланды. Өзгерістер сайтта көрінеді.');
    await ctx.reload();
    if (location.pathname.startsWith('/organizer/publish')) render();
    return true;
  } catch (err) {
    toast(err.message, 'error');
    return false;
  }
}

async function render() {
  const my = ++token;
  const route = ROUTES.find((r) => r.re.test(location.pathname));
  // A fresh element per page, so listeners of the previous page do not pile up.
  const old = document.getElementById('o-view');
  const view = old.cloneNode(false);
  old.replaceWith(view);
  document.querySelectorAll('#o-nav a').forEach((a) => {
    if (a.dataset.key === route?.nav) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
  document.body.dataset.path = location.pathname;
  if (!route) {
    view.innerHTML = '<div class="o-card"><p>Мұндай бөлім жоқ.</p><a class="btn btn-sm" href="/organizer" data-link>Басқару тақтасы</a></div>';
    return;
  }
  document.getElementById('o-title').textContent = route.title;
  document.title = `${route.title} · Организатор кабинеті`;
  view.innerHTML = '<div class="loading">Жүктелуде…</div>';
  try {
    await ctx.reload();
    if (my !== token) return;
    const params = location.pathname.match(route.re).slice(1);
    await route.view(view, params, ctx, () => my === token);
  } catch (err) {
    if (my !== token || err.status === 401) return;
    view.innerHTML = `<div class="o-card o-error-card"><p>${esc(err.message)}</p><button class="btn btn-sm" type="button" onclick="location.reload()">Қайталау</button></div>`;
  }
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  const url = new URL(a.href, location.href);
  if (url.pathname === location.pathname) return;
  ctx.navigate(url.pathname + url.search);
});
window.addEventListener('popstate', () => {
  if (dirtyCheck?.() && !confirm('Сақталмаған өзгерістер бар. Беттен кетсеңіз, олар жоғалады. Кетесіз бе?')) {
    history.pushState(null, '', document.body.dataset.path || '/organizer');
    return;
  }
  dirtyCheck = null;
  render();
});

async function start() {
  layout();
  await render();
}

// ─── Boot ────────────────────────────────────────────────────────
try {
  const { organizer } = await org.get('/me');
  if (organizer) await start();
  else loginView();
} catch (err) {
  loginView(err.message);
}
