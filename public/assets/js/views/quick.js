import { api } from '../api.js';
import { esc } from '../util.js';

// «Жылдам тест» (/quick/:id): ten questions of a test, one at a time, as in a short video.
// A 3-2-1 countdown runs, «Ойлан…» shows, then the answer and a line from the textbook appear.
// The student says whether they knew it; the end screen shows how many they knew.

const COUNT_SEC = 3;
const THINK_MS = 1800;
const LEVEL = { A: 'А деңгей', B: 'В деңгей', C: 'С деңгей' };
const BANDS = [
  [9, 10, 'Керемет! Тақырыпты меңгердің'],
  [6, 8, 'Жақсы! Тағы бір қайтала'],
  [0, 5, 'Оқулықты қайта оқып шық'],
];

export async function quickView(el, [id], app, alive) {
  const data = await api.get(`/api/quick/${encodeURIComponent(id)}`);
  if (!alive()) return;
  app.setTitle(`Жылдам тест · ${data.test.title}`);
  const qs = data.questions;
  const counts = { A: 0, B: 0, C: 0 };
  qs.forEach((q) => counts[q.level]++);
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let timers = [];
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  const stop = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };
  const known = [];
  let i = 0;

  const pill = `<p class="qk-pill">${data.topic.number ? `${data.topic.number}-тақырып · ` : ''}жылдам тест</p>`;
  const dots = (at) => `
    <ol class="qk-dots" aria-hidden="true">
      ${qs.map((q, n) => `<li class="lv-${q.level}${n < at ? ' done' : ''}${n === at ? ' now' : ''}"></li>`).join('')}
    </ol>`;
  const shell = (body, level = '') => `
    <section class="qk-stage${level ? ` qk-${level}` : ''}" aria-live="polite">
      <a class="qk-close" href="/tests/${data.test.id}" data-link aria-label="Жылдам тесттен шығу">×</a>
      ${body}
    </section>`;

  function intro() {
    stop();
    if (!qs.length) {
      el.innerHTML = shell(`<div class="qk-center"><p class="qk-title">Бұл тақырыпта жылдам тестке лайық сұрақ әзірге жоқ.</p>
        <a class="btn" href="/tests/${data.test.id}" data-link>Толық тестке өту</a></div>`);
      return;
    }
    el.innerHTML = shell(`
      <div class="qk-center qk-intro">
        <p class="qk-pill qk-pill-gold">Қазақстан тарихы · жылдам тест</p>
        ${data.topic.number ? `<p class="qk-big">${data.topic.number}</p><p class="qk-tag">Тақырып</p>` : ''}
        <h1 class="qk-title">${esc(data.topic.title)}</h1>
        ${data.test.title !== data.topic.title ? `<p class="qk-sub">${esc(data.test.title)}</p>` : ''}
        <p class="qk-levels">${['A', 'B', 'C'].filter((l) => counts[l]).map((l) => `<span class="lv-${l}">${LEVEL[l]} · ${counts[l]}</span>`).join('')}</p>
        <p class="qk-muted">${qs.length} сұрақ · жауапты ішіңнен айт</p>
        <p class="qk-gold">Дұрыс жауаптарыңды санап отыр!</p>
        <button type="button" class="btn qk-start" data-act="start">Бастау</button>
      </div>`);
  }

  function question() {
    stop();
    const q = qs[i];
    el.innerHTML = shell(
      `
      <header class="qk-head">${pill}${dots(i)}<p class="qk-level lv-${q.level}">${LEVEL[q.level]} · ${i + 1}/${qs.length}-сұрақ</p></header>
      <div class="qk-body">
        <h2 class="qk-q">${esc(q.text)}</h2>
        <div class="qk-slot">
          <div class="qk-ring" style="--sec:${COUNT_SEC}s"><svg viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="19" /></svg><b>${COUNT_SEC}</b></div>
        </div>
      </div>
      <footer class="qk-foot"><button type="button" class="qk-link" data-act="reveal">Жауабын қазір көрсету</button></footer>`,
      q.level,
    );
    const ring = el.querySelector('.qk-ring');
    const num = ring.querySelector('b');
    if (!reduced) requestAnimationFrame(() => ring.classList.add('run'));
    for (let s = 1; s < COUNT_SEC; s++) later(() => (num.textContent = COUNT_SEC - s), s * 1000);
    later(() => {
      el.querySelector('.qk-slot').innerHTML = '<p class="qk-think">Ойлан…</p>';
    }, COUNT_SEC * 1000);
    later(answer, COUNT_SEC * 1000 + THINK_MS);
  }

  function answer() {
    stop();
    const q = qs[i];
    el.querySelector('.qk-slot').innerHTML = `
      <div class="qk-answer"><small>Жауабы</small><strong>${esc(q.answer)}</strong></div>
      ${q.note ? `<p class="qk-note">${esc(q.note)}</p>` : ''}`;
    el.querySelector('.qk-foot').innerHTML = `
      <p class="qk-ask">Дұрыс айттың ба?</p>
      <div class="qk-yesno">
        <button type="button" class="qk-no" data-act="no">Жоқ</button>
        <button type="button" class="qk-yes" data-act="yes">Иә, білдім</button>
      </div>`;
    el.querySelector('.qk-yes').focus({ preventScroll: true });
  }

  function result() {
    stop();
    const score = known.filter(Boolean).length;
    const missed = qs.filter((_, n) => !known[n]);
    el.innerHTML = shell(`
      <div class="qk-center qk-end">
        <h2 class="qk-result">Нәтижең қандай?</h2>
        <p class="qk-score"><b>${score}</b> / ${qs.length}</p>
        <ul class="qk-bands">
          ${BANDS.map(([lo, hi, text]) => `<li class="${score >= lo && score <= hi ? 'on' : ''}"><b>${lo}–${hi}</b>${text}</li>`).join('')}
        </ul>
        ${
          missed.length
            ? `<details class="qk-missed"><summary>Білмеген сұрақтарың (${missed.length})</summary>
                <ol>${missed.map((q) => `<li><span>${esc(q.text)}</span><b>${esc(q.answer)}</b></li>`).join('')}</ol></details>`
            : ''
        }
        <div class="qk-actions">
          <button type="button" class="btn" data-act="again">Жаңа 10 сұрақ</button>
          <a class="btn btn-ghost-light" href="/tests/${data.test.id}" data-link>Толық тестті тапсыру</a>
        </div>
        ${data.next ? `<p class="qk-next">Келесі тақырып:<br /><a href="/quick/${data.next.id}" data-link data-reload>«${esc(data.next.title)}»</a></p>` : ''}
      </div>`);
  }

  el.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'start') question();
    else if (act === 'reveal') answer();
    else if (act === 'yes' || act === 'no') {
      known[i] = act === 'yes';
      i++;
      if (i < qs.length) question();
      else result();
    } else if (act === 'again') {
      stop();
      const fresh = await api.get(`/api/quick/${encodeURIComponent(id)}?t=${Date.now()}`);
      qs.splice(0, qs.length, ...fresh.questions);
      known.length = 0;
      i = 0;
      question();
    }
  });

  intro();
  return stop;
}
