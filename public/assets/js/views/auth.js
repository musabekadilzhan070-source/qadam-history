import { api } from '../api.js';
import { esc } from '../util.js';
import { periodEmblem, ornamentBand, ornamentMark } from '../art.js';

// Sign-in pages. Guests see only these: the rest of the site needs an account.

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const BAD_EMAIL = 'Электрондық пошта форматы қате. Мысалы: adilzhan@gmail.com';

// Only same-site paths are allowed as a redirect target after sign-in.
const nextPath = () => {
  const next = new URLSearchParams(location.search).get('next') || '/';
  return next.startsWith('/') && !next.startsWith('//') && !/^\/(welcome|login|register|forgot|reset)/.test(next) ? next : '/';
};
const keepNext = () => {
  const next = new URLSearchParams(location.search).get('next');
  return next ? `?next=${encodeURIComponent(next)}` : '';
};

function layout({ title, text, form, back = true }) {
  return `
  <div class="panel auth">
    <div class="auth-art">
      ${ornamentBand('band')}
      ${periodEmblem(2)}
      <h2>Тарихты жүйелі оқы</h2>
      <p>Аккаунт тест нәтижелерін сақтап, қай тақырыпты қайталау керегін көрсетеді.</p>
    </div>
    <form class="auth-form" novalidate>
      ${back ? `<a class="auth-back" href="/welcome${keepNext()}" data-link>← Артқа</a>` : ''}
      <h1>${esc(title)}</h1>
      <p>${text}</p>
      <div class="form-error" role="alert" hidden></div>
      <div class="form-ok" role="status" hidden></div>
      ${form}
    </form>
  </div>`;
}

const field = ({ name, label, type = 'text', auto = '', hint = '', inputmode = '' }) => `
  <div class="field" data-field="${name}">
    <label for="f-${name}">${label}</label>
    <div class="field-row">
      <input id="f-${name}" name="${name}" type="${type}" ${auto ? `autocomplete="${auto}"` : ''} ${inputmode ? `inputmode="${inputmode}"` : ''} ${type === 'email' ? 'autocapitalize="off" spellcheck="false"' : ''} />
      ${type === 'password' ? `<button type="button" class="field-eye" data-eye aria-label="Құпиясөзді көрсету" aria-pressed="false">Көрсету</button>` : ''}
    </div>
    <small class="field-msg" ${hint ? '' : 'hidden'}>${hint}</small>
  </div>`;

/** Wires a form: client checks per field, a busy button while sending, server errors shown above. */
function bindForm(el, { check, send, done }) {
  const form = el.querySelector('form');
  const errorEl = form.querySelector('.form-error');
  const okEl = form.querySelector('.form-ok');
  const btn = form.querySelector('button[type="submit"]');
  const label = btn.textContent;
  const hints = new Map([...form.querySelectorAll('.field')].map((f) => [f.dataset.field, f.querySelector('.field-msg').textContent]));

  const setFieldError = (name, msg) => {
    const f = form.querySelector(`[data-field="${name}"]`);
    if (!f) return;
    const small = f.querySelector('.field-msg');
    f.classList.toggle('has-error', Boolean(msg));
    small.textContent = msg || hints.get(name) || '';
    small.hidden = !small.textContent;
    f.querySelector('input').setAttribute('aria-invalid', msg ? 'true' : 'false');
  };

  form.addEventListener('click', (e) => {
    const eye = e.target.closest('[data-eye]');
    if (!eye) return;
    const input = eye.parentElement.querySelector('input');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    eye.textContent = show ? 'Жасыру' : 'Көрсету';
    eye.setAttribute('aria-pressed', String(show));
  });
  form.addEventListener('input', (e) => setFieldError(e.target.name, ''));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    okEl.hidden = true;
    const data = Object.fromEntries(new FormData(form));
    const errors = check(data);
    for (const name of hints.keys()) setFieldError(name, errors[name]);
    const first = Object.keys(errors)[0];
    if (first) {
      form.querySelector(`[name="${first}"]`)?.focus();
      return;
    }
    btn.disabled = true;
    btn.classList.add('is-busy');
    btn.textContent = 'Күте тұрыңыз…';
    try {
      const out = await send(data);
      const message = done(out);
      if (message) {
        okEl.textContent = message;
        okEl.hidden = false;
      }
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    } finally {
      btn.disabled = false;
      btn.classList.remove('is-busy');
      btn.textContent = label;
    }
  });
  form.querySelector('input')?.focus();
}

function signedIn(app, user) {
  app.setUser(user);
  app.navigate(nextPath(), { replace: true });
}

const passwordErrors = (d, out) => {
  if ((d.password || '').length < 6) out.password = 'Құпиясөз кемінде 6 таңбадан тұрсын.';
  else if (d.password_confirm !== d.password) out.password_confirm = 'Құпиясөздер сәйкес келмейді.';
  if (!d.password_confirm && !out.password) out.password_confirm = 'Құпиясөзді қайта жазыңыз.';
  return out;
};

/** First page for guests: two buttons, «Кіру» and «Тіркелу». */
export function welcomeView(el, _params, app) {
  if (app.user) return app.navigate(nextPath(), { replace: true });
  el.innerHTML = `
  <section class="welcome panel">
    ${ornamentBand('band')}
    <div class="welcome-mark" aria-hidden="true">${ornamentMark()}</div>
    <p class="eyebrow">QADAM · Қазақстан тарихы</p>
    <h1>Тарихты оқы, тест тапсыр, нәтижеңді бақыла</h1>
    <p class="welcome-text">Платформаны пайдалану үшін аккаунтыңызға кіріңіз немесе жаңа аккаунт ашыңыз.</p>
    <div class="welcome-actions">
      <a class="btn btn-block" href="/login${keepNext()}" data-link>Кіру</a>
      <a class="btn btn-dark btn-block" href="/register${keepNext()}" data-link>Тіркелу</a>
    </div>
    ${periodEmblem(3)}
  </section>`;
}

export function loginView(el, _params, app) {
  if (app.user) return app.navigate(nextPath(), { replace: true });
  el.innerHTML = layout({
    title: 'Кіру',
    text: 'Электрондық поштаңызды (немесе логиніңізді) және құпиясөзді енгізіңіз.',
    form: `
      ${field({ name: 'login', label: 'Электрондық пошта немесе логин', type: 'text', auto: 'username', inputmode: 'email' })}
      ${field({ name: 'password', label: 'Құпиясөз', type: 'password', auto: 'current-password' })}
      <p class="auth-forgot"><a href="/forgot${keepNext()}" data-link>Құпиясөзді ұмыттыңыз ба?</a></p>
      <button class="btn btn-block" type="submit">Кіру</button>
      <p class="auth-switch">Аккаунтыңыз жоқ па? <a href="/register${keepNext()}" data-link>Тіркелу</a></p>`,
  });
  bindForm(el, {
    check: (d) => {
      const out = {};
      const login = (d.login || '').trim();
      if (!login) out.login = 'Электрондық поштаңызды немесе логиніңізді жазыңыз.';
      else if (login.includes('@') && !EMAIL_RE.test(login)) out.login = BAD_EMAIL;
      if (!d.password) out.password = 'Құпиясөзді жазыңыз.';
      return out;
    },
    send: (d) => api.post('/api/auth/login', { login: d.login.trim(), password: d.password }),
    done: ({ user }) => signedIn(app, user),
  });
}

export function registerView(el, _params, app) {
  if (app.user) return app.navigate(nextPath(), { replace: true });
  el.innerHTML = layout({
    title: 'Тіркелу',
    text: 'Оқушы аккаунтын ашыңыз. Бұл бір минуттан аз уақыт алады.',
    form: `
      ${field({ name: 'display_name', label: 'Аты-жөніңіз', auto: 'name' })}
      ${field({ name: 'email', label: 'Электрондық пошта', type: 'email', auto: 'email', hint: 'Осы поштамен кіресіз.' })}
      ${field({ name: 'password', label: 'Құпиясөз', type: 'password', auto: 'new-password', hint: 'Кемінде 6 таңба.' })}
      ${field({ name: 'password_confirm', label: 'Құпиясөзді қайталаңыз', type: 'password', auto: 'new-password' })}
      <button class="btn btn-block" type="submit">Тіркелу</button>
      <p class="auth-switch">Аккаунтыңыз бар ма? <a href="/login${keepNext()}" data-link>Кіру</a></p>`,
  });
  bindForm(el, {
    check: (d) => {
      const out = {};
      const name = (d.display_name || '').trim();
      if (name.length < 2 || name.length > 60) out.display_name = 'Аты-жөніңізді жазыңыз (2–60 таңба).';
      const email = (d.email || '').trim();
      if (!email) out.email = 'Электрондық поштаңызды жазыңыз.';
      else if (!EMAIL_RE.test(email)) out.email = BAD_EMAIL;
      return passwordErrors(d, out);
    },
    send: (d) =>
      api.post('/api/auth/register', {
        display_name: d.display_name.trim(),
        email: d.email.trim(),
        password: d.password,
        password_confirm: d.password_confirm,
      }),
    done: ({ user }) => signedIn(app, user),
  });
}

export async function forgotView(el, _params, app) {
  if (app.user) return app.navigate('/profile', { replace: true });
  const { email_reset } = await api.get('/api/auth/options').catch(() => ({ email_reset: false }));
  el.innerHTML = layout({
    title: 'Құпиясөзді қалпына келтіру',
    text: email_reset
      ? 'Тіркелген поштаңызды жазыңыз: оған жаңа құпиясөз орнату сілтемесі келеді.'
      : 'Поштаңызды жазыңыз. Хат жіберу қызметі қосылмаған болса, организатор сізге уақытша құпиясөз береді.',
    form: `
      ${field({ name: 'email', label: 'Электрондық пошта', type: 'email', auto: 'email' })}
      <button class="btn btn-block" type="submit">Сілтеме жіберу</button>
      <p class="auth-switch"><a href="/login${keepNext()}" data-link>Кіру бетіне оралу</a></p>`,
  });
  bindForm(el, {
    check: (d) => (EMAIL_RE.test((d.email || '').trim()) ? {} : { email: BAD_EMAIL }),
    send: (d) => api.post('/api/auth/forgot', { email: d.email.trim() }),
    done: (out) => out.message,
  });
}

export function resetView(el, _params, app) {
  const token = new URLSearchParams(location.search).get('token') || '';
  el.innerHTML = layout({
    title: 'Жаңа құпиясөз',
    text: 'Жаңа құпиясөзді екі рет жазыңыз.',
    back: false,
    form: `
      ${field({ name: 'password', label: 'Жаңа құпиясөз', type: 'password', auto: 'new-password', hint: 'Кемінде 6 таңба.' })}
      ${field({ name: 'password_confirm', label: 'Құпиясөзді қайталаңыз', type: 'password', auto: 'new-password' })}
      <button class="btn btn-block" type="submit">Сақтау</button>`,
  });
  if (!token) {
    const err = el.querySelector('.form-error');
    err.textContent = 'Сілтеме толық емес. Поштадағы сілтемені қайта ашыңыз.';
    err.hidden = false;
  }
  bindForm(el, {
    check: (d) => passwordErrors(d, {}),
    send: (d) => api.post('/api/auth/reset', { token, password: d.password, password_confirm: d.password_confirm }),
    done: ({ user }) => {
      app.setUser(user);
      app.navigate('/', { replace: true });
    },
  });
}
