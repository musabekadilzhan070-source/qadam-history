import { api } from '../api.js';
import { esc, formatDuration } from '../util.js';
import { icon, ornamentMark } from '../art.js';
import { gradeLabel } from '../catalog.js';
import { runQuiz } from './quiz.js';
import { reviewList } from './review.js';

// A test sent as a link (/t/<id>): open to anyone with the link, no account. The student reads
// what the test is, writes their name, takes it with the usual QADAM player and sees the end
// screen the organizer chose. Everything is checked and stored on the server (links.js).

const NAME_KEY = 'qadam-link-name';
const fmt = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const savedName = () => {
  try {
    return localStorage.getItem(NAME_KEY) || '';
  } catch {
    return '';
  }
};
const saveName = (name) => {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* private mode: the name is just typed again next time */
  }
};

const head = (info) => {
  const tags = [info.subject, gradeLabel(info.grade), info.publisher].filter(Boolean).join(' | ');
  return `
    <div class="link-brand"><span class="link-mark" aria-hidden="true">${ornamentMark()}</span><span>QADAM <small>Қазақстан тарихы</small></span></div>
    <p class="eyebrow">Сілтеме арқылы тест</p>
    <h1 class="link-title">${esc(info.title)}</h1>
    ${info.topic_title && info.topic_title !== info.title ? `<p class="link-topic">${esc(info.topic_title)}</p>` : ''}
    ${tags ? `<p class="link-tags">${esc(tags)}</p>` : ''}`;
};

function introHtml(info, slug) {
  const facts = [
    `<li>${icon('tests')}<span><b>${info.question_count}</b> сұрақ</span></li>`,
    `<li>${icon('clock')}<span>${info.time_limit_sec ? `Уақыты: <b>${formatDuration(info.time_limit_sec)}</b>` : 'Уақыт шектелмеген'}</span></li>`,
    info.closes_at ? `<li>${icon('periods')}<span>Тапсыру мерзімі: <b>${fmt.format(new Date(info.closes_at))}</b> дейін</span></li>` : '',
    `<li>${icon('results')}<span>${info.retakes ? 'Қайта тапсыруға болады' : 'Тек бір рет тапсыруға болады'}</span></li>`,
  ].join('');
  let action;
  if (info.resume) {
    action = `<div class="notice"><span><b>${esc(info.resume.name)}</b>, сіздің аяқталмаған тестіңіз бар. Уақыт тоқтамайды, жалғастырыңыз.</span></div>
      <button type="button" class="btn btn-block" data-start>Тестті жалғастыру ${icon('arrow', 'icon icon-arrow')}</button>`;
  } else if (!info.open) {
    action = `<div class="notice notice-closed" role="alert"><span>${esc(info.message)}</span></div>`;
  } else if (info.already_done) {
    action = '<div class="notice notice-closed" role="alert"><span>Сіз бұл тестті осы құрылғыдан тапсырып қойдыңыз. Организатор қайта тапсыруға рұқсат бермеген.</span></div>';
  } else {
    action = `
      <form class="link-form" data-form novalidate>
        <label class="field"><span>Аты-жөніңіз</span>
          <input name="name" autocomplete="name" maxlength="80" required placeholder="Мысалы: Әлихан Нұрлан" value="${esc(savedName())}" /></label>
        <p class="form-error" data-error role="alert" hidden></p>
        <button type="submit" class="btn btn-block">Тестті бастау ${icon('arrow', 'icon icon-arrow')}</button>
        <p class="link-note">Тіркелу, пошта немесе құпиясөз қажет емес. Аты-жөніңізді толық жазыңыз: организатор нәтижені осы атпен көреді.</p>
      </form>`;
  }
  return `
    <section class="panel link-intro" data-slug="${esc(slug)}">
      ${head(info)}
      ${info.description ? `<p class="link-desc">${esc(info.description)}</p>` : ''}
      <ul class="link-facts">${facts}</ul>
      <div class="link-rules">
        <h2>Нұсқаулық</h2>
        <ol>
          <li>Аты-жөніңізді жазып, «Тестті бастау» батырмасын басыңыз.</li>
          <li>Әр сұраққа жауап беріңіз. Сұрақтар арасында ауысып, жауапты өзгертуге болады.</li>
          <li>${info.time_limit_sec ? 'Уақыт біткенде тест өзі тексеріледі.' : 'Барлық сұраққа жауап берген соң «Жауаптарды тексеру» батырмасын басыңыз.'}</li>
          <li>Бетті жаңартсаңыз, тест осы құрылғыда жалғасады.</li>
        </ol>
      </div>
      ${action}
    </section>`;
}

function endHtml(r, info) {
  const pct = r.percent ?? 0;
  const tone = pct >= 80 ? 'is-good' : pct >= 50 ? 'is-mid' : 'is-low';
  return `
    <section class="panel link-end">
      ${head(info)}
      <div class="link-done">${icon('check')}<div><h2>Тест аяқталды</h2><p>${esc(r.name)}, жауаптарыңыз қабылданды және сақталды.</p></div></div>
      ${
        r.show_result
          ? `<div class="link-score ${tone}">
              <div class="link-percent"><b>${pct}%</b><span>нәтиже</span></div>
              <ul>
                <li><b>${r.score} / ${r.max_score}</b><span>ұпай</span></li>
                <li><b>${r.correct} / ${r.total}</b><span>дұрыс жауап</span></li>
                <li><b>${formatDuration(r.duration_sec || 0)}</b><span>уақыт</span></li>
              </ul>
            </div>`
          : '<p class="link-hidden-result">Нәтижеңізді организатор көреді. Осы бетті жаба беруге болады.</p>'
      }
      ${info.retakes ? `<a class="btn btn-ghost" href="${location.pathname}" data-link data-reload>Қайта тапсыру</a>` : ''}
    </section>
    ${r.items?.length ? reviewList(r.items) : ''}`;
}

export async function linkTestView(el, [slug], app, alive) {
  const base = `/api/link/${encodeURIComponent(slug)}`;
  let info;
  try {
    info = await api.get(base);
  } catch (err) {
    el.innerHTML = `<section class="panel link-intro"><div class="link-brand"><span class="link-mark" aria-hidden="true">${ornamentMark()}</span><span>QADAM</span></div>
      <h1 class="link-title">Тест ашылмады</h1><div class="notice notice-closed" role="alert"><span>${esc(err.message)}</span></div></section>`;
    return;
  }
  if (!alive()) return;
  app.setTitle(info.title);
  el.innerHTML = `<div class="link-page">${introHtml(info, slug)}</div>`;

  let quiz = null;
  async function start(name) {
    const btn = el.querySelector('[data-start], [data-form] button');
    if (btn) btn.disabled = true;
    try {
      const paper = await api.post(`${base}/start`, { name });
      if (!alive()) return;
      if (paper.resumed) info.resume = { name: paper.name };
      quiz = runQuiz(el, {
        app,
        heading: paper.title,
        crumbs: `<p class="link-who">${icon('profile')}<span>${esc(paper.name)}</span></p>`,
        load: async () => paper,
        submit: (answers, p) => api.post(`${base}/submit`, { answers, token: p.token }),
        onResult: (r, { auto }) => {
          if (!alive()) return;
          el.innerHTML = `<div class="link-page">${auto ? '<div class="notice"><span>Уақыт аяқталды: жауаптар автоматты түрде тексерілді.</span></div>' : ''}${endHtml(r, info)}</div>`;
        },
      });
      await quiz.start();
    } catch (err) {
      if (!alive()) return;
      // The test may have closed meanwhile: show the page again with the reason.
      info = await api.get(base).catch(() => info);
      el.innerHTML = `<div class="link-page">${introHtml(info, slug)}</div>`;
      const box = el.querySelector('[data-error]');
      if (box) {
        box.textContent = err.message;
        box.hidden = false;
      } else alert(err.message);
    }
  }

  el.addEventListener('submit', (e) => {
    if (!e.target.matches('[data-form]')) return;
    e.preventDefault();
    const input = e.target.querySelector('input[name="name"]');
    const name = input.value.replace(/\s+/g, ' ').trim();
    const box = el.querySelector('[data-error]');
    if (name.length < 3 || !/\p{L}/u.test(name)) {
      box.textContent = 'Аты-жөніңізді толық жазыңыз (кемінде 3 әріп).';
      box.hidden = false;
      input.focus();
      return;
    }
    saveName(name);
    start(name);
  });
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-start]')) start('');
  });
  return () => quiz?.stop();
}
