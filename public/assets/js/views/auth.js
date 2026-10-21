import { api } from '../api.js';
import { esc } from '../util.js';
import { periodEmblem, ornamentBand } from '../art.js';

// Only same-site paths are allowed as a redirect target after sign-in.
const nextPath = () => {
  const next = new URLSearchParams(location.search).get('next') || '/';
  return next.startsWith('/') && !next.startsWith('//') ? next : '/';
};

function layout({ title, text, form }) {
  return `
  <div class="panel auth">
    <div class="auth-art">
      ${ornamentBand('band')}
      ${periodEmblem(2)}
      <h2>Тарихты жүйелі оқы</h2>
      <p>Аккаунт тест нәтижелерін сақтап, қай тақырыпты қайталау керегін көрсетеді.</p>
    </div>
    <form class="auth-form" novalidate>
      <h1>${esc(title)}</h1>
      <p>${esc(text)}</p>
      <div class="form-error" role="alert" hidden></div>
      ${form}
    </form>
  </div>`;
}

function bindForm(el, app, url, collect) {
  const form = el.querySelector('form');
  const errorEl = form.querySelector('.form-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const { user } = await api.post(url, collect(new FormData(form)));
      app.setUser(user);
      app.navigate(nextPath(), { replace: true });
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
      btn.disabled = false;
    }
  });
  form.querySelector('input')?.focus();
}

const keepNext = () => (location.search ? location.search : '');

export function loginView(el, _params, app) {
  if (app.user) return app.navigate(nextPath(), { replace: true });
  el.innerHTML = layout({
    title: 'Кіру',
    text: 'Логин мен құпиясөзіңізді енгізіңіз.',
    form: `
      <div class="field"><label for="username">Логин</label><input id="username" name="username" autocomplete="username" required /></div>
      <div class="field"><label for="password">Құпиясөз</label><input id="password" name="password" type="password" autocomplete="current-password" required /></div>
      <button class="btn btn-block" type="submit">Кіру</button>
      <p class="auth-switch">Аккаунтыңыз жоқ па? <a href="/register${keepNext()}" data-link>Тіркелу</a></p>`,
  });
  bindForm(el, app, '/api/auth/login', (fd) => ({ username: fd.get('username'), password: fd.get('password') }));
}

export function registerView(el, _params, app) {
  if (app.user) return app.navigate(nextPath(), { replace: true });
  el.innerHTML = layout({
    title: 'Тіркелу',
    text: 'Оқушы аккаунтын ашыңыз. Бұл бір минуттан аз уақыт алады.',
    form: `
      <div class="field"><label for="display_name">Аты-жөніңіз</label><input id="display_name" name="display_name" autocomplete="name" required /></div>
      <div class="field"><label for="username">Логин</label><input id="username" name="username" autocomplete="username" required /><small>3–32 таңба: әріп, цифр, нүкте, сызықша.</small></div>
      <div class="field"><label for="password">Құпиясөз</label><input id="password" name="password" type="password" autocomplete="new-password" required /><small>Кемінде 6 таңба.</small></div>
      <button class="btn btn-block" type="submit">Тіркелу</button>
      <p class="auth-switch">Аккаунтыңыз бар ма? <a href="/login${keepNext()}" data-link>Кіру</a></p>`,
  });
  bindForm(el, app, '/api/auth/register', (fd) => ({
    display_name: fd.get('display_name'),
    username: fd.get('username'),
    password: fd.get('password'),
  }));
}
