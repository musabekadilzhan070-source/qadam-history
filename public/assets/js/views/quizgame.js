import { api } from '../api.js';
import { esc, formatDuration } from '../util.js';
import { icon } from '../art.js';
import { fileUrl, renderIcon } from '../site.js';
import { letter } from '../quiz-player.js';
import { gradeLabel } from '../catalog.js';

// Quiz: the game format. One question at a time on a dark stage, big answer cards, a progress
// bar and the question number at the top. A wrong answer shows the correct one and sends the
// question to the end of the queue; the quiz ends only when every question is answered
// correctly. The server keeps the queue, so a reload or another device continues where the
// student stopped (see server/quizgame.js).

/** «Қазақ хандығы (QUIZ)» → «Қазақ хандығы»: inside the quiz pages the format is shown by the design. */
export const quizTitle = (title) => String(title || '').replace(/\s*\(QUIZ\)\s*$/i, '');

const PRAISE = ['Дұрыс!', 'Керемет!', 'Жарайсың!', 'Тамаша!', 'Дәл таптың!'];
const HINT = {
  multiple: 'Барлық дұрыс жауапты белгіле, содан кейін «Жауап беру».',
  matching: 'Сол жақтағы элементті, содан кейін оған сәйкес келетін жауапты бас.',
  ordering: 'Оқиғаларды ең ертесінен бастап ретімен бас.',
  open: 'Жауапты өзің жаз.',
};

const periodHref = (quiz) => (quiz.period ? `/periods/${encodeURIComponent(quiz.period.slug)}?view=quiz` : '/periods');

export async function quizGameView(el, [id], app, alive) {
  const page = await api.get(`/api/quizzes/${encodeURIComponent(id)}`);
  if (!alive()) return;
  app.setTitle(`Quiz: ${quizTitle(page.quiz.title)}`);
  const game = createGame(el, app, alive);
  if (page.run) game.play(page.run);
  else game.intro(page);
  return () => game.stop();
}

/**
 * The game on a page. `opts` changes it for a quiz sent as a link (no account): how an answer
 * and a new start are sent, the line above the stage and the way back.
 */
export function createGame(el, app, alive, opts = {}) {
  const sendAnswer = opts.answer || ((s, body) => api.post(`/api/quizzes/runs/${s.run_id}/answer`, body));
  const restart = opts.restart === undefined ? (s) => api.post(`/api/quizzes/${s.quiz.id}/start`) : opts.restart;
  let state = null;
  let answer = null;
  let locked = false;
  let timer = null;
  let keyHandler = null;

  const stop = () => {
    clearTimeout(timer);
    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    keyHandler = null;
  };

  function crumbs(quiz) {
    if (opts.crumbs) return opts.crumbs(state || { quiz });
    return `<ol class="breadcrumb qg-crumbs">
      <li><a href="/periods" data-link>Тарихи кезеңдер</a></li>
      ${quiz.period ? `<li><a href="${periodHref(quiz)}" data-link>${esc(quiz.period.title)}</a></li>` : ''}
      <li aria-current="page">Quiz</li></ol>`;
  }

  function tags(quiz) {
    return [gradeLabel(quiz.grade), quiz.publisher].filter(Boolean).join(' | ');
  }

  /** Before the first start, and after a finished quiz: the rules and the last result. */
  function intro(page) {
    stop();
    const { quiz, last } = page;
    el.innerHTML = `
      ${crumbs(quiz)}
      <section class="qg qg-intro">
        <div class="qg-glow" aria-hidden="true"></div>
        <p class="qg-eyebrow">${icon('quiz')} QUIZ${tags(quiz) ? ` · ${esc(tags(quiz))}` : ''}</p>
        <h1 class="qg-title">${esc(quizTitle(quiz.title))}</h1>
        ${quiz.topic && quiz.topic.title !== quizTitle(quiz.title) ? `<p class="qg-sub">${esc(quiz.topic.title)}</p>` : ''}
        <ul class="qg-rules">
          <li><b>${quiz.question_count}</b><span>сұрақ</span></li>
          <li><b>100%</b><span>мақсат</span></li>
          <li><b>${icon('check')}</b><span>прогресс сақталады</span></li>
        </ul>
        <p class="qg-text">Әр сұраққа жауап бер. Қате жауап берген сұрақ соңында қайта беріледі. Барлық сұраққа дұрыс жауап бергенде ғана Quiz аяқталады.</p>
        ${
          last
            ? `<p class="qg-last">${icon('check')} Соңғы рет аяқталды: ${last.total} сұрақ, бірден дұрыс ${last.first_correct}, қате жауап ${last.wrong_answers}, уақыт ${formatDuration(last.duration_sec)}${page.finished_times > 1 ? ` · барлығы ${page.finished_times} рет` : ''}.</p>`
            : ''
        }
        <div class="qg-actions">
          <button type="button" class="qg-btn qg-btn-go" data-start>${last ? 'Қайта ойнау' : 'Бастау'} ${icon('arrow')}</button>
          <a class="qg-btn qg-btn-ghost" href="${periodHref(quiz)}" data-link>${icon('back')} Кезеңге оралу</a>
        </div>
      </section>`;
    el.querySelector('[data-start]').addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      try {
        play(await api.post(`/api/quizzes/${quiz.id}/start`));
      } catch (err) {
        e.currentTarget.disabled = false;
        flash(err.message);
      }
    });
  }

  function flash(message) {
    let box = el.querySelector('.qg-toast');
    if (!box) {
      box = document.createElement('div');
      box.className = 'qg-toast';
      box.setAttribute('role', 'status');
      el.append(box);
    }
    box.textContent = message;
    box.classList.add('is-on');
    setTimeout(() => box.classList.remove('is-on'), 2600);
  }

  // ─── The stage ───────────────────────────────────────────────
  function play(next) {
    stop();
    state = next;
    if (state.finished) return finish();
    const q = state.question;
    answer = q.type === 'matching' ? {} : q.type === 'open' ? '' : [];
    locked = false;
    const counter =
      state.phase === 'main'
        ? `Сұрақ <b>${state.number}</b> / ${state.total}`
        : `<span class="qg-repeat-tag">↻ Қайталау</span> ${state.to_repeat} сұрақ қалды`;
    const pct = state.total ? Math.round((state.done / state.total) * 100) : 0;
    el.innerHTML = `
      ${crumbs(state.quiz)}
      <section class="qg qg-play ${state.phase === 'repeat' ? 'is-repeat' : ''}" aria-live="polite">
        <header class="qg-top">
          <div class="qg-top-row">
            <span class="qg-counter">${counter}</span>
            <span class="qg-name">${esc(quizTitle(state.quiz.title))}</span>
            <span class="qg-score" title="Дұрыс жауап берілген сұрақтар">${icon('check')} ${state.done} / ${state.total}</span>
          </div>
          <div class="qg-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Жалпы прогресс">
            <i style="width:${pct}%"></i>
          </div>
          <div class="qg-top-row qg-top-sub">
            <span>${pct}% орындалды</span>
            ${state.to_repeat ? `<span class="qg-pending">↻ ${state.to_repeat} сұрақ қайталанады</span>` : '<span></span>'}
          </div>
        </header>
        <div class="qg-card" data-card>
          ${q.context ? contextHtml(q.context) : ''}
          <h2 class="qg-question">${esc(q.text)}</h2>
          ${q.image_id ? `<img class="qg-image" src="${fileUrl(q.image_id)}" alt="Сұрақтың суреті" />` : ''}
          ${hintFor(q) ? `<p class="qg-hint">${hintFor(q)}</p>` : ''}
        </div>
        <div class="qg-answers" data-answers>${answersHtml(q)}</div>
        <div class="qg-foot" data-foot>${footHtml(q)}</div>
        <div class="qg-feedback" data-feedback hidden></div>
      </section>`;
    wire(q);
    el.querySelector('.qg-play')?.scrollIntoView?.({ block: 'start', behavior: 'instant' });
  }

  const hintFor = (q) => (q.type === 'multiple' || q.multiple ? HINT.multiple : HINT[q.type] || '');

  function contextHtml(c) {
    return `<details class="qg-context" open>
      <summary>Контекст${c.title ? `: ${esc(c.title)}` : ''}</summary>
      ${c.image_id ? `<img class="qg-image" src="${fileUrl(c.image_id)}" alt="Контекст суреті" />` : ''}
      ${c.body ? `<div class="qg-context-text">${esc(c.body).replace(/\n/g, '<br />')}</div>` : ''}
    </details>`;
  }

  function answersHtml(q) {
    if (q.type === 'matching') {
      return `<div class="qg-match">
        <ol class="qg-match-left">${q.left.map((l, i) => `<li><button type="button" class="qg-chip-left" data-left="${esc(l.key)}"><b>${i + 1}</b><span>${esc(l.text)}</span><i data-pick></i></button></li>`).join('')}</ol>
        <ul class="qg-match-right">${q.right.map((r, i) => `<li><button type="button" class="qg-opt qg-opt-${i % 4}" data-right="${esc(r.key)}"><span class="qg-letter">${letter(i)}</span><span class="qg-opt-text">${esc(r.text)}</span><i data-badge></i></button></li>`).join('')}</ul>
      </div>`;
    }
    if (q.type === 'ordering') {
      return `<ul class="qg-order">${q.items
        .map((it, i) => `<li><button type="button" class="qg-opt qg-opt-${i % 4}" data-item="${esc(it.key)}"><span class="qg-letter" data-rank>·</span><span class="qg-opt-text">${esc(it.text)}</span></button></li>`)
        .join('')}</ul>`;
    }
    if (q.type === 'open') {
      return `<form class="qg-open" data-open-form><input class="qg-input" data-open maxlength="300" autocomplete="off" placeholder="Жауабыңды жаз" aria-label="Жауап" /></form>`;
    }
    const multi = q.multiple;
    return `<ul class="qg-options ${q.options.length > 4 ? 'is-many' : ''}">${q.options
      .map(
        (o, i) => `<li><button type="button" class="qg-opt qg-opt-${i % 4}" data-option="${o.id}" ${multi ? 'aria-pressed="false"' : ''}>
          <span class="qg-letter">${multi ? '<i class="qg-box"></i>' : letter(i)}</span>
          ${o.image_id ? `<img class="qg-opt-image" src="${fileUrl(o.image_id)}" alt="" />` : ''}
          <span class="qg-opt-text">${esc(o.text)}</span></button></li>`,
      )
      .join('')}</ul>`;
  }

  function footHtml(q) {
    if (q.type === 'single' || q.type === 'image') return q.multiple ? submitBtn() : '<p class="qg-tip">Жауапты бас</p>';
    return `${q.type === 'ordering' || q.type === 'matching' ? '<button type="button" class="qg-btn qg-btn-ghost" data-clear>Тазалау</button>' : ''}${submitBtn()}`;
  }
  const submitBtn = () => `<button type="button" class="qg-btn qg-btn-go" data-submit disabled>Жауап беру ${icon('arrow')}</button>`;

  function ready(q) {
    if (q.type === 'open') return Boolean(String(answer).trim());
    if (q.type === 'matching') return q.left.every((l) => answer[l.key]);
    if (q.type === 'ordering') return answer.length === q.items.length;
    return answer.length > 0;
  }
  function refreshSubmit(q) {
    const b = el.querySelector('[data-submit]');
    if (b) b.disabled = !ready(q) || locked;
  }

  function wire(q) {
    const box = el.querySelector('[data-answers]');
    const foot = el.querySelector('[data-foot]');
    let activeLeft = q.type === 'matching' ? q.left[0]?.key : null;

    const paintMatching = () => {
      const number = new Map(q.left.map((l, i) => [l.key, i + 1]));
      const rightLetter = new Map(q.right.map((r, i) => [r.key, letter(i)]));
      box.querySelectorAll('[data-left]').forEach((b) => {
        const k = b.dataset.left;
        b.classList.toggle('is-active', k === activeLeft);
        b.classList.toggle('is-set', Boolean(answer[k]));
        b.querySelector('[data-pick]').textContent = answer[k] ? rightLetter.get(answer[k]) : '';
      });
      box.querySelectorAll('[data-right]').forEach((b) => {
        const owner = Object.keys(answer).find((k) => answer[k] === b.dataset.right);
        b.classList.toggle('is-set', Boolean(owner));
        b.querySelector('[data-badge]').textContent = owner ? number.get(owner) : '';
      });
    };
    const paintOrdering = () => {
      box.querySelectorAll('[data-item]').forEach((b) => {
        const i = answer.indexOf(b.dataset.item);
        b.classList.toggle('is-set', i >= 0);
        b.querySelector('[data-rank]').textContent = i >= 0 ? String(i + 1) : '·';
      });
    };

    box.addEventListener('click', (e) => {
      if (locked) return;
      const opt = e.target.closest('[data-option]');
      if (opt) {
        const oid = Number(opt.dataset.option);
        if (!q.multiple) {
          answer = [oid];
          opt.classList.add('is-chosen');
          return submit(q);
        }
        answer = answer.includes(oid) ? answer.filter((x) => x !== oid) : [...answer, oid];
        opt.setAttribute('aria-pressed', String(answer.includes(oid)));
        opt.classList.toggle('is-chosen', answer.includes(oid));
        return refreshSubmit(q);
      }
      const left = e.target.closest('[data-left]');
      if (left) {
        const k = left.dataset.left;
        // Tapping a paired element again frees it.
        if (answer[k] && activeLeft === k) delete answer[k];
        activeLeft = k;
        paintMatching();
        return refreshSubmit(q);
      }
      const right = e.target.closest('[data-right]');
      if (right) {
        const r = right.dataset.right;
        if (!activeLeft) activeLeft = q.left.find((l) => !answer[l.key])?.key || q.left[0].key;
        for (const k of Object.keys(answer)) if (answer[k] === r) delete answer[k];
        answer[activeLeft] = r;
        activeLeft = q.left.find((l) => !answer[l.key])?.key || null;
        paintMatching();
        return refreshSubmit(q);
      }
      const item = e.target.closest('[data-item]');
      if (item) {
        const k = item.dataset.item;
        answer = answer.includes(k) ? answer.filter((x) => x !== k) : [...answer, k];
        paintOrdering();
        return refreshSubmit(q);
      }
    });
    box.addEventListener('input', (e) => {
      if (e.target.matches('[data-open]')) {
        answer = e.target.value;
        refreshSubmit(q);
      }
    });
    box.querySelector('[data-open-form]')?.addEventListener('submit', (e) => {
      e.preventDefault();
      if (ready(q) && !locked) submit(q);
    });
    foot.addEventListener('click', (e) => {
      if (e.target.closest('[data-submit]') && ready(q) && !locked) return submit(q);
      if (e.target.closest('[data-clear]') && !locked) {
        answer = q.type === 'matching' ? {} : [];
        activeLeft = q.type === 'matching' ? q.left[0]?.key : null;
        if (q.type === 'matching') paintMatching();
        else paintOrdering();
        refreshSubmit(q);
      }
    });
    if (q.type === 'matching') paintMatching();
    if (q.type === 'open') box.querySelector('[data-open]')?.focus({ preventScroll: true });

    // Keys 1–9 answer a one-answer question; Enter sends the others.
    keyHandler = (e) => {
      if (locked || e.altKey || e.ctrlKey || e.metaKey || e.target.matches?.('input, textarea')) return;
      if ((q.type === 'single' || q.type === 'image') && !q.multiple && /^[1-9]$/.test(e.key)) {
        box.querySelectorAll('[data-option]')[Number(e.key) - 1]?.click();
      } else if (e.key === 'Enter' && ready(q)) submit(q);
    };
    document.addEventListener('keydown', keyHandler);
  }

  async function submit(q) {
    if (locked) return;
    locked = true;
    refreshSubmit(q);
    el.querySelector('.qg-play')?.classList.add('is-busy');
    let res;
    try {
      res = await sendAnswer(state, { question_id: q.id, version: state.version, answer });
    } catch (err) {
      if (!alive()) return;
      // The run moved on elsewhere (another tab, a double tap): show where it is now.
      if (err.status === 409 && err.data?.state) {
        flash(err.message);
        return play(err.data.state);
      }
      locked = false;
      el.querySelector('.qg-play')?.classList.remove('is-busy');
      el.querySelectorAll('.is-chosen').forEach((b) => !q.multiple && b.classList.remove('is-chosen'));
      refreshSubmit(q);
      return flash(err.message);
    }
    if (!alive()) return;
    el.querySelector('.qg-play')?.classList.remove('is-busy');
    showFeedback(q, res);
  }

  function showFeedback(q, res) {
    const stage = el.querySelector('.qg-play');
    const fb = el.querySelector('[data-feedback]');
    const f = res.feedback;
    // Mark the cards: the right options green, a wrong choice red.
    if (f.correct_option_ids) {
      el.querySelectorAll('[data-option]').forEach((b) => {
        const oid = Number(b.dataset.option);
        b.classList.toggle('is-right', f.correct_option_ids.includes(oid));
        b.classList.toggle('is-wrong', (f.chosen_option_ids || []).includes(oid) && !f.correct_option_ids.includes(oid));
        b.disabled = true;
      });
    }
    el.querySelectorAll('[data-answers] button, [data-foot] button, [data-open]').forEach((b) => {
      b.disabled = true;
    });
    stage.classList.add(res.correct ? 'is-correct' : 'is-incorrect');
    if (res.correct) {
      fb.innerHTML = `<div class="qg-verdict qg-verdict-ok"><span class="qg-burst" aria-hidden="true">${'<i></i>'.repeat(12)}</span>
        <b>${icon('check')} ${PRAISE[Math.floor(Math.random() * PRAISE.length)]}</b>
        ${f.explanation ? `<p>${esc(f.explanation)}</p>` : ''}</div>
        <button type="button" class="qg-btn qg-btn-go" data-next>Келесі ${icon('arrow')}</button>`;
    } else {
      fb.innerHTML = `<div class="qg-verdict qg-verdict-bad">
        <b>${icon('cross')} Қате жауап</b>
        <p>Бұл сұрақ соңында қайта беріледі.</p>
        ${correctHtml(q, f)}
        ${f.explanation ? `<p class="qg-why"><b>Түсініктеме:</b> ${esc(f.explanation)}</p>` : ''}</div>
        <button type="button" class="qg-btn qg-btn-go" data-next>Түсіндім, келесі ${icon('arrow')}</button>`;
    }
    fb.hidden = false;
    el.querySelector('[data-foot]').hidden = true;
    const go = () => {
      clearTimeout(timer);
      play(res.state);
    };
    const nextBtn = fb.querySelector('[data-next]');
    nextBtn.addEventListener('click', go);
    nextBtn.focus({ preventScroll: true });
    fb.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    keyHandler = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        go();
      }
    };
    setTimeout(() => keyHandler && document.addEventListener('keydown', keyHandler), 150);
    // A right answer moves on by itself after the short celebration.
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (res.correct && !f.explanation) timer = setTimeout(go, reduced ? 1400 : 1100);
  }

  /** The correct answer after a wrong one, for every format. */
  function correctHtml(q, f) {
    if (f.correct_option_ids && f.options) {
      const right = f.options.filter((o) => f.correct_option_ids.includes(o.id));
      return `<p class="qg-right"><span>Дұрыс жауап${right.length > 1 ? 'тар' : ''}:</span> ${right.map((o) => `<b>${esc(o.text)}</b>`).join(', ')}</p>`;
    }
    if (f.pairs) {
      return `<ul class="qg-right-list">${f.pairs
        .map((p) => `<li class="${p.ok ? 'ok' : 'bad'}">${p.ok ? icon('check') : icon('cross')}<span>${esc(p.left)}</span><b>→ ${esc(p.right)}</b></li>`)
        .join('')}</ul>`;
    }
    if (f.correct_order) {
      return `<p class="qg-right"><span>Дұрыс реті:</span></p><ol class="qg-right-list qg-right-order">${f.correct_order
        .map((i) => `<li><b>${esc(i.text)}</b>${i.date ? `<small>${esc(i.date)}</small>` : ''}</li>`)
        .join('')}</ol>`;
    }
    if (f.accepted) return `<p class="qg-right"><span>Дұрыс жауап:</span> ${f.accepted.map((a) => `<b>${esc(a)}</b>`).join(' немесе ')}</p>`;
    return '';
  }

  // ─── The end ─────────────────────────────────────────────────
  function finish() {
    stop();
    const s = state;
    el.innerHTML = `
      ${crumbs(s.quiz)}
      <section class="qg qg-done" aria-live="polite">
        <span class="qg-confetti" aria-hidden="true">${'<i></i>'.repeat(28)}</span>
        <p class="qg-eyebrow">${icon('quiz')} QUIZ аяқталды</p>
        <h1 class="qg-title">🎉 КЕРЕМЕТ НӘТИЖЕ!</h1>
        <p class="qg-text">Сен барлық сұраққа дұрыс жауап бердің!</p>
        <p class="qg-hundred">100% <span>нәтиже!</span></p>
        <p class="qg-sub">${esc(quizTitle(s.quiz.title))}</p>
        <ul class="qg-stats">
          <li><b>${s.total}</b><span>Жалпы сұрақ саны</span></li>
          <li><b>${s.first_correct}</b><span>Бірден дұрыс</span></li>
          <li><b>${s.repeated}</b><span>Қайталап жауап берген сұрақ</span></li>
          <li><b>${s.wrong_answers}</b><span>Жалпы қате жауап</span></li>
          <li><b>${formatDuration(s.duration_sec)}</b><span>Кеткен уақыт</span></li>
        </ul>
        <div class="qg-actions">
          ${s.next ? `<a class="qg-btn qg-btn-go" href="/quiz/${s.next.id}" data-link>Келесі Quiz: ${esc(quizTitle(s.next.title))} ${icon('arrow')}</a>` : ''}
          ${restart ? `<button type="button" class="qg-btn ${s.next ? 'qg-btn-ghost' : 'qg-btn-go'}" data-again>Қайта ойнау</button>` : ''}
          ${opts.endLinks ? opts.endLinks(s) : `<a class="qg-btn qg-btn-ghost" href="${periodHref(s.quiz)}" data-link>${icon('back')} Барлық Quiz</a>`}
        </div>
      </section>`;
    el.querySelector('[data-again]')?.addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      try {
        play(await restart(s));
      } catch (err) {
        e.currentTarget.disabled = false;
        flash(err.message);
      }
    });
    app.setTitle(`Quiz аяқталды: ${quizTitle(s.quiz.title)}`);
  }

  return { intro, play, stop };
}

/** A quiz on the period and book pages: dark game card with the student's progress. */
export function quizCard(t) {
  const progress = t.in_progress;
  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const tagsLine = [gradeLabel(t.grade), t.publisher].filter(Boolean).join(' | ');
  return `
    <article class="qg-tile">
      <div class="qg-tile-top">
        <span class="qg-tile-tag">${icon('quiz')} QUIZ</span>
        ${t.finished_times ? `<span class="qg-tile-done">${icon('check')} 100%</span>` : ''}
      </div>
      <span class="qg-tile-emblem" aria-hidden="true">${t.topic_icon ? renderIcon(t.topic_icon, null, 'icon') : icon('quiz')}</span>
      ${tagsLine ? `<p class="qg-tile-tags">${esc(tagsLine)}</p>` : ''}
      <h3>${esc(quizTitle(t.title))}</h3>
      ${quizTitle(t.title) !== t.topic_title && t.topic_title ? `<p class="qg-tile-sub">${esc(t.topic_title)}</p>` : ''}
      <p class="qg-tile-meta">${t.question_count} сұрақ${t.finished_times ? ` · ${t.finished_times} рет аяқталды` : ''}</p>
      ${progress ? `<div class="qg-tile-bar" aria-label="Прогресс ${pct}%"><i style="width:${pct}%"></i></div><p class="qg-tile-meta">${progress.done} / ${progress.total} дұрыс</p>` : ''}
      <a class="qg-btn qg-btn-go qg-btn-sm" href="/quiz/${t.id}" data-link>${progress ? 'Жалғастыру' : t.finished_times ? 'Қайта ойнау' : 'Бастау'} ${icon('arrow')}</a>
    </article>`;
}
