import { api } from './api.js';
import { esc, initials } from './util.js';
import { icon, ornamentMark } from './art.js';
import { loading, errorBox } from './components.js';
import { homeView } from './views/home.js';
import { periodsView, periodView } from './views/periods.js';
import { topicView } from './views/topic.js';
import { quizView } from './views/quiz.js';
import { testsView } from './views/tests.js';
import { materialsView } from './views/materials.js';
import { resultsView, attemptView } from './views/results.js';
import { profileView } from './views/profile.js';
import { loginView, registerView } from './views/auth.js';

const NAV = [
  { key: 'home', href: '/', label: 'Басты бет', short: 'Басты', icon: 'home' },
  { key: 'periods', href: '/periods', label: 'Тарихи кезеңдер', short: 'Кезеңдер', icon: 'periods' },
  { key: 'tests', href: '/tests', label: 'Тесттер', short: 'Тесттер', icon: 'tests' },
  { key: 'materials', href: '/materials', label: 'Материалдар', short: 'Материал', icon: 'materials' },
  { key: 'results', href: '/results', label: 'Менің нәтижелерім', short: 'Нәтиже', icon: 'results' },
  { key: 'profile', href: '/profile', label: 'Профиль', short: 'Профиль', icon: 'profile' },
];

const ROUTES = [
  { re: /^\/$/, nav: 'home', view: homeView, title: '' },
  { re: /^\/periods\/?$/, nav: 'periods', view: periodsView, title: 'Тарихи кезеңдер' },
  { re: /^\/periods\/([\w-]+)\/?$/, nav: 'periods', view: periodView },
  { re: /^\/topics\/([\w-]+)\/test\/?$/, nav: 'tests', view: quizView },
  { re: /^\/topics\/([\w-]+)\/?$/, nav: 'periods', view: topicView },
  { re: /^\/tests\/?$/, nav: 'tests', view: testsView, title: 'Тесттер' },
  { re: /^\/materials\/?$/, nav: 'materials', view: materialsView, title: 'Материалдар' },
  { re: /^\/results\/?$/, nav: 'results', view: resultsView, title: 'Менің нәтижелерім', auth: true },
  { re: /^\/results\/(\d+)\/?$/, nav: 'results', view: attemptView, title: 'Тест нәтижесі', auth: true },
  { re: /^\/profile\/?$/, nav: 'profile', view: profileView, title: 'Профиль', auth: true },
  { re: /^\/login\/?$/, nav: 'profile', view: loginView, title: 'Кіру' },
  { re: /^\/register\/?$/, nav: 'profile', view: registerView, title: 'Тіркелу' },
];

const view = document.getElementById('view');
let cleanup = null;
let renderToken = 0;

export const app = {
  user: null,
  navigate(href, { replace = false } = {}) {
    if (replace) history.replaceState(null, '', href);
    else history.pushState(null, '', href);
    render();
  },
  setTitle(title) {
    document.title = title ? `${title} · QADAM` : 'QADAM — Қазақстан тарихы';
  },
  setUser(user) {
    app.user = user;
    renderUserSlot();
  },
  /** Called by views that hold unsaved work (a running test) to confirm leaving. */
  guard: null,
};

function renderNav(active) {
  document.getElementById('rail-nav').innerHTML = NAV.map(
    (n) => `<a class="rail-link" href="${n.href}" data-link ${n.key === active ? 'aria-current="page"' : ''}>${icon(n.icon)}<span>${n.label}</span></a>`,
  ).join('');
  document.getElementById('tabbar').innerHTML = NAV.map(
    (n) => `<a href="${n.href}" data-link ${n.key === active ? 'aria-current="page"' : ''} aria-label="${n.label}">${icon(n.icon)}<span>${n.short}</span></a>`,
  ).join('');
}

function renderUserSlot() {
  const slot = document.getElementById('user-slot');
  const u = app.user;
  slot.innerHTML = u
    ? `<a class="user-chip" href="/profile" data-link aria-label="Профиль: ${esc(u.display_name)}">
         <span class="avatar">${esc(initials(u.display_name))}</span>
         <span class="user-text">${esc(u.display_name)}<small>@${esc(u.username)}</small></span></a>`
    : `<a class="btn btn-dark btn-sm" href="/login" data-link>Кіру</a>`;
}

async function render() {
  const token = ++renderToken;
  if (cleanup) {
    cleanup();
    cleanup = null;
  }
  app.guard = null;
  const path = location.pathname;
  const route = ROUTES.find((r) => r.re.test(path));
  renderNav(route?.nav);
  closeSearch();
  window.scrollTo(0, 0);
  if (!route) {
    app.setTitle('Бет табылмады');
    view.innerHTML = errorBox('Мұндай бет жоқ.');
    return;
  }
  if (route.title !== undefined) app.setTitle(route.title);
  if (route.auth && !app.user) {
    app.navigate(`/login?next=${encodeURIComponent(path)}`, { replace: true });
    return;
  }
  view.innerHTML = loading();
  try {
    const params = path.match(route.re).slice(1).map(decodeURIComponent);
    const out = await route.view(view, params, app, () => token === renderToken);
    if (token === renderToken && typeof out === 'function') cleanup = out;
  } catch (err) {
    if (token !== renderToken) return;
    if (err.status === 401) {
      app.setUser(null);
      app.navigate(`/login?next=${encodeURIComponent(path)}`, { replace: true });
      return;
    }
    view.innerHTML = errorBox(err.message || 'Қате шықты.');
  }
  if (token === renderToken) view.focus({ preventScroll: true });
}

// Internal links go through the router.
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || a.target || url.pathname.startsWith('/assets/') || url.pathname.startsWith('/api/')) return;
  e.preventDefault();
  if (app.guard && !app.guard()) return;
  if (url.pathname + url.search === location.pathname + location.search) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  app.navigate(url.pathname + url.search);
});
window.addEventListener('popstate', render);

// ─── Topic search in the top bar ─────────────────────────────────
const searchInput = document.getElementById('search-input');
const searchBox = document.getElementById('search-results');
let searchIndex = null;

function closeSearch() {
  searchBox.hidden = true;
}

async function loadIndex() {
  if (searchIndex) return searchIndex;
  const { materials } = await api.get('/api/materials');
  searchIndex = materials.map((m) => ({
    ...m,
    haystack: [m.title, m.summary, m.range_label, m.period_title, ...m.key_points.flatMap((k) => [k.label, k.text])]
      .join(' ')
      .toLocaleLowerCase('kk'),
  }));
  return searchIndex;
}

async function runSearch() {
  const q = searchInput.value.trim().toLocaleLowerCase('kk');
  if (q.length < 2) return closeSearch();
  let items;
  try {
    items = await loadIndex();
  } catch {
    return closeSearch();
  }
  const words = q.split(/\s+/);
  const hits = items.filter((m) => words.every((w) => m.haystack.includes(w))).slice(0, 8);
  searchBox.innerHTML = hits.length
    ? hits
        .map((m) => {
          const fact = m.key_points.find((k) => words.some((w) => `${k.label} ${k.text}`.toLocaleLowerCase('kk').includes(w)));
          return `<a href="/topics/${encodeURIComponent(m.slug)}" data-link><b>${esc(m.title)}</b><span>${esc(m.period_title)}${fact ? ` · ${esc(fact.label)}` : ''}</span></a>`;
        })
        .join('')
    : '<div class="search-empty">Ештеңе табылмады.</div>';
  searchBox.hidden = false;
}

searchInput.addEventListener('input', runSearch);
searchInput.addEventListener('focus', () => {
  loadIndex().catch(() => {});
  if (searchInput.value.trim().length >= 2) runSearch();
});
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    searchInput.value = '';
    closeSearch();
  }
  if (e.key === 'Enter') searchBox.querySelector('a')?.click();
});
searchBox.addEventListener('click', (e) => {
  if (e.target.closest('a')) {
    searchInput.value = '';
    closeSearch();
  }
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.search')) closeSearch();
});

// ─── Boot ────────────────────────────────────────────────────────
document.querySelector('.rail-mark').innerHTML = ornamentMark();
document.querySelector('.brand-mark').innerHTML = ornamentMark();
document.querySelector('.search').insertAdjacentHTML('afterbegin', icon('search'));

try {
  const { user } = await api.get('/api/me');
  app.user = user;
} catch {
  app.user = null;
}
renderUserSlot();
render();
