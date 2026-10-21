import { org } from './api.js';
import { letter } from '../views/review.js';
import {
  esc, icon, toast, dialog, confirmDialog, statusBadge, select, fileField, bindFileFields, busy, moved, topicOptions, topicTitle, fileSrc,
} from './ui.js';

// ─── List ────────────────────────────────────────────────────────
async function createTest(ctx, topicId = '') {
  let values = { title: '', topic_id: topicId };
  const ok = await dialog({
    title: 'Жаңа тест',
    body: `<label class="o-field"><span class="o-label">Тест атауы <i>*</i></span><input id="nt-title" maxlength="160" /></label>
      ${select({ name: 'nt-topic', label: 'Тақырып', value: topicId, options: topicOptions(ctx.state, { empty: '— Тақырыпты таңдаңыз —' }), required: true })}`,
    buttons: [
      { label: 'Болдырмау', value: false, kind: 'ghost' },
      { label: 'Құру', value: true, kind: 'primary' },
    ],
    onOpen(box) {
      box.querySelector('#nt-title').focus();
      box.addEventListener('input', () => {
        values = { title: box.querySelector('#nt-title').value, topic_id: box.querySelector('[name="nt-topic"]').value };
      });
      box.addEventListener('change', () => {
        values = { title: box.querySelector('#nt-title').value, topic_id: box.querySelector('[name="nt-topic"]').value };
      });
    },
  });
  if (!ok) return;
  if (!values.title.trim()) return toast('Тест атауын жазыңыз.', 'error');
  if (!values.topic_id) return toast('Тестті тақырыпқа байланыстырыңыз.', 'error');
  try {
    const r = await org.post('/tests', { title: values.title, topic_id: Number(values.topic_id), published: false });
    toast('Тест құрылды. Енді сұрақтарды қосыңыз.');
    ctx.navigate(`/organizer/tests/${r.id}`);
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function deleteTest(ctx, test) {
  if (!(await confirmDialog('Тестті жою', `«${test.title}» тесті барлық сұрақтарымен бірге жойылады. Оқушылардың бұрынғы нәтижелері сақталады.`, { ok: 'Жою', danger: true }))) {
    return false;
  }
  try {
    await org.del(`/tests/${test.id}`);
    toast('Тест жойылды.');
    return true;
  } catch (err) {
    toast(err.message, 'error');
    return false;
  }
}

export function testsView(el, _params, ctx) {
  const draw = () => {
    const s = ctx.state;
    const groups = [
      ...s.periods.flatMap((p) => s.topics.filter((t) => t.period_id === p.id).map((t) => ({ id: t.id, title: t.title, sub: p.title }))),
      { id: null, title: 'Тақырыпқа байланыспаған тесттер', sub: 'Оқушыларға көрінбейді' },
    ]
      .map((g) => ({ ...g, tests: s.tests.filter((x) => x.topic_id === g.id) }))
      .filter((g) => g.tests.length || g.id !== null);
    el.innerHTML = `
      <div class="o-toolbar"><button type="button" class="btn" data-new>+ Жаңа тест</button></div>
      ${groups
        .map(
          (g) => `<section class="o-card o-card-tight">
            <div class="o-card-head"><div><p class="eyebrow">${esc(g.sub)}</p><h2>${esc(g.title)}</h2></div>
              ${g.id ? `<button type="button" class="btn btn-ghost btn-sm" data-new="${g.id}">+ Тест</button>` : ''}</div>
            ${
              g.tests.length
                ? `<ol class="o-rows">${g.tests
                    .map(
                      (x, i) => `<li class="o-row" data-id="${x.id}">
                        <div class="o-order">
                          <button type="button" class="o-icon-btn" data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="Жоғары">▲</button>
                          <button type="button" class="o-icon-btn" data-act="down" ${i === g.tests.length - 1 ? 'disabled' : ''} aria-label="Төмен">▼</button>
                        </div>
                        <span class="o-row-icon">${icon('tests')}</span>
                        <div class="o-row-body"><a href="/organizer/tests/${x.id}" data-link><b>${esc(x.title)}</b></a>
                          <small>${x.question_count} сұрақ${x.missing_correct ? ` · <span class="o-warn">${x.missing_correct} сұрақта дұрыс жауап белгіленбеген</span>` : ''}</small></div>
                        ${statusBadge(x.published)}
                        <div class="o-row-actions">
                          <a class="btn btn-ghost btn-sm" href="/organizer/tests/${x.id}" data-link>Өңдеу</a>
                          <button type="button" class="btn btn-ghost btn-sm" data-act="toggle">${x.published ? 'Жасыру' : 'Жариялау'}</button>
                          <button type="button" class="o-icon-btn o-danger" data-act="delete" aria-label="Жою" title="Жою">${icon('cross')}</button>
                        </div>
                      </li>`,
                    )
                    .join('')}</ol>`
                : '<p class="o-muted">Бұл тақырыпта тест жоқ.</p>'
            }
          </section>`,
        )
        .join('')}`;
  };
  el.addEventListener('click', async (e) => {
    const nb = e.target.closest('[data-new]');
    if (nb) return createTest(ctx, nb.dataset.new || '');
    const row = e.target.closest('.o-row');
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!row || !act) return;
    const x = ctx.state.tests.find((t) => t.id === Number(row.dataset.id));
    try {
      if (act === 'up' || act === 'down') {
        const list = ctx.state.tests.filter((t) => t.topic_id === x.topic_id);
        await org.post('/tests/reorder', { ids: moved(list, list.indexOf(x), act === 'up' ? -1 : 1).map((t) => t.id) });
      } else if (act === 'toggle') {
        if (!x.topic_id && !x.published) return toast('Алдымен тестті тақырыпқа байланыстырыңыз (тестті өңдеу бетінде).', 'error');
        const full = await org.get(`/tests/${x.id}`);
        await org.put(`/tests/${x.id}`, { ...full, published: !x.published });
        toast(x.published ? 'Тест жасырылды.' : 'Тест жарияланатын болып белгіленді.');
      } else if (act === 'delete') {
        if (!(await deleteTest(ctx, x))) return;
      }
      await ctx.reload();
      draw();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  draw();
}

// ─── Editor ──────────────────────────────────────────────────────
const blankOption = () => ({ text: '', image_id: null, is_correct: false });
const blankQuestion = () => ({ text: '', explanation: '', image_id: null, options: [blankOption(), blankOption(), blankOption(), blankOption()] });

/** Problems that keep a question from students, by question index. */
function problems(q) {
  const out = [];
  if (!q.text.trim()) out.push('сұрақ мәтіні жазылмаған');
  const filled = q.options.filter((o) => o.text.trim() || o.image_id);
  if (q.options.length < 2) out.push('кемінде екі жауап нұсқасы керек');
  else if (filled.length < q.options.length) out.push('бос жауап нұсқасы бар');
  if (!q.options.some((o) => o.is_correct)) out.push('дұрыс жауап белгіленбеген');
  return out;
}

export async function testEditView(el, [id], ctx, alive) {
  let test = await org.get(`/tests/${id}`);
  if (!alive()) return;
  let dirty = false;
  ctx.setDirtyCheck(() => dirty);

  const questionCard = (q, qi, total) => {
    const issues = problems(q);
    const multiple = q.options.filter((o) => o.is_correct).length > 1;
    return `
    <li class="o-card o-q${issues.length ? ' has-problem' : ''}" data-q="${qi}">
      <div class="o-q-head">
        <span class="o-q-num">${qi + 1}</span>
        <b>Сұрақ ${qi + 1}</b>
        ${multiple ? '<span class="o-badge o-badge-on">Бірнеше дұрыс жауап</span>' : ''}
        <div class="o-row-actions">
          <button type="button" class="o-icon-btn" data-qact="up" ${qi === 0 ? 'disabled' : ''} aria-label="Жоғары">▲</button>
          <button type="button" class="o-icon-btn" data-qact="down" ${qi === total - 1 ? 'disabled' : ''} aria-label="Төмен">▼</button>
          <button type="button" class="o-icon-btn o-danger" data-qact="delete" aria-label="Сұрақты жою" title="Сұрақты жою">${icon('cross')}</button>
        </div>
      </div>
      ${issues.length ? `<p class="o-q-issue">${icon('cross')}${esc(issues.join(', '))}</p>` : ''}
      <label class="o-field"><span class="o-label">Сұрақ мәтіні <i>*</i></span><textarea rows="2" maxlength="2000" data-field="text">${esc(q.text)}</textarea></label>
      ${fileField({ name: `q${qi}-image`, kind: 'image', value: q.image_id, label: 'Сұрақ суреті (міндетті емес)' })}
      <div class="o-field"><span class="o-label">Жауап нұсқалары <small>· дұрыс жауапты белгілеңіз, бірнешеуін белгілеуге болады</small></span>
        <ol class="o-opts">
          ${q.options
            .map(
              (o, oi) => `<li class="o-opt${o.is_correct ? ' is-correct' : ''}" data-o="${oi}">
                <label class="o-correct" title="Дұрыс жауап"><input type="checkbox" data-field="is_correct" ${o.is_correct ? 'checked' : ''} /><span>${letter(oi)}</span></label>
                <input class="o-opt-text" maxlength="500" data-field="otext" value="${esc(o.text)}" placeholder="${oi + 1}-жауап" />
                ${fileField({ name: `q${qi}o${oi}-image`, kind: 'image', value: o.image_id, label: 'Жауапқа сурет қосу', compact: true })}
                <button type="button" class="o-icon-btn" data-oact="up" ${oi === 0 ? 'disabled' : ''} aria-label="Жоғары">▲</button>
                <button type="button" class="o-icon-btn o-danger" data-oact="delete" aria-label="Жауапты жою" title="Жауапты жою">${icon('cross')}</button>
              </li>`,
            )
            .join('')}
        </ol>
        ${q.options.length < 10 ? '<button type="button" class="btn btn-ghost btn-sm" data-qact="add-option">+ Жауап нұсқасын қосу</button>' : ''}
      </div>
      <label class="o-field"><span class="o-label">Түсініктеме (тест соңында көрсетіледі)</span><textarea rows="2" maxlength="2000" data-field="explanation">${esc(q.explanation || '')}</textarea></label>
    </li>`;
  };

  const draw = () => {
    const s = ctx.state;
    const bad = test.questions.map((q, i) => [i, problems(q)]).filter(([, p]) => p.length);
    el.innerHTML = `
      <div class="o-card o-test-head">
        <div class="o-card-head">
          <a class="o-back" href="/organizer/tests" data-link>← Тесттер</a>
          <div class="o-row-actions">
            <button type="button" class="btn btn-ghost btn-sm o-danger" data-act="delete">Тестті жою</button>
            <button type="button" class="btn btn-ghost btn-sm" data-act="preview">Алдын ала қарау</button>
          </div>
        </div>
        <div class="o-grid-2">
          <label class="o-field"><span class="o-label">Тест атауы <i>*</i></span><input maxlength="160" data-head="title" value="${esc(test.title)}" /></label>
          ${select({ name: 'topic', label: 'Тақырып', value: test.topic_id, options: topicOptions(s, { empty: '— Тақырыпты таңдаңыз —' }), required: true })}
        </div>
        <label class="o-toggle"><input type="checkbox" data-head="published" ${test.published ? 'checked' : ''} /><span></span>Оқушыларға көрсету (жариялағаннан кейін)</label>
        ${
          bad.length
            ? `<div class="o-alert">${icon('cross')}<span><b>${bad.length} сұрақты түзету керек.</b> Олар оқушыларға көрсетілмейді: ${bad
                .map(([i]) => `<a href="#q-${i}" data-jump="${i}">${i + 1}-сұрақ</a>`)
                .join(', ')}</span></div>`
            : ''
        }
      </div>
      <ol class="o-questions">${test.questions.map((q, i, all) => questionCard(q, i, all.length)).join('')}</ol>
      <div class="o-toolbar"><button type="button" class="btn btn-dark" data-act="add-question">+ Сұрақ қосу</button></div>
      <div class="o-savebar${dirty ? ' is-dirty' : ''}">
        <span>${dirty ? 'Сақталмаған өзгерістер бар' : 'Барлық өзгеріс сақталған'} · ${test.questions.length} сұрақ</span>
        <button type="button" class="btn" data-act="save">Сақтау</button>
      </div>`;
    bindFileFields(el, ctx);
  };

  const setDirty = () => {
    if (dirty) return;
    dirty = true;
    const bar = el.querySelector('.o-savebar');
    bar.classList.add('is-dirty');
    bar.querySelector('span').textContent = `Сақталмаған өзгерістер бар · ${test.questions.length} сұрақ`;
  };

  // Reads the form back into the model (fields are the source of truth while typing).
  const collect = () => {
    test.title = el.querySelector('[data-head="title"]').value;
    test.topic_id = Number(el.querySelector('[name="topic"]').value) || null;
    test.published = el.querySelector('[data-head="published"]').checked;
    el.querySelectorAll('.o-q').forEach((card) => {
      const q = test.questions[Number(card.dataset.q)];
      q.text = card.querySelector('[data-field="text"]').value;
      q.explanation = card.querySelector('[data-field="explanation"]').value;
      q.image_id = Number(card.querySelector(`[name="q${card.dataset.q}-image"]`).value) || null;
      card.querySelectorAll('.o-opt').forEach((row) => {
        const o = q.options[Number(row.dataset.o)];
        o.text = row.querySelector('[data-field="otext"]').value;
        o.is_correct = row.querySelector('[data-field="is_correct"]').checked;
        o.image_id = Number(row.querySelector('input[type="hidden"]').value) || null;
      });
    });
  };

  const redraw = (focus) => {
    const y = window.scrollY;
    draw();
    window.scrollTo(0, y);
    if (focus) el.querySelector(focus)?.focus();
  };

  el.addEventListener('input', (e) => {
    setDirty();
    if (e.target.matches('[data-field="is_correct"]')) {
      e.target.closest('.o-opt').classList.toggle('is-correct', e.target.checked);
    }
  });
  el.addEventListener('change', (e) => {
    setDirty();
    // Re-check a question's problems when its correct answers change.
    if (e.target.matches('[data-field="is_correct"]')) {
      collect();
      redraw();
    }
  });

  async function save() {
    collect();
    if (!test.title.trim()) return toast('Тест атауын жазыңыз.', 'error');
    if (!test.topic_id) return toast('Тестті тақырыпқа байланыстырыңыз.', 'error');
    for (const [i, q] of test.questions.entries()) {
      if (!q.text.trim()) return toast(`${i + 1}-сұрақтың мәтінін жазыңыз.`, 'error');
      if (q.options.length < 2) return toast(`${i + 1}-сұраққа кемінде екі жауап нұсқасын қосыңыз.`, 'error');
      const empty = q.options.findIndex((o) => !o.text.trim() && !o.image_id);
      if (empty >= 0) return toast(`${i + 1}-сұрақтың ${empty + 1}-жауабына мәтін немесе сурет қосыңыз.`, 'error');
    }
    const noCorrect = test.questions.map((q, i) => (q.options.some((o) => o.is_correct) ? null : i + 1)).filter(Boolean);
    if (
      noCorrect.length &&
      !(await confirmDialog(
        'Дұрыс жауабы жоқ сұрақтар',
        `${noCorrect.join(', ')}-сұрақта дұрыс жауап белгіленбеген. Олар оқушыларға көрсетілмейді. Сонда да сақтайсыз ба?`,
        { ok: 'Сақтау' },
      ))
    ) {
      return;
    }
    await busy(el.querySelector('[data-act="save"]'), async () => {
      test = await org.put(`/tests/${test.id}`, test);
      dirty = false;
      toast('Тест сақталды. Оқушылар оны жариялағаннан кейін көреді.');
      await ctx.refreshStatus();
      redraw();
    });
  }

  function preview() {
    collect();
    const files = ctx.state.files;
    const img = (fid, cls) => {
      const f = fid && files.find((x) => x.id === fid);
      return f ? `<img class="${cls}" src="${fileSrc(f)}" alt="" />` : '';
    };
    const shown = test.questions.filter((q) => !problems(q).includes('дұрыс жауап белгіленбеген') && q.options.length >= 2);
    dialog({
      title: `Алдын ала қарау: ${test.title}`,
      wide: true,
      body: `<p class="o-muted">Оқушы тестті осылай көреді (нұсқалардың реті оқушыда араластырылады). Дұрыс жауаптар жасылмен белгіленген.
        ${shown.length < test.questions.length ? `<b>${test.questions.length - shown.length} сұрақ оқушыға көрсетілмейді.</b>` : ''}</p>
        <ol class="o-preview">${shown
          .map((q, i) => {
            const multiple = q.options.filter((o) => o.is_correct).length > 1;
            return `<li class="panel question-card"><p class="q-num">Сұрақ ${i + 1} / ${shown.length}</p><h2>${esc(q.text)}</h2>
              ${img(q.image_id, 'q-image')}
              ${multiple ? '<p class="q-hint">Бірнеше дұрыс жауап бар: барлығын белгілеңіз.</p>' : ''}
              <div class="options">${q.options
                .map(
                  (o, oi) => `<div class="option${multiple ? ' option-multi' : ''}${o.is_correct ? ' o-preview-correct' : ''}"><span class="letter">${letter(oi)}</span>${img(o.image_id, 'option-image')}<span>${esc(o.text)}</span></div>`,
                )
                .join('')}</div>
              ${q.explanation ? `<p class="explain"><b>Түсініктеме:</b> ${esc(q.explanation)}</p>` : ''}</li>`;
          })
          .join('') || '<p>Көрсетілетін сұрақ жоқ.</p>'}</ol>`,
    });
  }

  el.addEventListener('click', async (e) => {
    const jump = e.target.closest('[data-jump]');
    if (jump) {
      e.preventDefault();
      el.querySelector(`.o-q[data-q="${jump.dataset.jump}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    const qact = e.target.closest('[data-qact]')?.dataset.qact;
    const oact = e.target.closest('[data-oact]')?.dataset.oact;
    const card = e.target.closest('.o-q');
    const qi = card ? Number(card.dataset.q) : -1;
    if (act === 'save') return save();
    if (act === 'preview') return preview();
    if (act === 'delete') {
      if (await deleteTest(ctx, test)) {
        dirty = false;
        ctx.navigate('/organizer/tests', { force: true });
      }
      return;
    }
    if (act === 'add-question') {
      collect();
      test.questions.push(blankQuestion());
      setDirty();
      redraw();
      const last = el.querySelector('.o-q:last-child');
      last.scrollIntoView({ behavior: 'smooth', block: 'center' });
      last.querySelector('textarea').focus({ preventScroll: true });
      return;
    }
    if (qact) {
      collect();
      if (qact === 'delete') {
        const q = test.questions[qi];
        if (q.text.trim() || q.options.some((o) => o.text.trim())) {
          if (!(await confirmDialog('Сұрақты жою', `${qi + 1}-сұрақ жойылады. Өзгеріс «Сақтау» басқанда сақталады.`, { ok: 'Жою', danger: true }))) return;
        }
        test.questions.splice(qi, 1);
      } else if (qact === 'up' || qact === 'down') {
        test.questions = moved(test.questions, qi, qact === 'up' ? -1 : 1);
      } else if (qact === 'add-option') {
        test.questions[qi].options.push(blankOption());
      }
      setDirty();
      redraw(qact === 'add-option' ? `.o-q[data-q="${qi}"] .o-opt:last-child .o-opt-text` : null);
      return;
    }
    if (oact) {
      collect();
      const oi = Number(e.target.closest('.o-opt').dataset.o);
      const q = test.questions[qi];
      if (oact === 'delete') {
        if (q.options.length <= 2) return toast('Сұрақта кемінде екі жауап нұсқасы болуы керек.', 'error');
        q.options.splice(oi, 1);
      } else if (oact === 'up') q.options = moved(q.options, oi, -1);
      setDirty();
      redraw();
    }
  });

  document.getElementById('o-title').textContent = test.title;
  draw();
}
