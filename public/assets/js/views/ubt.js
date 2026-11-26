import { api } from '../api.js';
import { esc, formatDate, formatDuration } from '../util.js';
import { icon, ornamentBand } from '../art.js';
import { pageHead } from '../components.js';
import { reviewList } from './review.js';
import { runQuiz } from './quiz.js';
import { checkBadges } from '../badges.js';

// «Сынақ тесттер»: ten fixed variants of 50 questions in the manner of the ҰБТ. Level A asks for
// a fact, level B for understanding, level C has several answers, pairs or an order (2 points).
// The student picks a variant; the result shows the score per level and per period, the weakest
// period to read again, and every question with its answer and the textbook page.

const BASE = '/sinaq';
const LEVEL_NOTE = {
  A: 'Деректі білу: бір дұрыс жауап, 1 балл',
  B: 'Түсіну және талдау: бір дұрыс жауап, 1 балл',
  C: 'Бірнеше жауап, сәйкестендіру, реттілік: 2 балл',
};
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
          <p class="eyebrow">Сынақ тест${r.variant ? ` · ${r.variant}-нұсқа` : ''}${r.created_at ? ` · ${esc(formatDate(r.created_at))}` : ''}</p>
          <h1 id="result-title">${verdict(r.percent)}</h1>
          ${record ? `<p class="ubt-record">${icon('crown')} Жаңа рекорд! Бұрынғы ең жоғары балл: ${num(r.previous_best)}</p>` : ''}
          <ul class="result-counts">
            <li class="ok">${r.correct} дұрыс</li>
            <li class="bad">${r.total - r.correct} қате</li>
            <li>${r.percent}%</li>
            ${r.duration_sec ? `<li>${formatDuration(r.duration_sec)} уақыт</li>` : ''}
          </ul>
          <div class="banner-actions">
            ${r.variant ? `<a class="btn" href="${BASE}?start=${r.variant}" data-link>Осы нұсқаны қайта тапсыру</a>` : ''}
            <a class="btn btn-ghost-light" href="${BASE}" data-link>Барлық нұсқалар</a>
          </div>
        </div>
        ${ornamentBand('band')}
      </section>
      ${
        r.by_level?.length
          ? `<section class="panel ubt-card">
              <div class="ubt-card-head"><h2>Деңгейлер бойынша</h2></div>
              ${levelBars(r.by_level)}
            </section>`
          : ''
      }
      <section class="panel ubt-card">
        <div class="ubt-card-head"><h2>Кезеңдер бойынша</h2>
          ${weak && pct(weak.correct, weak.total) < 100 ? `<p class="ubt-advice">${icon('info')}<span>Ең көп қате: <b>${esc(weak.title)}</b>. Осы кезеңнің тақырыптарын қайталаңыз.</span></p>` : ''}</div>
        ${periodBars(r.by_period)}
      </section>
      ${r.items.length ? reviewList(r.items) : '<p class="ubt-note">Бұл сынақ нұсқалар енгізілгенге дейін тапсырылған: тек балы сақталған.</p>'}
    </div>`;
}

/** Level bars: points earned of the points of each level. */
function levelBars(list) {
  return `
    <ul class="ubt-periods ubt-levels">
      ${list
        .map((l) => {
          const v = pct(l.score, l.max_score);
          return `<li>
            <span class="ubt-p-name"><i class="lv lv-${l.level}">${l.level}</i>${esc(l.title)}<small>${esc(LEVEL_NOTE[l.level] || '')}</small></span>
            <span class="ubt-p-bar"><i style="--w:${v}%"></i></span>
            <span class="ubt-p-num">${num(l.score)} / ${num(l.max_score)} балл</span>
          </li>`;
        })
        .join('')}
    </ul>`;
}

/** Levels over every run sat on a variant. */
function totalsByLevel(runs) {
  const sum = new Map();
  for (const r of runs) {
    for (const l of r.by_level || []) {
      const s = sum.get(l.level) || { level: l.level, title: l.title, score: 0, max_score: 0 };
      s.score += l.score;
      s.max_score += l.max_score;
      sum.set(l.level, s);
    }
  }
  return [...sum.values()].sort((a, b) => a.level.localeCompare(b.level));
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
  const { settings, runs, variants } = info;
  const best = runs.length ? runs.reduce((m, r) => (pct(r.score, r.max_score) > pct(m.score, m.max_score) ? r : m), runs[0]) : null;
  const last = runs[0];
  const avg = runs.length ? runs.reduce((s, r) => s + pct(r.score, r.max_score), 0) / runs.length : 0;
  const shape = variants[0] || { questions: 50, max_score: 60, levels: { A: 25, B: 15, C: 10 } };
  const done = variants.filter((v) => v.tries).length;
  const levels = totalsByLevel(runs);
  return `
    ${pageHead({
      eyebrow: 'ҰБТ-ға дайындық',
      title: 'Сынақ тесттер',
      text: `${variants.length} нұсқа, әрқайсысында ${shape.questions} сұрақ: А, В және С деңгейлері. Сұрақтар сайттағы оқулықтар бойынша құрылып, жауабымен бірге тексерілген. Нұсқаны таңдап, уақытпен тапсырыңыз.`,
      extra: `<ul class="head-stats"><li><b>${variants.length}</b>нұсқа</li><li><b>${shape.questions}</b>сұрақ</li><li><b>${settings.time_min}</b>минут</li><li><b>${done}/${variants.length}</b>тапсырылды</li></ul>`,
    })}
    <section class="panel ubt-start ubt-rules-panel">
      <h2>Сынақ құрылымы</h2>
      <ul class="ubt-levels-list">
        ${['A', 'B', 'C']
          .map(
            (l) => `<li><i class="lv lv-${l}">${l}</i><span><b>${shape.levels[l] || 0} сұрақ</b>${esc(LEVEL_NOTE[l])}</span></li>`,
          )
          .join('')}
        <li><i class="lv lv-t">${icon('clock')}</i><span><b>${settings.time_min} минут</b>Ең жоғары балл — ${shape.max_score}. Уақыт біткенде жауаптар өзі тексеріледі.</span></li>
      </ul>
      <p class="ubt-note">С деңгейінде бір қате жіберсеңіз де 1 балл аласыз (ҰБТ-дағыдай). Әр сұрақтың түсініктемесінде қай оқулықтың қай беті екені жазылған.</p>
    </section>
    <section class="section">
      <div class="section-head"><div><p class="eyebrow">Нұсқалар</p><h2 class="section-title">Нұсқаны таңдаңыз</h2></div></div>
      <ol class="ubt-variants">
        ${variants
          .map(
            (v) => `<li class="${v.best ? 'is-done' : ''}">
              <button type="button" data-start="${v.number}">
                <span class="uv-num"><small>Нұсқа</small><b>${v.number}</b></span>
                <span class="uv-body">
                  <b>${v.questions} сұрақ · ${v.max_score} балл</b>
                  <small>${v.best ? `Ең жоғары: ${num(v.best.score)} / ${num(v.best.max_score)} · ${v.tries} рет` : 'Әлі тапсырылмаған'}</small>
                  ${v.best ? `<span class="uv-bar"><i style="--w:${v.best.percent}%"></i></span>` : ''}
                </span>
                <span class="uv-go">${v.best ? 'Қайта' : 'Бастау'} ${icon('arrow')}</span>
              </button>
            </li>`,
          )
          .join('')}
      </ol>
    </section>
    ${
      runs.length
        ? `<section class="panel ubt-stats ubt-mine">
            <h2>Менің нәтижем</h2>
            <ul class="ubt-kpis">
              <li><b>${num(best.score)}<small>/${num(best.max_score)}</small></b><span>ең жоғары</span></li>
              <li><b>${num(last.score)}<small>/${num(last.max_score)}</small></b><span>соңғы</span></li>
              <li><b>${Math.round(avg)}%</b><span>орташа</span></li>
            </ul>
            ${trend(runs)}
            <div class="ubt-mine-grid">
              ${levels.length ? `<div><h3>Деңгейлер бойынша (барлық сынақ)</h3>${levelBars(levels)}</div>` : ''}
              <div><h3>Кезеңдер бойынша (барлық сынақ)</h3>${periodBars(totalsByPeriod(info))}</div>
            </div>
          </section>
          <section class="section">
            <div class="section-head"><div><p class="eyebrow">Тарих</p><h2 class="section-title">Тапсырылған сынақтар</h2></div></div>
            <ol class="ubt-history">
              ${runs
                .map(
                  (r) => `<li><a href="${BASE}/${r.id}" data-link>
                    <span class="ubt-h-score"><b>${num(r.score)}</b>/${num(r.max_score)}</span>
                    <span class="ubt-h-main"><b>${r.variant ? `${r.variant}-нұсқа · ` : ''}${verdict(pct(r.score, r.max_score))}</b><small>${esc(formatDate(r.created_at))} · ${formatDuration(r.duration_sec)}</small></span>
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

  function start(variant) {
    window.scrollTo(0, 0);
    quiz = runQuiz(el, {
      app,
      heading: `Сынақ тест · ${variant}-нұсқа`,
      crumbs: `<ol class="breadcrumb"><li><a href="${BASE}" data-link>Сынақ тесттер</a></li><li aria-current="page">${variant}-нұсқа</li></ol>`,
      load: () => api.post('/api/practice/mock/start', { variant }),
      submit: (answers, paper) => api.post('/api/practice/mock/submit', { answers, token: paper.token }),
      onResult: (r, { auto }) => {
        if (!alive()) return;
        history.replaceState(null, '', `${BASE}/${r.id}`);
        el.innerHTML = resultHtml(r, { fresh: true, auto });
        checkBadges();
      },
    });
    quiz.start().catch((err) => {
      el.innerHTML = `<div class="panel error-box"><p>${esc(err.message)}</p><a class="btn btn-dark btn-sm" href="${BASE}" data-link>Артқа</a></div>`;
    });
  }

  const asked = Number(new URLSearchParams(location.search).get('start'));
  if (info.variants.some((v) => v.number === asked)) {
    history.replaceState(null, '', BASE);
    start(asked);
  } else {
    if (location.pathname !== BASE) history.replaceState(null, '', BASE);
    el.innerHTML = introHtml(info);
    el.querySelectorAll('[data-start]').forEach((b) => b.addEventListener('click', () => start(Number(b.dataset.start))));
  }
  return () => quiz?.stop();
}

export async function ubtRunView(el, [id], _app, alive) {
  const r = await api.get(`/api/practice/mock/${encodeURIComponent(id)}`);
  if (!alive()) return;
  el.innerHTML = resultHtml(r);
}
