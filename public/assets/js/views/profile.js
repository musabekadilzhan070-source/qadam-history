import { api } from '../api.js';
import { esc, initials, formatDate } from '../util.js';
import { icon } from '../art.js';
import { pageHead } from '../components.js';

export async function profileView(el, _params, app, alive) {
  const { summary } = await api.get('/api/results');
  if (!alive()) return;
  const u = app.user;
  el.innerHTML = `
    ${pageHead({ eyebrow: 'Оқушы аккаунты', title: 'Профиль' })}
    <div class="profile-grid">
      <section class="panel">
        <div class="profile-card">
          <span class="avatar">${esc(initials(u.display_name))}</span>
          <div><h2 id="pname">${esc(u.display_name)}</h2><p><span id="pmail">${esc(u.email || '@' + u.username)}</span> · ${esc(formatDate(u.created_at).split(',')[0])} бастап</p></div>
        </div>
        <div class="stat-row" style="margin:26px 0 22px">
          <div><b>${summary.tests_done}</b><span>тест</span></div>
          <div><b>${summary.attempts}</b><span>әрекет</span></div>
          <div><b>${summary.average_percent ?? '—'}${summary.average_percent !== null ? '%' : ''}</b><span>орташа</span></div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <a class="btn btn-dark btn-sm" href="/results" data-link>Менің нәтижелерім</a>
          <button class="btn btn-ghost btn-sm" type="button" id="logout">${icon('logout')} Шығу</button>
        </div>
      </section>

      <section class="panel">
        <h2>Аты-жөні және пошта</h2>
        <form id="name-form" novalidate>
          <div class="form-msg"></div>
          <div class="field"><label for="display_name">Аты-жөніңіз</label><input id="display_name" name="display_name" value="${esc(u.display_name)}" autocomplete="name" /></div>
          <div class="field"><label for="email">Электрондық пошта</label><input id="email" name="email" type="email" value="${esc(u.email || '')}" autocomplete="email" autocapitalize="off" spellcheck="false" /><small>Поштамен кіруге және құпиясөзді қалпына келтіруге керек.</small></div>
          <button class="btn btn-sm" type="submit">Сақтау</button>
        </form>
      </section>

      <section class="panel">
        <h2>Құпиясөзді өзгерту</h2>
        <form id="pw-form" novalidate>
          <div class="form-msg"></div>
          <div class="field"><label for="current_password">Қазіргі құпиясөз</label><input id="current_password" name="current_password" type="password" autocomplete="current-password" /></div>
          <div class="field"><label for="new_password">Жаңа құпиясөз</label><input id="new_password" name="new_password" type="password" autocomplete="new-password" /><small>Кемінде 6 таңба.</small></div>
          <button class="btn btn-sm" type="submit">Өзгерту</button>
        </form>
      </section>
    </div>`;

  const message = (form, text, ok) => {
    form.querySelector('.form-msg').innerHTML = `<p class="${ok ? 'form-ok' : 'form-error'}" role="status">${esc(text)}</p>`;
  };

  el.querySelector('#name-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    try {
      const email = form.email.value.trim();
      if (email && !/^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Error('Электрондық пошта форматы қате. Мысалы: adilzhan@gmail.com');
      const { user } = await api.patch('/api/me', { display_name: form.display_name.value, email });
      app.setUser(user);
      el.querySelector('#pname').textContent = user.display_name;
      el.querySelector('.profile-card .avatar').textContent = initials(user.display_name);
      el.querySelector('#pmail').textContent = user.email || `@${user.username}`;
      message(form, 'Сақталды.', true);
    } catch (err) {
      message(form, err.message, false);
    }
  });

  el.querySelector('#pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    try {
      await api.post('/api/me/password', {
        current_password: form.current_password.value,
        new_password: form.new_password.value,
      });
      form.reset();
      message(form, 'Құпиясөз өзгертілді.', true);
    } catch (err) {
      message(form, err.message, false);
    }
  });

  el.querySelector('#logout').addEventListener('click', async () => {
    await api.post('/api/auth/logout').catch(() => {});
    app.setUser(null);
    app.navigate('/', { replace: true });
  });
}
