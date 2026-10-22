import { api } from '../api.js';
import { esc, pad2, scoreBadge, formatDate } from '../util.js';
import { icon, bannerArt, ornamentBand, ornamentMark } from '../art.js';
import { periodCard, testCard } from '../components.js';
import { site, fileUrl } from '../site.js';

function progressPanel(user, periods, results) {
  if (!user) {
    return `
    <section class="panel aside-card aside-dark">
      ${ornamentMark('aside-orn')}
      <h2>Нәтижеңді сақта</h2>
      <p>Аккаунтқа кірсең, әр тест нәтижесі сақталып, қай тақырыпты қайталау керегін көресің.</p>
      <a class="btn btn-block" href="/register" data-link>Тіркелу</a>
      <a class="btn btn-ghost-light btn-block" href="/login" data-link style="margin-top:10px">Кіру</a>
    </section>`;
  }
  const s = results.summary;
  return `
  <section class="panel aside-card aside-dark">
    ${ornamentMark('aside-orn')}
    <h2>Менің прогресім</h2>
    <div class="stat-row">
      <div><b>${s.tests_done}</b><span>тест</span></div>
      <div><b>${s.attempts}</b><span>әрекет</span></div>
      <div><b>${s.average_percent ?? '—'}${s.average_percent !== null ? '%' : ''}</b><span>орташа</span></div>
    </div>
    <div class="period-progress">
      ${periods
        .map((p) => {
          const pct = p.test_count ? Math.round((p.tests_done / p.test_count) * 100) : 0;
          return `<div><span>${esc(p.title)} <em>${p.tests_done}/${p.test_count}</em></span>
            <div class="progress" role="img" aria-label="${pct}%"><i style="width:${pct}%"></i></div></div>`;
        })
        .join('')}
    </div>
  </section>`;
}

function recentPanel(user, results) {
  if (!user || !results.attempts.length) return '';
  return `
  <section class="panel aside-card">
    <h2>Соңғы нәтижелер <a class="link-more" href="/results" data-link>Барлығы</a></h2>
    <ul class="mini-list">
      ${results.attempts
        .slice(0, 4)
        .map(
          (a) => `<li><a href="/results/${a.id}" data-link>
            <span class="mini-num">${pad2(a.period_number)}</span>
            <span class="mini-body"><b>${esc(a.topic_title)}</b><span>${esc(formatDate(a.created_at))}</span></span>
            ${scoreBadge(a.percent)}</a></li>`,
        )
        .join('')}
    </ul>
  </section>`;
}

function platformPanel(totals) {
  return `
  <section class="panel aside-card">
    <h2>QADAM-да</h2>
    <div class="stat-row">
      <div><b>${totals.topics}</b><span>тақырып</span></div>
      <div><b>${totals.tests}</b><span>тест</span></div>
      <div><b>${totals.questions}</b><span>сұрақ</span></div>
    </div>
  </section>`;
}

export async function homeView(el, _params, app, alive) {
  const [overview, results] = await Promise.all([
    api.get('/api/overview'),
    app.user ? api.get('/api/results').catch(() => null) : null,
  ]);
  if (!alive()) return;
  const { periods, totals, tests } = overview;
  // Newest tests first: the organizer's latest published tests show up here.
  const latest = [...tests].sort((a, b) => b.id - a.id).slice(0, 3);
  el.innerHTML = `
  <div class="home">
    <div class="home-main">
      <section class="banner" aria-labelledby="banner-title">
        ${site.texts.banner_image_id ? `<img class="banner-photo" src="${fileUrl(site.texts.banner_image_id)}" alt="" />` : bannerArt()}
        <p class="banner-kicker">${ornamentMark()}${site.t('banner_kicker')}</p>
        <h1 id="banner-title"><span>${site.t('banner_line1')}</span><span>${site.t('banner_line2')}</span><span class="accent">${site.t('banner_line3')}</span></h1>
        <p>${site.t('banner_text')}</p>
        <div class="banner-actions">
          <a class="btn" href="/periods" data-link>${site.t('banner_button')} ${icon('arrow', 'icon icon-arrow')}</a>
        </div>
        ${ornamentBand('banner-band')}
      </section>

      <section class="section" aria-labelledby="periods-title">
        <div class="section-head">
          <div>
            <p class="eyebrow">${site.t('periods_eyebrow')}</p>
            <h2 class="section-title" id="periods-title">${site.t('periods_title')}</h2>
          </div>
          <a class="link-more" href="/periods" data-link>${site.t('periods_more')} ${icon('arrow')}</a>
        </div>
        <div class="period-grid">${periods.map(periodCard).join('')}</div>
      </section>

      ${
        latest.length
          ? `<section class="section" aria-labelledby="tests-title">
        <div class="section-head">
          <div>
            <p class="eyebrow">Білімді тексер</p>
            <h2 class="section-title" id="tests-title">Жаңа тесттер</h2>
          </div>
          <a class="link-more" href="/tests" data-link>Барлық тесттер ${icon('arrow')}</a>
        </div>
        <div class="card-grid">${latest.map(testCard).join('')}</div>
      </section>`
          : ''
      }

      <section class="section" aria-labelledby="how-title">
        <div class="section-head">
          <div>
            <p class="eyebrow">${site.t('how_eyebrow')}</p>
            <h2 class="section-title" id="how-title">${site.t('how_title')}</h2>
          </div>
        </div>
        <ol class="steps">
          ${[1, 2, 3].map((n) => `<li class="panel step"><h3>${site.t(`step${n}_title`)}</h3><p>${site.t(`step${n}_text`)}</p></li>`).join('')}
        </ol>
      </section>
    </div>

    <aside class="home-aside" aria-label="Прогресс">
      ${progressPanel(app.user, periods, results)}
      ${recentPanel(app.user, results)}
      ${platformPanel(totals)}
    </aside>
  </div>`;
}
