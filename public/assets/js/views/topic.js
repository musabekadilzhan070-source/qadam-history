import { api } from '../api.js';
import { esc, renderProse, scoreBadge } from '../util.js';
import { icon } from '../art.js';
import { fileUrl, renderIcon } from '../site.js';

const personCard = (p) => `
  <article class="panel person-card">
    ${p.image_id ? `<img class="person-photo" src="${fileUrl(p.image_id)}" alt="${esc(p.name)}" loading="lazy" />` : ''}
    <div>
      <h3>${esc(p.name)}</h3>
      ${p.role || p.reign ? `<p class="range">${esc([p.role, p.reign].filter(Boolean).join(' · '))}</p>` : ''}
      ${p.biography ? `<div class="prose">${renderProse(p.biography)}</div>` : ''}
      ${p.facts.length ? `<ul class="key-list">${p.facts.map((f) => `<li><span>${esc(f)}</span></li>`).join('')}</ul>` : ''}
    </div>
  </article>`;


export async function topicView(el, [slug], app, alive) {
  const t = await api.get(`/api/topics/${encodeURIComponent(slug)}`);
  if (!alive()) return;
  app.setTitle(t.title);
  el.innerHTML = `
    <ol class="breadcrumb">
      <li><a href="/periods" data-link>Тарихи кезеңдер</a></li>
      <li><a href="/periods/${encodeURIComponent(t.period_slug)}" data-link>${esc(t.period_title)}</a></li>
      <li aria-current="page">${esc(t.title)}</li>
    </ol>
    <div class="topic-layout">
      <article class="panel article">
        <header class="article-head">
          <p class="eyebrow">${esc(t.period_title)}</p>
          <h1>${t.icon ? renderIcon(t.icon, null, 'icon topic-icon') : ''}${esc(t.title)}</h1>
          <p class="range">${esc(t.range_label)}</p>
          <div class="meta"><span>${icon('clock')}${t.read_minutes} мин оқу</span><span>${icon('tests')}${t.question_count} сұрақ</span></div>
        </header>
        ${t.image_id ? `<img class="topic-photo" src="${fileUrl(t.image_id)}" alt="${esc(t.title)}" />` : ''}
        <div class="summary-box"><b>Қысқаша түсіндірме</b>${esc(t.summary)}</div>
        <div class="prose">${renderProse(t.body)}</div>
        ${
          t.persons.length
            ? `<section class="topic-extra"><h2 class="section-title">Тарихи тұлғалар</h2>${t.persons.map(personCard).join('')}</section>`
            : ''
        }
      </article>

      <aside class="topic-aside">
        ${t.tests
          .map(
            (x) => `<section class="panel aside-card aside-dark">
                <h2>${t.tests.length > 1 || x.title !== t.title ? esc(x.title) : 'Тақырыптық тест'}</h2>
                ${x.description ? `<p>${esc(x.description)}</p>` : ''}
                <p>${x.question_count} сұрақ${x.time_limit_min ? ` · ${x.time_limit_min} минут` : ''}. Жауаптар соңында тексеріледі, әр қатеге түсініктеме беріледі.</p>
                ${x.best_percent !== null ? `<p style="margin-top:12px">Үздік нәтижең: ${scoreBadge(x.best_percent)}</p>` : ''}
                <a class="btn btn-block" href="/tests/${x.id}" data-link>Тестті бастау ${icon('arrow', 'icon icon-arrow')}</a>
              </section>`,
          )
          .join('')}
        ${
          t.key_points.length
            ? `<section class="panel aside-card">
                <h2>Есте сақта</h2>
                <ul class="key-list">${t.key_points.map((k) => `<li><b>${esc(k.label)}</b><span>${esc(k.text)}</span></li>`).join('')}</ul>
              </section>`
            : ''
        }
      </aside>
    </div>
    <nav class="pager" aria-label="Тақырыптар арасында өту">
      ${t.prev ? `<a class="panel prev" href="/topics/${encodeURIComponent(t.prev.slug)}" data-link><small>← Алдыңғы тақырып</small><b>${esc(t.prev.title)}</b></a>` : '<span></span>'}
      ${t.next ? `<a class="panel next" href="/topics/${encodeURIComponent(t.next.slug)}" data-link><small>Келесі тақырып →</small><b>${esc(t.next.title)}</b></a>` : ''}
    </nav>`;
}
