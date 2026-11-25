import { api } from '../api.js';
import { esc, formatDate, formatDuration } from '../util.js';
import { icon, ornamentBand } from '../art.js';
import { pageHead } from '../components.js';
import { reviewList } from './review.js';
import { runQuiz } from './quiz.js';
import { checkBadges } from '../badges.js';

// «ҰБТ сынақ»: a mock exam in the format of the national exam. Questions come mixed from the
// classic tests of every period, one point each, under one timer. The result shows the score,
// the score per period, the weakest period to read again, and every question with its answer.

const num = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));
const pct = (c, t) => (t ? Math.round((c / t) * 100) : 0);

function verdict(p) {
  if (p >= 90) return 'Керемет! ҰБТ-ға дайынсыз';
  if (p >= 70) return 'Жақсы нәтиже';
  if (p >= 50) return 'Жаман емес, бірақ әлі де дайындалу керек';
  return 'Дайындықты күшейту керек';
}

/** Period bars: how many of each period's questions were right. */
function periodBars(list, { links = true } = {}) {
  if (!list.length) return '';
  const weakest = list.length > 1 ? [...list].sort((a, b) => pct(a.correct, a.total) - pct(b.correct, b.total))[0] : null;
  return `
    <ul class="ubt-periods">
      ${list
        .map((p) => {
          const v = pct(p.correct, p.total);
          const weak = weakest && p === weakest && v < 100;
          return `<li class="${weak ? 'is-weak' : ''}">
            <span class="ubt-p-name"><i>${String(p.number).padStart(2, '0')}</i>${esc(p.title)}</span>
            <span class="ubt-p-bar"><i style="--w:${v}%"></i></span>
            <span class="ubt-p-num">${num(p.correct)} / ${num(p.total)}</span>
            ${weak && links && p.slug ? `<a class="ubt-p-link" href="/periods/${encodeURIComponent(p.slug)}" data-link>Қайталау ${icon('arrow')}</a>` : ''}
          </li>`;
        })
        .join('')}
    </ul>`;
}

function resultHtml(r, { fresh = false, auto = false } = {}) {
  const record = fresh && r.previous_best !== null && r.score > r.previous_best;
  const weak = r.by_period.length > 1 ? [...r.by_period].sort((a, b) => pct(a.correct, a.total) - pct(b.correct, b.total))[0] : null;
  return `
    <div class="quiz ubt-result">
      ${auto ? '<div class="notice"><span>Уақыт аяқталды: жауаптар автоматты түрде тексерілді.</span></div>' : ''}
      <section class="result-hero ubt-hero" aria-labelledby="result-title">
        <div class="score" style="--p:${r.percent}" role="img" aria-label="Нәтиже ${r.score} балл">
          <div><b>${num(r.score)}</b><span>/ ${num(r.max_score)} балл</span></div>
        </div>
        <div>
          <p class="eyebrow">ҰБТ сынақ${r.created_at ? ` · ${esc(formatDate(r.created_at))}` : ''}</p>
          <h1 id="result-title">${verdict(r.percent)}</h1>
          ${record ? `<p class="ubt-record">${icon('crown')} Жаңа рекорд! Бұрынғы ең жоғары балл: ${num(r.previous_best)}</p>` : ''}
          <ul class="result-counts">
            <li class="ok">${r.correct} дұрыс</li>
            <li class="bad">${r.total - r.correct} қате</li>
            <li>${r.percent}%</li>
            ${r.duration_sec ? `<li>${formatDuration(r.duration_sec)} уақыт</li>` : ''}
          </ul>
          <div class="banner-actions">
            <a class="btn" href="/ubt?start=1" data-link>Жаңа сынақ</a>
            <a class="btn btn-ghost-light" href="/ubt" data-link>Барлық сынақтар</a>
          </div>
        </div>
        ${ornamentBand('band')}
      </section>
      <section class="panel ubt-card">
        <div class="ubt-card-head"><h2>Кезеңдер бойынша</h2>
          ${weak && pct(weak.correct, weak.total) < 100 ? `<p class="ubt-advice">${icon('info')}<span>Ең көп қате: <b>${esc(weak.title)}</b>. Осы кезеңнің тақырыптарын қайталаңыз.</span></p>` : ''}</div>
        ${periodBars(r.by_period)}
      </section>
      ${reviewList(r.items)}
    </div>`;
}

/** Score history as columns, oldest on the left. */
function trend(runs) {
  const list = runs.slice(0, 12).reverse();
  if (list.length < 2) return '';
  return `
    <div class="ubt-trend" role="img" aria-label="Соңғы сынақтардың нәтижелері">
      ${list
        .map((r) => {
          const v = pct(r.score, r.max_score);
          return `<span style="--h:${Math.max(v, 3)}%" title="${esc(formatDate(r.created_at))}: ${num(r.score)} / ${num(r.max_score)}"><b>${num(r.score)}</b></span>`;
        })
        .join('')}
    </div>`;
}

/** All periods over every run: the student's strong and weak sides. */
function totalsByPeriod(info) {
  const sum = new Map();
  for (const r of info.runs) {
    for (const p of r.by_period) {
      const s = sum.get(p.number) || { number: p.number, title: p.title, slug: null, correct: 0, total: 0 };
      s.correct += p.correct;
      s.total += p.total;
      sum.set(p.number, s);
    }
  }
  for (const p of info.periods) if (sum.has(p.number)) Object.assign(sum.get(p.number), { title: p.title, slug: p.slug });
  return [...sum.values()].sort((a, b) => a.number - b.number);
}

function introHtml(info) {
  const { settings, runs } = info;
  const best = runs.length ? runs.reduce((m, r) => (r.score > m.score ? r : m), runs[0]) : null;
  const last = runs[0];
  const avg = runs.length ? runs.reduce((s, r) => s + pct(r.score, r.max_score), 0) / runs.length : 0;
  return `
    ${pageHead({
      eyebrow: 'ҰБТ-ға дайындық',
      title: 'ҰБТ сынақ',
      text: 'Нағыз ҰБТ-дағыдай: барлық кезеңнен аралас сұрақтар, бір уақыт, әр дұрыс жауапқа бір балл. Соңында балың мен әлсіз тұсың көрсетіледі.',
      extra: `<ul class="head-stats"><li><b>${settings.question_count}</b>сұрақ</li><li><b>${settings.time_min}</b>минут</li><li><b>${runs.length}</b>сынақ тапсырдыңыз</li></ul>`,
    })}
    <div class="ubt-layout">
      <section class="panel ubt-start">
        <h2>Сынақ ережесі</h2>
        <ul class="ubt-rules">
          <li>${icon('tests')}<span><b>${settings.question_count} сұрақ</b>Әр сұрақтың бір ғана дұрыс жауабы бар.</span></li>
          <li>${icon('target')}<span><b>1 сұрақ = 1 балл</b>Ең жоғары балл — ${settings.question_count}.</span></li>
          <li>${icon('clock')}<span><b>${settings.time_min} минут</b>Уақыт біткенде жауаптар өзі тексеріледі.</span></li>
          <li>${icon('periods')}<span><b>Барлық кезең</b>Ежелгі заманнан бүгінге дейін, аралас.</span></li>
        </ul>
        ${
          info.ready
            ? `<button type="button" class="btn btn-lg ubt-go" data-start>${icon('exam')} Сынақты бастау</button>
               <p class="ubt-note">Бастаған соң таймер іске қосылады. Жауаптарды соңында бірден тексеруге болады.</p>`
            : '<p class="ubt-note">Сынаққа сұрақ әзірге жеткіліксіз. Тесттер қосылған соң ашылады.</p>'
        }
      </section>
      ${
        runs.length
          ? `<section class="panel ubt-stats">
              <h2>Менің нәтижем</h2>
              <ul class="ubt-kpis">
                <li><b>${num(best.score)}<small>/${num(best.max_score)}</small></b><span>ең жоғары</span></li>
                <li><b>${num(last.score)}<small>/${num(last.max_score)}</small></b><span>соңғы</span></li>
                <li><b>${Math.round(avg)}%</b><span>орташа</span></li>
              </ul>
              ${trend(runs)}
              <h3>Кезеңдер бойынша (барлық сынақ)</h3>
              ${periodBars(totalsByPeriod(info))}
            </section>`
          : `<section class="panel ubt-stats ubt-empty">
              <span class="ubt-empty-mark">${icon('exam')}</span>
              <h2>Алғашқы сынағыңызды тапсырыңыз</h2>
              <p>Нәтижелер, балдың өсуі және әр кезеңдегі әлсіз тұстар осы жерде көрсетіледі.</p>
            </section>`
      }
    </div>
    ${
      runs.length
        ? `<section class="section">
            <div class="section-head"><div><p class="eyebrow">Тарих</p><h2 class="section-title">Тапсырылған сынақтар</h2></div></div>
            <ol class="ubt-history">
              ${runs
                .map(
                  (r) => `<li><a href="/ubt/${r.id}" data-link>
                    <span class="ubt-h-score"><b>${num(r.score)}</b>/${num(r.max_score)}</span>
                    <span class="ubt-h-main"><b>${verdict(pct(r.score, r.max_score))}</b><small>${esc(formatDate(r.created_at))} · ${formatDuration(r.duration_sec)}</small></span>
                    <span class="ubt-h-pct">${pct(r.score, r.max_score)}%</span>${icon('arrow')}</a></li>`,
                )
                .join('')}
            </ol>
          </section>`
        : ''
    }`;
}

export async function ubtView(el, _params, app, alive) {
  const info = await api.get('/api/practice/mock');
  if (!alive()) return;
  let quiz = null;

  function start() {
    window.scrollTo(0, 0);
    quiz = runQuiz(el, {
      app,
      heading: 'ҰБТ сынақ',
      crumbs: '<ol class="breadcrumb"><li><a href="/ubt" data-link>ҰБТ сынақ</a></li><li aria-current="page">Сынақ</li></ol>',
      load: () => api.post('/api/practice/mock/start'),
      submit: (answers, paper) => api.post('/api/practice/mock/submit', { answers, token: paper.token }),
      onResult: (r, { auto }) => {
        if (!alive()) return;
        history.replaceState(null, '', `/ubt/${r.id}`);
        el.innerHTML = resultHtml(r, { fresh: true, auto });
        checkBadges();
      },
    });
    quiz.start().catch((err) => {
      el.innerHTML = `<div class="panel error-box"><p>${esc(err.message)}</p><a class="btn btn-dark btn-sm" href="/ubt" data-link>Артқа</a></div>`;
    });
  }

  if (new URLSearchParams(location.search).get('start') === '1' && info.ready) {
    history.replaceState(null, '', '/ubt');
    start();
  } else {
    el.innerHTML = introHtml(info);
    el.querySelector('[data-start]')?.addEventListener('click', start);
  }
  return () => quiz?.stop();
}

export async function ubtRunView(el, [id], _app, alive) {
  const r = await api.get(`/api/practice/mock/${encodeURIComponent(id)}`);
  if (!alive()) return;
  el.innerHTML = resultHtml(r);
}
