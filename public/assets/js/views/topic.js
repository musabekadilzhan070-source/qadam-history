import { api } from '../api.js';
import { esc, renderProse, scoreBadge } from '../util.js';
import { icon } from '../art.js';

export async function topicView(el, [slug], app, alive) {
  const t = await api.get(`/api/topics/${encodeURIComponent(slug)}`);
  if (!alive()) return;
  app.setTitle(t.title);
  const testHref = `/topics/${encodeURIComponent(t.slug)}/test`;
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
          <h1>${esc(t.title)}</h1>
          <p class="range">${esc(t.range_label)}</p>
          <div class="meta"><span>${icon('clock')}${t.read_minutes} мин оқу</span><span>${icon('tests')}${t.question_count} сұрақ</span></div>
        </header>
        <div class="summary-box"><b>Қысқаша түсіндірме</b>${esc(t.summary)}</div>
        <div class="prose">${renderProse(t.body)}</div>
      </article>

      <aside class="topic-aside">
        ${
          t.question_count
            ? `<section class="panel aside-card aside-dark">
                <h2>Тақырыптық тест</h2>
                <p>${t.question_count} сұрақ. Жауаптар соңында тексеріледі, әр қатеге түсініктеме беріледі.</p>
                ${t.best_percent !== null ? `<p style="margin-top:12px">Үздік нәтижең: ${scoreBadge(t.best_percent)}</p>` : ''}
                <a class="btn btn-block" href="${testHref}" data-link>Тестті бастау ${icon('arrow', 'icon icon-arrow')}</a>
              </section>`
            : ''
        }
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
