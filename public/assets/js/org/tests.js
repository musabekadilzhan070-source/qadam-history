import { org } from './api.js';
import { letter } from '../quiz-player.js';
import { runQuiz } from '../views/quiz.js';
import { resultHero, reviewList } from '../views/review.js';
import { TYPES, MAIN_TYPES, TYPE_LABELS, CHOICE_TYPES, questionProblems, testProblems } from '../question-rules.js';
import { exportButtons, importQuestions, TEMPLATE_URL } from './transfer.js';
import { esc, icon, toast, dialog, confirmDialog, select, fileField, bindFileFields, busy, moved, topicOptions, topicTitle } from './ui.js';

// Test builder: settings, seven question formats, checks before publishing and a student preview.

const TYPE_TEXT = {
  single: 'Оқушы ұсынылған жауаптардың ішінен тек бір дұрыс жауапты таңдайды.',
  multiple: 'Оқушы бірнеше жауап белгілейді: барлық дұрыс жауап таңдалып, қатесі белгіленбесе ғана дұрыс.',
  image: 'Сұрақтың негізі сурет (карта, портрет, құжат). Жауап нұсқалары бар.',
  matching: 'Сол жақ пен оң жақ элементтерді жұптастыру. Оң жақ араластырылып беріледі.',
  ordering: 'Оқиғаларды хронологиялық ретке қою. Оқушыға араластырылып беріледі.',
  open: 'Оқушы жауапты өзі жазады. Бірнеше дұрыс нұсқа қабылданады.',
  context: 'ҰБТ форматы: бір мәтін (немесе карта) және оған бірнеше сұрақ.',
};
const TYPE_ICON = { single: '◉', multiple: '☑', image: '▣', matching: '⇄', ordering: '↧', open: '✎', context: '¶' };

const STATE_BADGE = {
  live: '<span class="o-badge o-badge-on">Жарияланған</span>',
  changed: '<span class="o-badge o-badge-warn">Жарияланған · жаңа өзгерістер бар</span>',
  hidden: '<span class="o-badge o-badge-off">Жасырын</span>',
};

const newKey = () => Math.random().toString(16).slice(2, 10);
const blankOption = (is_correct = false) => ({ id: null, text: '', image_id: null, is_correct });

function blankQuestion(type) {
  const q = { id: null, type, text: '', explanation: '', image_id: null, points: 1, options: [], data: {} };
  if (CHOICE_TYPES.includes(type)) q.options = [blankOption(), blankOption(), blankOption(), blankOption()];
  if (type === 'matching') q.data = { pairs: [0, 1, 2].map(() => ({ key: newKey(), left: '', right: '' })) };
  if (type === 'ordering') q.data = { items: [0, 1, 2].map(() => ({ key: newKey(), text: '', date: '' })) };
  if (type === 'open') q.data = { answers: [''], ignore_case: true, ignore_spaces: true };
  if (type === 'context') {
    q.points = 0;
    q.data = { body: '' };
    q.children = [blankQuestion('single')];
  }
  return q;
}

/** Copy without database ids, so saving creates new rows. */
const cloneQuestion = (q) => ({
  ...structuredClone(q),
  id: null,
  options: q.options.map((o) => ({ ...o, id: null })),
  children: q.children?.map(cloneQuestion),
});

/** Moves the content that fits into another format; the rest starts blank. */
function changeType(q, type) {
  const next = blankQuestion(type);
  next.text = q.text;
  next.explanation = q.explanation;
  next.image_id = q.image_id;
  next.points = type === 'context' ? 0 : q.points || 1;
  if (CHOICE_TYPES.includes(q.type) && CHOICE_TYPES.includes(type)) {
    next.options = q.options;
    if (type === 'single') {
      let seen = false;
      next.options = q.options.map((o) => {
        const keep = o.is_correct && !seen;
        if (o.is_correct) seen = true;
        return { ...o, is_correct: keep };
      });
    }
  }
  return next;
}

const hasContent = (q) =>
  Boolean(
    q.options.some((o) => o.text.trim()) ||
      q.data.pairs?.some((p) => p.left || p.right) ||
      q.data.items?.some((i) => i.text) ||
      q.data.answers?.some((a) => a) ||
      q.children?.length,
  );

// ─── List ────────────────────────────────────────────────────────
async function createTest(ctx, topicId = '') {
  let values = { title: '', topic_id: topicId };
  const ok = await dialog({
    title: 'Жаңа тест құру',
    body: `<label class="o-field"><span class="o-label">Тест атауы <i>*</i></span><input id="nt-title" maxlength="160" /></label>
      ${select({ name: 'nt-topic', label: 'Тақырып', value: topicId, options: topicOptions(ctx.state, { empty: '— Тақырыпты таңдаңыз —' }), required: true })}
      <p class="o-muted">Сипаттама, мұқаба, уақыт және ұпай баптаулары келесі бетте.</p>`,
    buttons: [
      { label: 'Болдырмау', value: false, kind: 'ghost' },
      { label: 'Құру', value: true, kind: 'primary' },
    ],
    onOpen(box) {
      box.querySelector('#nt-title').focus();
      const read = () => {
        values = { title: box.querySelector('#nt-title').value, topic_id: box.querySelector('[name="nt-topic"]').value };
      };
      box.addEventListener('input', read);
      box.addEventListener('change', read);
    },
  });
  if (!ok) return;
  if (!values.title.trim()) return toast('Тест атауын жазыңыз.', 'error');
  if (!values.topic_id) return toast('Тестті тақырыпқа байланыстырыңыз.', 'error');
  try {
    const r = await org.post('/tests', { title: values.title, topic_id: Number(values.topic_id), questions: [] });
    toast('Тест құрылды. Енді сұрақтарды қосыңыз.');
    ctx.navigate(`/organizer/tests/${r.id}`);
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function deleteTest(ctx, test) {
  const ok = await confirmDialog(
    'Тестті жою',
    `«${test.title}» тесті барлық сұрақтарымен бірге жойылады${test.live ? ' және оқушылардың бетінен бірден алынады' : ''}. Оқушылардың бұрынғы нәтижелері сақталады.`,
    { ok: 'Жою', danger: true },
  );
  if (!ok) return false;
  try {
    await org.del(`/tests/${test.id}`);
    toast('Тест жойылды.');
    return true;
  } catch (err) {
    toast(err.message, 'error');
    return false;
  }
}

/** Shows the publish check's problem list. */
function showProblems(problems, title = 'Тест жарияланбады') {
  return dialog({
    title,
    body: `<p>Оқушыларға жариялау үшін мына қателерді түзетіңіз:</p><ul class="o-problems">${problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`,
    buttons: [{ label: 'Түсінікті', value: true, kind: 'primary' }],
  });
}

async function publishTest(id, live) {
  try {
    const t = await org.post(`/tests/${id}/${live ? 'publish' : 'hide'}`);
    toast(live ? 'Тест жарияланды: оқушылар оны басты бетте және «Тесттер» бөлімінде көреді.' : 'Тест жасырылды: оқушылар оны көрмейді.');
    return t;
  } catch (err) {
    if (err.data?.problems?.length) await showProblems(err.data.problems);
    else toast(err.message, 'error');
    return null;
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
      <div class="o-toolbar"><button type="button" class="btn" data-new>+ Жаңа тест құру</button>
        <button type="button" class="btn btn-dark" data-import>Сұрақтарды импорттау</button>
        <a class="btn btn-ghost" href="${TEMPLATE_URL}" download>Excel үлгісі</a></div>
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
                          <small>${x.question_count} сұрақ${x.problems.length ? ` · <span class="o-warn">${x.problems.length} қате түзетуді күтеді</span>` : ''}</small></div>
                        ${x.live ? STATE_BADGE.live : STATE_BADGE.hidden}
                        <div class="o-row-actions">
                          <a class="btn btn-ghost btn-sm" href="/organizer/tests/${x.id}" data-link>Өңдеу</a>
                          <button type="button" class="btn btn-ghost btn-sm" data-act="duplicate">Көшірме</button>
                          ${exportButtons(x.id)}
                          <button type="button" class="btn btn-ghost btn-sm" data-act="toggle">${x.live ? 'Жасыру' : 'Жариялау'}</button>
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
    if (e.target.closest('[data-import]')) {
      const id = await importQuestions(ctx);
      if (id) {
        await ctx.reload();
        draw();
      }
      return;
    }
    const row = e.target.closest('.o-row');
    const btn = e.target.closest('[data-act]');
    if (!row || !btn) return;
    const act = btn.dataset.act;
    const x = ctx.state.tests.find((t) => t.id === Number(row.dataset.id));
    await busy(btn, async () => {
      if (act === 'up' || act === 'down') {
        const list = ctx.state.tests.filter((t) => t.topic_id === x.topic_id);
        await org.post('/tests/reorder', { ids: moved(list, list.indexOf(x), act === 'up' ? -1 : 1).map((t) => t.id) });
      } else if (act === 'toggle') {
        if (!x.topic_id && !x.live) return toast('Алдымен тестті тақырыпқа байланыстырыңыз (тестті өңдеу бетінде).', 'error');
        if (!(await publishTest(x.id, !x.live))) return;
      } else if (act === 'duplicate') {
        const copy = await org.post(`/tests/${x.id}/duplicate`);
        toast(`Көшірме жасалды: «${copy.title}». Ол жасырын күйде.`);
      } else if (act === 'delete') {
        if (!(await deleteTest(ctx, x))) return;
      }
      await ctx.reload();
      draw();
    });
  });
  draw();
}

// ─── Editor ──────────────────────────────────────────────────────
/** Reads a value at a dotted path ('questions.2.options.0.text') of the test. */
function pathParts(path) {
  return path.split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p));
}
function setAt(obj, path, value) {
  const parts = pathParts(path);
  const last = parts.pop();
  const target = parts.reduce((o, k) => o?.[k], obj);
  if (target) target[last] = value;
}
function getAt(obj, path) {
  return pathParts(path).reduce((o, k) => o?.[k], obj);
}

const n = (v) => (v === '' || v === null || v === undefined ? 0 : Number(v));

function settingsCard(test, ctx) {
  const st = test.settings;
  const num = (name, label, value, hint, max) =>
    `<label class="o-field"><span class="o-label">${label}</span><input type="number" min="0" max="${max}" step="1" name="settings.${name}" data-type="num" value="${value || ''}" placeholder="0" />${hint ? `<small class="o-hint">${hint}</small>` : ''}</label>`;
  const flag = (name, label, checked) => `<label class="o-toggle"><input type="checkbox" name="settings.${name}" data-type="bool" ${checked ? 'checked' : ''} /><span></span>${label}</label>`;
  return `
    <section class="o-card">
      <div class="o-card-head"><h2>Тест баптаулары</h2></div>
      <div class="o-grid-2">
        <label class="o-field"><span class="o-label">Тест атауы <i>*</i></span><input maxlength="160" name="title" value="${esc(test.title)}" /></label>
        ${select({ name: 'topic_id', label: 'Тақырып', value: test.topic_id, options: topicOptions(ctx.state, { empty: '— Тақырыпты таңдаңыз —' }), required: true }).replace('<select ', '<select data-type="id" ')}
      </div>
      <label class="o-field"><span class="o-label">Сипаттама</span><textarea name="description" rows="2" maxlength="2000" placeholder="Тест не туралы, кімге арналған">${esc(test.description || '')}</textarea></label>
      ${fileField({ name: 'cover_image_id', kind: 'image', value: test.cover_image_id, label: 'Мұқаба суреті (міндетті емес)', hint: 'Тест картасының үстінде көрсетіледі.' })}
      <div class="o-grid-4">
        ${num('question_limit', 'Оқушыға берілетін сұрақ саны', st.question_limit, '0 немесе бос: барлық сұрақ. Аз болса, кездейсоқ таңдалады.', 500)}
        ${num('time_limit_min', 'Тест уақыты (минут)', st.time_limit_min, '0: уақыт шектелмейді. Уақыт біткенде тест өзі тексеріледі.', 600)}
        ${num('question_time_sec', 'Әр сұраққа уақыт (секунд)', st.question_time_sec, 'Міндетті емес. Уақыт біткенде келесі сұраққа өтеді.', 3600)}
        ${num('pass_percent', 'Өту шегі (%)', st.pass_percent, 'Осы пайыздан жоғары болса, «Өтті».', 100)}
      </div>
      <div class="o-flags">
        ${flag('partial_credit', 'Жартылай ұпай беру (бірнеше жауап, сәйкестендіру, реттілік)', st.partial_credit)}
        ${flag('show_answers', 'Тест соңында дұрыс жауаптар мен түсініктемені көрсету', st.show_answers)}
        ${flag('shuffle_questions', 'Сұрақтардың ретін араластыру', st.shuffle_questions)}
        ${flag('shuffle_options', 'Жауап нұсқаларын араластыру', st.shuffle_options)}
      </div>
    </section>`;
}

function choiceBody(q, path) {
  const single = q.type === 'single';
  return `
    <div class="o-field"><span class="o-label">Жауап нұсқалары <small>· ${single ? 'бір дұрыс жауапты белгілеңіз' : 'дұрыс жауаптардың бәрін белгілеңіз'}</small></span>
      <ol class="o-opts">
        ${q.options
          .map(
            (o, oi) => `<li class="o-opt${o.is_correct ? ' is-correct' : ''}">
              <label class="o-correct" title="Дұрыс жауап"><input type="checkbox" name="${path}.options.${oi}.is_correct" data-type="bool" data-single="${single ? path : ''}" ${o.is_correct ? 'checked' : ''} /><span>${letter(oi)}</span></label>
              <input class="o-opt-text" maxlength="500" name="${path}.options.${oi}.text" value="${esc(o.text)}" placeholder="${oi + 1}-жауап" />
              ${fileField({ name: `${path}.options.${oi}.image_id`, kind: 'image', value: o.image_id, label: 'Жауапқа сурет қосу', compact: true })}
              <button type="button" class="o-icon-btn" data-list="${path}.options" data-i="${oi}" data-move="-1" ${oi === 0 ? 'disabled' : ''} aria-label="Жоғары">▲</button>
              <button type="button" class="o-icon-btn o-danger" data-list="${path}.options" data-i="${oi}" data-remove aria-label="Жауапты жою" title="Жауапты жою">${icon('cross')}</button>
            </li>`,
          )
          .join('')}
      </ol>
      ${q.options.length < 10 ? `<button type="button" class="btn btn-ghost btn-sm" data-add="option" data-path="${path}">+ Жауап нұсқасын қосу</button>` : ''}
    </div>`;
}

function matchingBody(q, path) {
  return `
    <div class="o-field"><span class="o-label">Жұптар <small>· әр жолда сол жақ элемент және оның дұрыс сәйкесі. Оқушыға оң жақ араластырылып беріледі.</small></span>
      <ol class="o-pairs">
        ${q.data.pairs
          .map(
            (p, i) => `<li class="o-pair">
              <span class="o-q-num o-q-num-sm">${i + 1}</span>
              <input maxlength="300" name="${path}.data.pairs.${i}.left" value="${esc(p.left)}" placeholder="Сол жақ (мысалы: Абылай хан)" aria-label="${i + 1}-жұп, сол жақ" />
              <span class="o-pair-arrow" aria-hidden="true">⇄</span>
              <input maxlength="300" name="${path}.data.pairs.${i}.right" value="${esc(p.right)}" placeholder="Оң жақ (мысалы: 1771)" aria-label="${i + 1}-жұп, оң жақ" />
              <span class="o-pair-btns">
                <button type="button" class="o-icon-btn" data-list="${path}.data.pairs" data-i="${i}" data-move="-1" ${i === 0 ? 'disabled' : ''} aria-label="Жоғары">▲</button>
                <button type="button" class="o-icon-btn" data-list="${path}.data.pairs" data-i="${i}" data-move="1" ${i === q.data.pairs.length - 1 ? 'disabled' : ''} aria-label="Төмен">▼</button>
                <button type="button" class="o-icon-btn o-danger" data-list="${path}.data.pairs" data-i="${i}" data-remove aria-label="Жұпты жою">${icon('cross')}</button>
              </span>
            </li>`,
          )
          .join('')}
      </ol>
      ${q.data.pairs.length < 20 ? `<button type="button" class="btn btn-ghost btn-sm" data-add="pair" data-path="${path}">+ Жұп қосу</button>` : ''}
    </div>`;
}

function orderingBody(q, path) {
  return `
    <div class="o-field"><span class="o-label">Оқиғалар <small>· дұрыс (хронологиялық) ретпен жазыңыз. Оқушыға араластырылып беріледі.</small></span>
      <ol class="o-pairs">
        ${q.data.items
          .map(
            (it, i) => `<li class="o-pair o-order-row">
              <span class="o-q-num o-q-num-sm">${i + 1}</span>
              <input maxlength="300" name="${path}.data.items.${i}.text" value="${esc(it.text)}" placeholder="Оқиға" aria-label="${i + 1}-оқиға" />
              <input class="o-date" maxlength="60" name="${path}.data.items.${i}.date" value="${esc(it.date)}" placeholder="Дата (міндетті емес)" aria-label="${i + 1}-оқиғаның датасы" />
              <span class="o-pair-btns">
                <button type="button" class="o-icon-btn" data-list="${path}.data.items" data-i="${i}" data-move="-1" ${i === 0 ? 'disabled' : ''} aria-label="Жоғары">▲</button>
                <button type="button" class="o-icon-btn" data-list="${path}.data.items" data-i="${i}" data-move="1" ${i === q.data.items.length - 1 ? 'disabled' : ''} aria-label="Төмен">▼</button>
                <button type="button" class="o-icon-btn o-danger" data-list="${path}.data.items" data-i="${i}" data-remove aria-label="Оқиғаны жою">${icon('cross')}</button>
              </span>
            </li>`,
          )
          .join('')}
      </ol>
      ${q.data.items.length < 20 ? `<button type="button" class="btn btn-ghost btn-sm" data-add="item" data-path="${path}">+ Оқиға қосу</button>` : ''}
    </div>`;
}

function openBody(q, path) {
  return `
    <div class="o-field"><span class="o-label">Дұрыс жауап және баламалары <small>· оқушының жауабы осылардың біреуіне сәйкес келсе, дұрыс</small></span>
      <ol class="o-pairs">
        ${q.data.answers
          .map(
            (a, i) => `<li class="o-pair o-answer-row">
              <span class="o-q-num o-q-num-sm">${i + 1}</span>
              <input maxlength="200" name="${path}.data.answers.${i}" value="${esc(a)}" placeholder="${i === 0 ? 'Дұрыс жауап' : 'Балама жауап'}" aria-label="${i + 1}-жауап" />
              <button type="button" class="o-icon-btn o-danger" data-list="${path}.data.answers" data-i="${i}" data-remove aria-label="Жауапты жою">${icon('cross')}</button>
            </li>`,
          )
          .join('')}
      </ol>
      ${q.data.answers.length < 20 ? `<button type="button" class="btn btn-ghost btn-sm" data-add="answer" data-path="${path}">+ Балама жауап қосу</button>` : ''}
      <div class="o-flags">
        <label class="o-toggle"><input type="checkbox" name="${path}.data.ignore_case" data-type="bool" ${q.data.ignore_case ? 'checked' : ''} /><span></span>Бас/кіші әріпті ескермеу</label>
        <label class="o-toggle"><input type="checkbox" name="${path}.data.ignore_spaces" data-type="bool" ${q.data.ignore_spaces ? 'checked' : ''} /><span></span>Артық бос орындарды ескермеу</label>
      </div>
    </div>`;
}

function typeSelect(q, path, inContext) {
  return `<label class="o-type-select"><span class="visually-hidden">Сұрақ түрі</span>
    <select data-change-type="${path}">
      <optgroup label="Негізгі түрлер">${MAIN_TYPES.map(option).join('')}</optgroup>
      <optgroup label="Қосымша түрлер">${TYPES.filter((t) => !MAIN_TYPES.includes(t) && !(inContext && t === 'context')).map(option).join('')}</optgroup>
    </select></label>`;

  function option(t) {
    return `<option value="${t}" ${t === q.type ? 'selected' : ''}>${TYPE_ICON[t]} ${TYPE_LABELS[t]}</option>`;
  }
}

function questionCard(q, path, label, { first, last, inContext = false }) {
  const issues = questionProblems(q);
  const list = inContext ? path.replace(/\.\d+$/, '') : 'questions';
  const i = Number(path.split('.').pop());
  const isContext = q.type === 'context';
  const actions = `
    <div class="o-row-actions">
      ${typeSelect(q, path, inContext)}
      ${isContext ? '' : `<label class="o-points" title="Ұпай"><input type="number" min="0" max="100" name="${path}.points" data-type="num" value="${q.points}" aria-label="Ұпай" /><span>ұпай</span></label>`}
      <button type="button" class="o-icon-btn" data-list="${list}" data-i="${i}" data-move="-1" ${first ? 'disabled' : ''} aria-label="Жоғары" title="Жоғары">▲</button>
      <button type="button" class="o-icon-btn" data-list="${list}" data-i="${i}" data-move="1" ${last ? 'disabled' : ''} aria-label="Төмен" title="Төмен">▼</button>
      <button type="button" class="o-icon-btn" data-list="${list}" data-i="${i}" data-copy aria-label="Көшірме жасау" title="Көшірме жасау">⧉</button>
      <button type="button" class="o-icon-btn o-danger" data-list="${list}" data-i="${i}" data-remove data-confirm aria-label="Жою" title="Жою">${icon('cross')}</button>
    </div>`;
  const head = `
    <div class="o-q-head">
      <span class="o-q-num">${TYPE_ICON[q.type]}</span>
      <b>${esc(label)}</b>
      <span class="o-badge o-badge-type">${TYPE_LABELS[q.type]}</span>
      ${actions}
    </div>
    ${issues.length ? `<p class="o-q-issue">${icon('cross')}${esc(issues.join(', '))}</p>` : ''}`;

  if (isContext) {
    return `
    <li class="o-card o-q o-q-context${issues.length ? ' has-problem' : ''}" data-path="${path}">
      ${head}
      <label class="o-field"><span class="o-label">Контекст атауы</span><input maxlength="300" name="${path}.text" value="${esc(q.text)}" placeholder="Мысалы: Аңырақай шайқасы туралы дереккөз" /></label>
      <label class="o-field"><span class="o-label">Контекст мәтіні <i>*</i></span><textarea rows="6" maxlength="20000" name="${path}.data.body" placeholder="Оқушы оқитын мәтін: дереккөз үзіндісі, құжат, сипаттама…">${esc(q.data.body)}</textarea></label>
      ${fileField({ name: `${path}.image_id`, kind: 'image', value: q.image_id, label: 'Сурет немесе карта (міндетті емес)' })}
      <div class="o-ctx-children">
        <p class="o-label">Контекстке арналған сұрақтар · ${q.children.length}</p>
        <ol class="o-questions">${q.children
          .map((c, ci) => questionCard(c, `${path}.children.${ci}`, `${ci + 1}-сұрақ`, { first: ci === 0, last: ci === q.children.length - 1, inContext: true }))
          .join('')}</ol>
        <button type="button" class="btn btn-dark btn-sm" data-add-question="${path}.children">+ Контекстке сұрақ қосу</button>
      </div>
    </li>`;
  }

  const body = CHOICE_TYPES.includes(q.type)
    ? choiceBody(q, path)
    : q.type === 'matching'
      ? matchingBody(q, path)
      : q.type === 'ordering'
        ? orderingBody(q, path)
        : openBody(q, path);
  return `
    <li class="o-card o-q${issues.length ? ' has-problem' : ''}${inContext ? ' o-q-child' : ''}" data-path="${path}">
      ${head}
      <label class="o-field"><span class="o-label">Сұрақ мәтіні <i>*</i></span><textarea rows="2" maxlength="2000" name="${path}.text">${esc(q.text)}</textarea></label>
      ${fileField({ name: `${path}.image_id`, kind: 'image', value: q.image_id, label: q.type === 'image' ? 'Сұрақ суреті (міндетті) · карта, портрет, құжат' : 'Сұрақ суреті (міндетті емес)' })}
      ${body}
      <label class="o-field"><span class="o-label">Түсініктеме (тест соңында көрсетіледі)</span><textarea rows="2" maxlength="2000" name="${path}.explanation">${esc(q.explanation || '')}</textarea></label>
    </li>`;
}

const card = (t) =>
  `<button type="button" class="o-type-card" data-type="${t}"><span class="o-type-icon">${TYPE_ICON[t]}</span><b>${TYPE_LABELS[t]}</b><small>${TYPE_TEXT[t]}</small></button>`;

/** «Сұрақ түрін таңдаңыз»: resolves with a type or null. */
function chooseType(inContext) {
  return dialog({
    title: 'Сұрақ түрін таңдаңыз',
    wide: true,
    body: `<h3 class="o-sub">Негізгі түрлер</h3>
      <div class="o-type-grid">${MAIN_TYPES.map(card).join('')}</div>
      <h3 class="o-sub">Қосымша түрлер</h3>
      <div class="o-type-grid">${TYPES.filter((t) => !MAIN_TYPES.includes(t) && !(inContext && t === 'context')).map(card).join('')}</div>`,
    onOpen(box, close) {
      box.addEventListener('click', (e) => {
        const b = e.target.closest('[data-type]');
        if (b) close(b.dataset.type);
      });
    },
  });
}

/** The test as the server expects it. */
const payload = (test) => ({
  title: test.title,
  topic_id: test.topic_id,
  description: test.description,
  cover_image_id: test.cover_image_id,
  settings: test.settings,
  questions: test.questions,
});

/** Student view of the unsaved builder state: real answering and grading, nothing stored. */
async function preview(test) {
  let quiz = null;
  await dialog({
    title: `Оқушы ретінде қарау: ${test.title || 'Атаусыз тест'}`,
    wide: true,
    body: `<p class="o-muted o-preview-note">Бұл тек алдын ала қарау: жауаптар сақталмайды және статистикаға кірмейді. Сақталмаған өзгерістер де көрсетіледі.</p><div class="o-preview-box"><div class="loading">Жүктелуде…</div></div>`,
    onOpen(box) {
      const area = box.querySelector('.o-preview-box');
      quiz = runQuiz(area, {
        heading: test.title || 'Атаусыз тест',
        load: async () => {
          const paper = await org.post('/preview', { test: payload(test) });
          if (paper.problems.length) {
            box.querySelector('.o-preview-note').insertAdjacentHTML(
              'afterend',
              `<div class="o-alert">${icon('cross')}<span><b>Толық емес сұрақтар оқушыға көрсетілмейді:</b> ${paper.problems.map(esc).join(' ')}</span></div>`,
            );
          }
          return paper;
        },
        submit: (answers, paper) => org.post('/preview', { test: payload(test), answers, served: paper.served }),
        onResult: (r) => {
          area.innerHTML = `<div class="quiz">${resultHero(r, { topicSlug: null, topicTitle: 'Алдын ала қарау · нәтиже сақталмайды', retry: false })}
            <div class="o-toolbar"><button type="button" class="btn btn-dark btn-sm" data-again>Қайта бастау</button></div>
            ${reviewList(r.items)}</div>`;
          area.querySelector('[data-again]').addEventListener('click', () => quiz.start().catch(fail));
        },
      });
      const fail = (err) => {
        area.innerHTML = `<div class="o-alert">${icon('cross')}<span>${esc(err.message)}${err.data?.problems?.length ? `<ul class="o-problems">${err.data.problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}</span></div>`;
      };
      quiz.start().catch(fail);
    },
  });
  quiz?.stop();
}

export async function testEditView(el, [id], ctx, alive) {
  let test = await org.get(`/tests/${id}`);
  if (!alive()) return;
  let dirty = false;
  ctx.setDirtyCheck(() => dirty);

  const draw = () => {
    const problems = testProblems(test);
    const count = test.questions.reduce((s, q) => s + (q.type === 'context' ? q.children.length : 1), 0);
    const points = test.questions.reduce((s, q) => s + (q.type === 'context' ? q.children.reduce((a, c) => a + n(c.points), 0) : n(q.points)), 0);
    el.innerHTML = `
      <div class="o-card o-test-head">
        <div class="o-card-head">
          <a class="o-back" href="/organizer/tests" data-link>← Тесттер</a>
          <div class="o-row-actions">
            ${STATE_BADGE[test.live_state]}
            <button type="button" class="btn btn-ghost btn-sm" data-act="preview">Оқушы ретінде қарау</button>
            <button type="button" class="btn btn-ghost btn-sm" data-act="duplicate">Көшірме жасау</button>
            ${exportButtons(test.id)}
            <button type="button" class="btn btn-ghost btn-sm" data-act="import">Сұрақтарды импорттау</button>
            ${test.live_state !== 'hidden' ? '<button type="button" class="btn btn-ghost btn-sm" data-act="hide">Жасыру</button>' : ''}
            <button type="button" class="btn btn-ghost btn-sm o-danger" data-act="delete">Жою</button>
            <button type="button" class="btn btn-sm" data-act="publish">${test.live_state === 'changed' ? 'Өзгерістерді жариялау' : 'Жариялау'}</button>
          </div>
        </div>
        <p class="o-muted">${topicTitle(ctx.state, test.topic_id) ? `Тақырып: <b>${esc(topicTitle(ctx.state, test.topic_id))}</b> · ` : ''}${count} сұрақ · ${points} ұпай.
          «Сақтау» өзгерістерді жобада сақтайды; оқушылар тестті «Жариялау» басқаннан кейін көреді.</p>
        ${
          problems.length
            ? `<div class="o-alert">${icon('cross')}<span><b>Жариялау алдында түзету керек (${problems.length}):</b><ul class="o-problems">${problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></span></div>`
            : test.questions.length
              ? `<div class="o-alert o-alert-ok">${icon('check')}<span>Тест тексеруден өтті: жариялауға дайын.</span></div>`
              : ''
        }
      </div>
      ${settingsCard(test, ctx)}
      <ol class="o-questions">${test.questions
        .map((q, i, all) => questionCard(q, `questions.${i}`, q.type === 'context' ? `${i + 1}-блок` : `${i + 1}-сұрақ`, { first: i === 0, last: i === all.length - 1 }))
        .join('')}</ol>
      ${test.questions.length ? '' : '<div class="o-card o-empty"><p>Тестте әзірге сұрақ жоқ. Төмендегі батырмамен сұрақ түрін таңдап, бірінші сұрақты қосыңыз.</p></div>'}
      <div class="o-toolbar"><button type="button" class="btn btn-dark" data-add-question="questions">+ Сұрақ қосу</button></div>
      <div class="o-savebar${dirty ? ' is-dirty' : ''}">
        <span>${dirty ? 'Сақталмаған өзгерістер бар' : 'Барлық өзгеріс сақталған'} · ${count} сұрақ</span>
        <button type="button" class="btn" data-act="save">Сақтау</button>
      </div>`;
    bindFileFields(el, ctx);
    document.getElementById('o-title').textContent = test.title || 'Тест';
  };

  const redraw = (focus) => {
    const y = window.scrollY;
    draw();
    window.scrollTo(0, y);
    if (focus) el.querySelector(focus)?.focus({ preventScroll: true });
  };

  const setDirty = () => {
    if (dirty) return;
    dirty = true;
    const bar = el.querySelector('.o-savebar');
    bar.classList.add('is-dirty');
    bar.querySelector('span').textContent = bar.querySelector('span').textContent.replace('Барлық өзгеріс сақталған', 'Сақталмаған өзгерістер бар');
  };

  // Every field writes straight into the model by its path, so redrawing never loses typing.
  const read = (t) => {
    if (t.dataset.type === 'bool') return t.checked;
    if (t.dataset.type === 'num') return Math.max(0, Math.round(Number(t.value) || 0));
    if (t.dataset.type === 'id' || t.closest('[data-file-field]')) return Number(t.value) || null;
    return t.value;
  };
  el.addEventListener('input', (e) => {
    const t = e.target.matches('[data-file-field]') ? e.target.querySelector('input[type="hidden"]') : e.target;
    if (!t?.name || t.matches('[data-change-type]')) return;
    setAt(test, t.name, read(t));
    setDirty();
    if (t.matches('[data-file-field] input')) redraw();
  });
  el.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-change-type]')) return changeTypeAt(t);
    if (!t.name) return;
    setAt(test, t.name, read(t));
    // «Бір дұрыс жауап»: marking one answer clears the others.
    if (t.dataset.single && t.checked) {
      getAt(test, t.dataset.single).options.forEach((o, i) => {
        o.is_correct = t.name.endsWith(`.options.${i}.is_correct`);
      });
    }
    setDirty();
    if (t.type === 'checkbox' || t.tagName === 'SELECT') redraw();
  });
  // Re-check a question when the organizer leaves a field. Deferred, so a click that moved
  // focus lands on its button before the hint above it changes the layout.
  el.addEventListener('focusout', (e) => {
    if (!e.target.name?.startsWith('questions.') || !dirty) return;
    const card = e.target.closest('.o-q');
    setTimeout(() => {
      const q = card?.isConnected && getAt(test, card.dataset.path);
      if (!q) return;
      const issues = questionProblems(q);
      card.classList.toggle('has-problem', issues.length > 0);
      let p = card.querySelector(':scope > .o-q-issue');
      if (issues.length) {
        if (!p) {
          card.querySelector(':scope > .o-q-head').insertAdjacentHTML('afterend', '<p class="o-q-issue"></p>');
          p = card.querySelector(':scope > .o-q-issue');
        }
        p.innerHTML = `${icon('cross')}${esc(issues.join(', '))}`;
      } else p?.remove();
    }, 400);
  });

  async function changeTypeAt(selectEl) {
    const path = selectEl.dataset.changeType;
    const q = getAt(test, path);
    const type = selectEl.value;
    const keepsAll = CHOICE_TYPES.includes(q.type) && CHOICE_TYPES.includes(type);
    if (!keepsAll && hasContent(q)) {
      const ok = await confirmDialog(
        'Сұрақ түрін өзгерту',
        `«${TYPE_LABELS[type]}» түріне ауысқанда сұрақ мәтіні, суреті және түсініктемесі сақталады, ал жауаптар жаңадан толтырылады.`,
        { ok: 'Өзгерту' },
      );
      if (!ok) {
        selectEl.value = q.type;
        return;
      }
    }
    setAt(test, path, changeType(q, type));
    setDirty();
    redraw();
  }

  async function save({ quiet = false } = {}) {
    if (!test.title.trim()) {
      toast('Тест атауын жазыңыз.', 'error');
      return false;
    }
    if (!test.topic_id) {
      toast('Тестті тақырыпқа байланыстырыңыз.', 'error');
      return false;
    }
    const out = await busy(el.querySelector('[data-act="save"]'), async () => {
      test = await org.put(`/tests/${test.id}`, payload(test));
      dirty = false;
      if (!quiet) toast(test.live_state === 'changed' ? 'Сақталды. Оқушылар жаңа нұсқаны «Өзгерістерді жариялау» басқаннан кейін көреді.' : 'Тест сақталды.');
      await ctx.refreshStatus();
      redraw();
      return true;
    });
    return Boolean(out);
  }

  el.addEventListener('click', async (e) => {
    // The file is made from the saved test, so unsaved edits are saved first.
    const link = e.target.closest('[data-export]');
    if (link && dirty) {
      e.preventDefault();
      if (await save({ quiet: true })) window.location.href = link.href;
      return;
    }
    const btn = e.target.closest('button');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'save') return save();
    if (act === 'import') {
      if (dirty && !(await save({ quiet: true }))) return;
      const target = await importQuestions(ctx, { testId: test.id });
      if (!target) return;
      await ctx.reload();
      if (target !== test.id) return ctx.navigate(`/organizer/tests/${target}`, { force: true });
      test = await org.get(`/tests/${test.id}`);
      redraw();
      return;
    }
    if (act === 'preview') return preview(test);
    if (act === 'publish') {
      if (dirty && !(await save({ quiet: true }))) return;
      const problems = testProblems(test);
      if (problems.length) return showProblems(problems);
      await busy(btn, async () => {
        const t = await publishTest(test.id, true);
        if (t) {
          test = t;
          await ctx.refreshStatus();
          redraw();
        }
      });
      return;
    }
    if (act === 'hide') {
      await busy(btn, async () => {
        const t = await publishTest(test.id, false);
        if (t) {
          // Unsaved edits stay in the builder.
          test = dirty ? { ...test, live_state: t.live_state } : t;
          redraw();
        }
      });
      return;
    }
    if (act === 'duplicate') {
      if (dirty && !(await save({ quiet: true }))) return;
      await busy(btn, async () => {
        const copy = await org.post(`/tests/${test.id}/duplicate`);
        toast(`Көшірме жасалды: «${copy.title}». Енді көшірмені өңдеп жатырсыз.`);
        ctx.navigate(`/organizer/tests/${copy.id}`, { force: true });
      });
      return;
    }
    if (act === 'delete') {
      if (await deleteTest(ctx, { ...test, live: test.live_state !== 'hidden' })) {
        dirty = false;
        ctx.navigate('/organizer/tests', { force: true });
      }
      return;
    }
    if (btn.dataset.addQuestion) {
      const listPath = btn.dataset.addQuestion;
      const inContext = listPath !== 'questions';
      const type = await chooseType(inContext);
      if (!type) return;
      const list = getAt(test, listPath);
      list.push(blankQuestion(type));
      setDirty();
      redraw();
      const card = el.querySelector(`[data-path="${listPath}.${list.length - 1}"]`);
      card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card?.querySelector('textarea, input:not([type="hidden"])')?.focus({ preventScroll: true });
      return;
    }
    if (btn.dataset.add) {
      const q = getAt(test, btn.dataset.path);
      const kind = btn.dataset.add;
      if (kind === 'option') q.options.push(blankOption());
      if (kind === 'pair') q.data.pairs.push({ key: newKey(), left: '', right: '' });
      if (kind === 'item') q.data.items.push({ key: newKey(), text: '', date: '' });
      if (kind === 'answer') q.data.answers.push('');
      setDirty();
      const listName = { option: 'options', pair: 'data.pairs', item: 'data.items', answer: 'data.answers' }[kind];
      const last = getAt(q, listName).length - 1;
      redraw(`[name^="${btn.dataset.path}.${listName}.${last}"]:not([type="checkbox"]):not([type="hidden"])`);
      return;
    }
    if (btn.dataset.list) {
      const list = getAt(test, btn.dataset.list);
      const i = Number(btn.dataset.i);
      if ('remove' in btn.dataset) {
        const isQuestion = /(^questions|children)$/.test(btn.dataset.list);
        const min = btn.dataset.list.endsWith('.options') ? 2 : 0;
        if (list.length <= min) return toast('Сұрақта кемінде екі жауап нұсқасы болуы керек.', 'error');
        if (isQuestion && 'confirm' in btn.dataset) {
          const q = list[i];
          const what = q.type === 'context' ? `Контекст блогы ішіндегі ${q.children.length} сұрағымен` : 'Сұрақ';
          if ((q.text.trim() || hasContent(q)) && !(await confirmDialog('Жою', `${what} жойылады. Өзгеріс «Сақтау» басқанда сақталады.`, { ok: 'Жою', danger: true }))) return;
        }
        list.splice(i, 1);
      } else if ('copy' in btn.dataset) {
        list.splice(i + 1, 0, cloneQuestion(list[i]));
        toast('Сұрақтың көшірмесі қосылды.');
      } else if (btn.dataset.move) {
        const next = moved(list, i, Number(btn.dataset.move));
        list.splice(0, list.length, ...next);
      }
      setDirty();
      redraw();
    }
  });

  draw();
}
