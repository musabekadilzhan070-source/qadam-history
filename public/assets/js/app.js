import { api } from './api.js';
import { esc, initials } from './util.js';
import { icon, ornamentMark } from './art.js';
import { loading, errorBox } from './components.js';
import { site } from './site.js';
import { activity } from './activity.js';
import { homeView } from './views/home.js';
import { periodsView, periodView } from './views/periods.js';
import { quizView, legacyQuizView } from './views/quiz.js';
import { testsView } from './views/tests.js';
import { resultsView, attemptView } from './views/results.js';
import { reworkView } from './views/rework.js';
import { booksView } from './views/books.js';
import { readerView } from './views/reader.js';
import { reportView } from './views/report.js';
import { profileView } from './views/profile.js';
import { feedbackView } from './views/feedback.js';
import { welcomeView, loginView, registerView, forgotView, resetView } from './views/auth.js';

const NAV = [
  { key: 'home', href: '/', label: 'Басты бет', short: 'Басты', icon: 'home' },
  { key: 'periods', href: '/periods', label: 'Тарихи кезеңдер', short: 'Кезеңдер', icon: 'periods' },
  { key: 'tests', href: '/tests', label: 'Тесттер', short: 'Тесттер', icon: 'tests' },
  { key: 'books', href: '/books', label: 'Кітаптар', short: 'Кітап', icon: 'materials' },
  { key: 'results', href: '/results', label: 'Менің нәтижелерім', short: 'Нәтиже', icon: 'results' },
  { key: 'feedback', href: '/feedback', label: 'Ұсыныстар', short: 'Ұсыныс', icon: 'feedback' },
  { key: 'profile', href: '/profile', label: 'Профиль', short: 'Профиль', icon: 'profile' },
];

const ROUTES = [
  { re: /^\/$/, nav: 'home', view: homeView, title: '' },
  { re: /^\/periods\/?$/, nav: 'periods', view: periodsView, title: 'Тарихи кезеңдер' },
  { re: /^\/periods\/([\w-]+)\/?$/, nav: 'periods', view: periodView },
  { re: /^\/topics\/([\w-]+)\/test\/?$/, nav: 'tests', view: legacyQuizView },
  { re: /^\/tests\/(\d+)\/?$/, nav: 'tests', view: quizView },
  { re: /^\/tests\/?$/, nav: 'tests', view: testsView, title: 'Тесттер' },
  { re: /^\/books\/?$/, nav: 'books', view: booksView, title: 'Кітаптар' },
  { re: /^\/books\/(\d+)\/?$/, nav: 'books', view: readerView, title: 'Кітап', reader: true },
  { re: /^\/report\/?$/, nav: 'results', view: reportView, title: 'Кураторға есеп беру' },
  { re: /^\/results\/?$/, nav: 'results', view: resultsView, title: 'Менің нәтижелерім' },
  { re: /^\/results\/(\d+)\/?$/, nav: 'results', view: attemptView, title: 'Тест нәтижесі' },
  { re: /^\/results\/(\d+)\/rework\/?$/, nav: 'results', view: reworkView, title: 'Қателермен жұмыс' },
  { re: /^\/profile\/?$/, nav: 'profile', view: profileView, title: 'Профиль' },
  { re: /^\/feedback\/?$/, nav: 'feedback', view: feedbackView, title: 'Ұсыныстар' },
  // Pages open to guests; everything else needs an account.
  { re: /^\/welcome\/?$/, view: welcomeView, title: 'Кіру немесе тіркелу', guest: true },
  { re: /^\/login\/?$/, view: loginView, title: 'Кіру', guest: true },
  { re: /^\/register\/?$/, view: registerView, title: 'Тіркелу', guest: true },
  { re: /^\/forgot\/?$/, view: forgotView, title: 'Құпиясөзді қалпына келтіру', guest: true },
  { re: /^\/reset\/?$/, view: resetView, title: 'Жаңа құпиясөз', guest: true },
];

// Pages that no longer exist: reading materials and topic reading pages. The site is for tests only.
const MOVED = [
  [/^\/materials(\/.*)?$/, '/tests'],
  [/^\/topics\/[\w-]+\/?$/, '/tests'],
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
    searchIndex = null;
    renderUserSlot();
    unseenReplies = 0;
    clearInterval(badgeTimer);
    activity.enable(Boolean(user));
    if (user) {
      app.refreshBadges();
      badgeTimer = setInterval(() => document.hidden || app.refreshBadges(), 60000);
    }
  },
  /** Called by views that hold unsaved work (a running test) to confirm leaving. */
  guard: null,
  /** Re-reads the count of organizer replies the student has not seen yet (the dot on «Ұсыныстар»). */
  async refreshBadges() {
    if (!app.user) return;
    try {
      unseenReplies = (await api.get('/api/feedback/unseen')).unseen;
    } catch {
      return;
    }
    renderNav(activeNav);
  },
};

let unseenReplies = 0;
let activeNav = null;
let badgeTimer = null;

function renderNav(active) {
  activeNav = active;
  // Labels and icons can be changed by the organizer; the defaults are the original ones.
  const label = (n) => site.t(`nav_${n.key}`);
  const short = (n) => (site.texts[`nav_${n.key}`] ? label(n) : n.short);
  const dot = (n) => (n.key === 'feedback' && unseenReplies ? `<i class="nav-dot" aria-label="${unseenReplies} жаңа жауап">${unseenReplies}</i>` : '');
  document.getElementById('rail-nav').innerHTML = NAV.map(
    (n) => `<a class="rail-link" href="${n.href}" data-link ${n.key === active ? 'aria-current="page"' : ''}>${site.navIcon(n.key, n.icon)}<span>${label(n)}</span>${dot(n)}</a>`,
  ).join('');
  document.getElementById('tabbar').innerHTML = NAV.map(
    (n) => `<a href="${n.href}" data-link ${n.key === active ? 'aria-current="page"' : ''} aria-label="${label(n)}">${site.navIcon(n.key, n.icon)}<span>${short(n)}</span>${dot(n)}</a>`,
  ).join('');
}

function renderUserSlot() {
  const slot = document.getElementById('user-slot');
  const u = app.user;
  slot.innerHTML = u
    ? `<a class="user-chip" href="/profile" data-link aria-label="Профиль: ${esc(u.display_name)}">
         <span class="avatar">${esc(initials(u.display_name))}</span>
         <span class="user-text">${esc(u.display_name)}<small>${esc(u.email || '@' + u.username)}</small></span></a>`
    : '';
}

async function render() {
  const token = ++renderToken;
  if (cleanup) {
    cleanup();
    cleanup = null;
  }
  app.guard = null;
  const path = location.pathname;
  const moved = MOVED.find(([re]) => re.test(path));
  if (moved) return app.navigate(moved[1], { replace: true });
  const route = ROUTES.find((r) => r.re.test(path));
  if (!app.user && !route?.guest) {
    const next = path === '/' ? '' : `?next=${encodeURIComponent(path + location.search)}`;
    return app.navigate(`/welcome${next}`, { replace: true });
  }
  document.body.classList.toggle('is-guest', !app.user);
  renderNav(route?.nav);
  closeSearch();
  window.scrollTo(0, 0);
  if (!route) {
    app.setTitle('Бет табылмады');
    view.innerHTML = errorBox('Мұндай бет жоқ.');
    return;
  }
  if (route.title !== undefined) app.setTitle(route.title);
  // Test pages count as test time; the reader sets its own book and page.
  activity.set({ kind: /^\/(tests\/\d+|results\/\d+\/rework)\/?$/.test(path) ? 'test' : 'site' });
  view.innerHTML = loading();
  try {
    const params = path.match(route.re).slice(1).map(decodeURIComponent);
    const out = await route.view(view, params, app, () => token === renderToken);
    if (token === renderToken && typeof out === 'function') cleanup = out;
  } catch (err) {
    if (token !== renderToken) return;
    if (err.status === 401) {
      app.setUser(null);
      app.navigate(`/welcome?next=${encodeURIComponent(path)}`, { replace: true });
      return;
    }
    view.innerHTML = errorBox(err.message || 'Қате шықты.');
  }
  if (token === renderToken) view.focus({ preventScroll: true });
}

// Internal links go through the router.
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a || a.hasAttribute('download') || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const url = new URL(a.href, location.href);
  if (!/^https?:$/.test(url.protocol)) return;
  if (url.origin !== location.origin || a.target || url.pathname.startsWith('/assets/') || url.pathname.startsWith('/api/') || url.pathname.startsWith('/organizer')) return;
  e.preventDefault();
  if (app.guard && !app.guard()) return;
  if (url.pathname + url.search === location.pathname + location.search) {
    if ('reload' in a.dataset) return render();
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
  const { tests } = await api.get('/api/tests');
  searchIndex = tests.map((t) => ({
    ...t,
    haystack: [t.title, t.topic_title, t.period_title, t.description, t.summary].join(' ').toLocaleLowerCase('kk'),
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
        .map(
          (t) =>
            `<a href="/tests/${t.id}" data-link><b>${esc(t.title)}</b><span>${esc(t.period_title)}${t.title !== t.topic_title ? ` · ${esc(t.topic_title)}` : ''} · ${t.question_count} сұрақ</span></a>`,
        )
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

const [me] = await Promise.all([api.get('/api/me').catch(() => ({ user: null })), site.load()]);
document.getElementById('foot-text').innerHTML = site.t('footer');
app.setUser(me.user);
render();
