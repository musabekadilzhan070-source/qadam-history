import { org } from './api.js';
import { letter } from '../quiz-player.js';
import { runQuiz } from '../views/quiz.js';
import { resultHero, reviewList } from '../views/review.js';
import { TYPES, MAIN_TYPES, TYPE_LABELS, CHOICE_TYPES, questionProblems, testProblems } from '../question-rules.js';
import { GRADES, PUBLISHERS, SUBJECT, gradeLabel, tagLine } from '../catalog.js';
import { exportButtons, importQuestions, TEMPLATE_URL } from './transfer.js';
import { copyLink, linkUrl, mountLinkCard } from './links.js';
import { mountShelfCard, pickTests } from './shelves.js';
import { pad2 } from '../util.js';
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
async function createTest(ctx, topicId = '', { periodId = null, entryId = null, bookName = '', format = 'classic' } = {}) {
  const quiz = format === 'quiz';
  // From a period's book: only that period's topics, and the new test goes into the book.
  let options = topicOptions(ctx.state, { empty: '— Тақырыпты таңдаңыз —' });
  if (periodId) {
    const ids = new Set(ctx.state.topics.filter((t) => t.period_id === periodId).map((t) => String(t.id)));
    options = options.filter((o) => o.value === '' || ids.has(String(o.value)));
    if (!topicId && ids.size === 1) topicId = [...ids][0];
  }
  let values = { title: '', topic_id: topicId };
  const ok = await dialog({
    title: quiz ? 'Жаңа Quiz құру' : 'Жаңа тест құру',
    body: `<label class="o-field"><span class="o-label">Тест атауы <i>*</i></span><input id="nt-title" maxlength="160" /></label>
      ${select({ name: 'nt-topic', label: 'Тақырып', value: topicId, options, required: true })}
      ${bookName ? `<p class="o-muted">Тест «${esc(bookName)}» кітабына бірден қосылады.</p>` : ''}
      ${quiz ? '<p class="o-muted">Quiz — ойын форматы: оқушы барлық сұраққа дұрыс жауап бергенше қате сұрақтар қайта беріледі. Классикалық тесттерден бөлек сақталады.</p>' : ''}
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
    const r = await org.post('/tests', { title: values.title, topic_id: Number(values.topic_id), questions: [], format });
    if (entryId) await org.put(`/period-books/test/${r.id}`, { entry_ids: [entryId] }).catch(() => {});
    toast(quiz ? 'Quiz құрылды. Енді сұрақтарды қосыңыз.' : 'Тест құрылды. Енді сұрақтарды қосыңыз.');
    ctx.navigate(`${quiz ? '/organizer/quizzes' : '/organizer/tests'}/${r.id}`);
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

const bookLabel = (b) => [gradeLabel(b.grade), b.publisher].filter(Boolean).join(' | ');
const NO_TOPIC = 'no-topic';
const LIST_KEY = 'qadam_org_tests_period';

/**
 * «Тесттер»: one historical period at a time (buttons at the top), and inside it the tests of
 * each book of the period («8-сынып | Атамұра», «8-сынып | Мектеп» …), then the tests that are in
 * no book yet. A period without books lists its tests by topic. The choice stays in the address
 * (?period=…&book=…), so a reload or the way back from a test returns to the same place.
 */
export const quizzesView = (el, params, ctx, alive) => testsView(el, params, ctx, alive, 'quiz');

export async function testsView(el, _params, ctx, alive, format = 'classic') {
  let [{ entries }, { books }] = await Promise.all([org.get('/period-books'), org.get('/books')]);
  if (!alive()) return;
  // The same lists for both formats: «Тесттер» (classic) and «Quiz тесттер» (quiz), each with its own tests.
  const quiz = format === 'quiz';
  const basePath = quiz ? '/organizer/quizzes' : '/organizer/tests';
  const idsField = quiz ? 'quiz_ids' : 'test_ids';
  let pending = null;
  if (quiz) pending = (await org.get('/quizzes/copy').catch(() => ({ pending: 0 }))).pending;
  if (!alive()) return;
  const query = new URLSearchParams(location.search);
  let period = query.get('period') || '';
  let book = query.get('book') || '';
  if (!period) {
    try {
      period = localStorage.getItem(LIST_KEY + (quiz ? '_quiz' : '')) || '';
    } catch {
      /* no storage: the first period */
    }
  }

  // Within this view, s().tests is the list of this format (classic tests or quizzes), and each
  // book's test_ids are its tests of this format.
  const s = () => ({ ...ctx.state, tests: (quiz ? ctx.state.quizzes : ctx.state.tests) || [] });
  const idsOf = (e) => e[idsField] || [];
  const bookOf = (e) => books.find((b) => b.id === e.book_id) || null;
  const entryName = (e) => {
    const b = bookOf(e);
    return b ? bookLabel(b) || b.title : 'Кітап табылмады';
  };
  /** A period's tests in its own order: topics, then tests in each topic. */
  const periodTests = (pid) => s().topics.filter((t) => t.period_id === pid).flatMap((t) => s().tests.filter((x) => x.topic_id === t.id));
  const unlinked = () => s().tests.filter((x) => !x.topic_id || !s().topics.some((t) => t.id === x.topic_id));
  const entriesOf = (pid) => entries.filter((e) => e.period_id === pid);

  function fixChoice() {
    const ps = s().periods;
    if (period === NO_TOPIC && !unlinked().length) period = '';
    if (period !== NO_TOPIC && !ps.some((p) => p.slug === period)) period = (ps.find((p) => periodTests(p.id).length) || ps[0])?.slug || '';
    const p = ps.find((x) => x.slug === period);
    const list = p ? entriesOf(p.id) : [];
    if (book && book !== 'none' && !list.some((e) => String(e.id) === book)) book = '';
  }
  function remember() {
    const qs = new URLSearchParams();
    if (period) qs.set('period', period);
    if (book) qs.set('book', book);
    history.replaceState(null, '', `${basePath}${qs.toString() ? `?${qs}` : ''}`);
    try {
      localStorage.setItem(LIST_KEY + (quiz ? '_quiz' : ''), period);
    } catch {
      /* not kept */
    }
  }

  /** A book's tests in the organizer's order for that book; the rest follow in period order. */
  const bookTests = (e, tests) => {
    const mine = tests.filter((x) => idsOf(e).includes(x.id));
    const at = new Map(mine.map((x, i) => [x.id, i]));
    const pos = (x) => e.positions?.[x.id] || Infinity;
    return mine.sort((a, b) => pos(a) - pos(b) || at.get(a.id) - at.get(b.id));
  };
  /** What dragging in a list reorders: a book («entry:<id>»), a topic («topic:<id>»), or nothing (mixed topics). */
  const sortKey = (list, entry) => {
    if (entry) return `entry:${entry.id}`;
    const topics = new Set(list.map((x) => x.topic_id));
    return topics.size === 1 && list[0]?.topic_id ? `topic:${list[0].topic_id}` : '';
  };

  const row = (x, list, key) => {
    const siblings = key ? list : s().tests.filter((t) => t.topic_id === x.topic_id);
    const i = siblings.indexOf(x);
    const where = key.startsWith('entry:') ? 'Кітап ішінде' : 'Тақырып ішінде';
    const topic = s().topics.find((t) => t.id === x.topic_id);
    return `<li class="o-row" data-id="${x.id}">
      ${key ? '<span class="o-drag" data-drag title="Сүйреп ауыстыру" aria-hidden="true">⠿</span>' : ''}
      <div class="o-order">
        <button type="button" class="o-icon-btn" data-act="up" ${i <= 0 ? 'disabled' : ''} aria-label="${where} жоғары" title="${where} жоғары">▲</button>
        <button type="button" class="o-icon-btn" data-act="down" ${i === siblings.length - 1 ? 'disabled' : ''} aria-label="${where} төмен" title="${where} төмен">▼</button>
      </div>
      <span class="o-row-icon">${icon(quiz ? 'quiz' : 'tests')}</span>
      <div class="o-row-body"><a href="${basePath}/${x.id}" data-link><b>${esc(x.title)}</b></a>
        <small>${topic ? `${esc(topic.title)} · ` : ''}${x.question_count} сұрақ${tagLine(x) ? ` · ${esc(tagLine(x))}` : ''}${x.problems.length ? ` · <span class="o-warn">${x.problems.length} қате түзетуді күтеді</span>` : ''}</small>
        ${
          x.share_id
            ? `<div class="o-link-line"><span class="o-badge ${x.link_enabled ? 'o-badge-on' : 'o-badge-off'}">${x.link_enabled ? 'Сілтеме қосулы' : 'Сілтеме өшірулі'}</span>
                <a class="btn btn-ghost btn-sm" href="/t/${esc(x.share_id)}" target="_blank" rel="noopener">Тестті ашу</a>
                <button type="button" class="btn btn-ghost btn-sm" data-act="copy-link">Сілтемені көшіру</button>
                <button type="button" class="btn btn-ghost btn-sm" data-act="link-toggle" aria-pressed="${x.link_enabled}">${x.link_enabled ? 'Сілтеме арқылы тапсыруды өшіру' : 'Сілтеме арқылы тапсыру'}</button>
                <a class="btn btn-ghost btn-sm" href="/organizer/links?test=${x.id}" data-link>Нәтижелерді көру</a></div>`
            : ''
        }</div>
      ${x.live ? STATE_BADGE.live : STATE_BADGE.hidden}
      <div class="o-row-actions">
        <a class="btn btn-ghost btn-sm" href="${basePath}/${x.id}" data-link>Өңдеу</a>
        ${topic ? '<button type="button" class="btn btn-ghost btn-sm" data-act="books">Кезеңі мен кітабы</button>' : ''}
        <button type="button" class="btn btn-ghost btn-sm" data-act="duplicate">Көшірме</button>
        ${exportButtons(x.id)}
        <button type="button" class="btn btn-ghost btn-sm" data-act="toggle">${x.live ? 'Жасыру' : 'Жариялау'}</button>
        <button type="button" class="o-icon-btn o-danger" data-act="delete" aria-label="Жою" title="Жою">${icon('cross')}</button>
      </div>
    </li>`;
  };
  const rows = (list, empty, entry) => {
    if (!list.length) return `<p class="o-muted">${empty}</p>`;
    const key = sortKey(list, entry);
    return `<ol class="o-rows" ${key ? `data-sort="${key}"` : ''}>${list.map((x) => row(x, list, key)).join('')}</ol>`;
  };
  const group = ({ eyebrow = '', title, head = '', actions = '', list, empty, attrs = '', entry = null }) => `
    <section class="o-card o-card-tight o-test-group" ${attrs}>
      <div class="o-card-head"><div>${eyebrow ? `<p class="eyebrow">${esc(eyebrow)}</p>` : ''}<h2>${head}${esc(title)} <span class="o-count">${list.length}</span></h2></div>
        ${actions ? `<div class="o-row-actions">${actions}</div>` : ''}</div>
      ${rows(list, empty, entry)}
    </section>`;

  function periodBody(p) {
    const tests = periodTests(p.id);
    const list = entriesOf(p.id);
    const newBtn = (attrs = '') => `<button type="button" class="btn btn-ghost btn-sm" data-new-in="${p.id}" ${attrs}>${quiz ? '+ Quiz' : '+ Тест'}</button>`;
    if (!list.length) {
      // No books on this period yet: its tests by topic, as before.
      const topics = s().topics.filter((t) => t.period_id === p.id);
      return `
        <p class="o-muted o-tests-note">Бұл кезеңге әлі кітап бекітілмеген, сондықтан тесттер тақырып бойынша көрсетілген. Кітапты <a href="/organizer/books" data-link>«Кітаптар»</a> бөлімінде (кітаптың «Тарихи кезеңі») немесе <a href="/organizer/period-books" data-link>«Кезең кітаптары»</a> бөлімінде бекітуге болады.</p>
        ${
          topics.length
            ? topics
                .map((t) =>
                  group({
                    eyebrow: p.title,
                    title: t.title,
                    list: s().tests.filter((x) => x.topic_id === t.id),
                    empty: 'Бұл тақырыпта тест жоқ.',
                    actions: `<button type="button" class="btn btn-ghost btn-sm" data-new="${t.id}">${quiz ? '+ Quiz' : '+ Тест'}</button>`,
                  }),
                )
                .join('')
            : '<section class="o-card"><p class="o-muted">Бұл кезеңде әлі тақырып жоқ. Алдымен «Тақырыптар» бөлімінде тақырып қосыңыз.</p></section>'
        }`;
    }
    const inBook = new Set(list.flatMap((e) => idsOf(e)));
    const loose = tests.filter((x) => !inBook.has(x.id));
    const chips = `
      <div class="chips o-book-chips" role="group" aria-label="Кітап бойынша">
        <button type="button" class="chip chip-all" data-book="" aria-pressed="${!book}">Барлық кітаптар <span class="o-count">${tests.length}</span></button>
        ${list.map((e) => `<button type="button" class="chip chip-all" data-book="${e.id}" aria-pressed="${book === String(e.id)}">${icon('book')}${esc(entryName(e))} <span class="o-count">${bookTests(e, tests).length}</span></button>`).join('')}
        ${loose.length ? `<button type="button" class="chip chip-all" data-book="none" aria-pressed="${book === 'none'}">Кітапсыз <span class="o-count">${loose.length}</span></button>` : ''}
      </div>`;
    const bookGroups = list
      .filter((e) => !book || book === String(e.id))
      .map((e) => {
        const b = bookOf(e);
        return group({
          eyebrow: b?.title || '',
          head: icon('book', 'icon o-group-icon'),
          title: entryName(e),
          list: bookTests(e, tests),
          entry: e,
          empty: 'Бұл кітапта әзірге тест жоқ. «+ Тест» батырмасымен жаңа тест қосыңыз немесе «Тесттерді белгілеу» арқылы бар тесттерді таңдаңыз.',
          attrs: `data-entry="${e.id}"`,
          actions: `${newBtn(`data-entry-new="${e.id}"`)}<button type="button" class="btn btn-ghost btn-sm" data-pick-tests="${e.id}">Тесттерді белгілеу</button>`,
        });
      });
    const looseGroup =
      (!book || book === 'none') && loose.length
        ? group({
            eyebrow: p.title,
            title: 'Кітапқа бекітілмеген тесттер',
            list: loose,
            empty: '',
            actions: newBtn(),
          })
        : '';
    const hint = '<p class="o-muted o-tests-note">Ретін өзгерту үшін тестті ⠿ белгісінен (немесе жолдың бос жерінен) ұстап, тінтуірмен жоғары не төмен сүйреңіз. Кітаптағы рет оқушының бетінде бірден көрінеді.</p>';
    return `${chips}${hint}${bookGroups.join('')}${looseGroup}`;
  }

  const draw = () => {
    fixChoice();
    const ps = s().periods;
    const p = ps.find((x) => x.slug === period);
    const loose = unlinked();
    el.innerHTML = `
      ${
        quiz
          ? `<p class="o-muted o-tests-note">Quiz — тесттің ойын форматы: оқушы барлық сұраққа дұрыс жауап бергенше қате сұрақтар кезектің соңына қайта қосылады. Quiz тесттері классикалық тесттерден бөлек сақталады, өңделеді және жарияланады: біреуін өзгерту екіншісін өзгертпейді.</p>
            <div class="o-toolbar"><button type="button" class="btn" data-new>+ Жаңа Quiz құру</button>
              <button type="button" class="btn btn-dark" data-copy-quizzes ${pending ? '' : 'disabled'}>Классикалық тесттерден Quiz көшірмесін жасау${pending ? ` (${pending})` : ''}</button>
              <a class="btn btn-ghost" href="/organizer/quiz-results" data-link>Quiz нәтижелері</a></div>`
          : `<div class="o-toolbar"><button type="button" class="btn" data-new>+ Жаңа тест құру</button>
        <button type="button" class="btn btn-dark" data-import>Сұрақтарды импорттау</button>`
      }${quiz ? '' : `
        <a class="btn btn-ghost" href="${TEMPLATE_URL}" download>Excel үлгісі</a></div>`}
      <div class="chips o-period-chips" role="group" aria-label="Тарихи кезеңдер">
        ${ps
          .map(
            (x) => `<button type="button" class="chip" data-period="${esc(x.slug)}" aria-pressed="${x.slug === period}">
              <span class="chip-num">${pad2(x.position || x.id)}</span>${esc(x.title)} <span class="o-count">${periodTests(x.id).length}</span></button>`,
          )
          .join('')}
        ${loose.length ? `<button type="button" class="chip chip-all" data-period="${NO_TOPIC}" aria-pressed="${period === NO_TOPIC}">Тақырыпқа байланыспаған <span class="o-count">${loose.length}</span></button>` : ''}
      </div>
      ${
        period === NO_TOPIC
          ? group({ eyebrow: 'Оқушыларға көрінбейді', title: 'Тақырыпқа байланыспаған тесттер', list: loose, empty: 'Мұндай тест жоқ.' })
          : p
            ? periodBody(p)
            : '<section class="o-card"><p class="o-muted">Кезең жоқ.</p></section>'
      }`;
  };

  /** Which books of its period a test is in; the period follows the test's topic. */
  async function editBooks(x) {
    const topic = s().topics.find((t) => t.id === x.topic_id);
    const p = s().periods.find((pp) => pp.id === topic?.period_id);
    if (!p) return false;
    const list = entriesOf(p.id);
    let chosen = new Set(list.filter((e) => idsOf(e).includes(x.id)).map((e) => e.id));
    const ok = await dialog({
      title: `«${x.title}»: кезеңі мен кітабы`,
      body: `
        <p><b>Кезеңі:</b> ${esc(p.title)} · <b>Тақырыбы:</b> ${esc(topic.title)}</p>
        <p class="o-muted">Тест кезеңге тақырыбы арқылы тиесілі. Басқа кезеңге ауыстыру үшін тест бетінде <a href="/organizer/tests/${x.id}" data-link data-close-link>тақырыбын өзгертіңіз</a>.</p>
        ${
          list.length
            ? `<p class="o-label">Қай кітапта көрінеді</p><div class="o-shelf-checks">${list
                .map((e) => {
                  const b = bookOf(e);
                  return `<label class="o-check-row"><input type="checkbox" value="${e.id}" ${chosen.has(e.id) ? 'checked' : ''} />
                    <span><b>${esc(entryName(e))}</b><small>${esc(b?.title || '')}${b && !b.published ? ' · кітап жасырын' : ''}</small></span></label>`;
                })
                .join('')}</div>`
            : '<p class="o-muted">Бұл кезеңге әлі кітап бекітілмеген.</p>'
        }`,
      buttons: list.length
        ? [
            { label: 'Болдырмау', value: false, kind: 'ghost' },
            { label: 'Сақтау', value: true },
          ]
        : [{ label: 'Жабу', value: false, kind: 'ghost' }],
      onOpen(box, close) {
        box.addEventListener('change', () => {
          chosen = new Set([...box.querySelectorAll('input[type="checkbox"]:checked')].map((c) => Number(c.value)));
        });
        box.querySelector('[data-close-link]')?.addEventListener('click', () => close(false));
      },
    });
    if (!ok) return false;
    const r = await org.put(`/period-books/test/${x.id}`, { entry_ids: [...chosen] });
    entries = entries.filter((e) => e.period_id !== p.id).concat(r.entries);
    toast('Тесттің кітаптары сақталды.');
    return true;
  }

  el.addEventListener('click', async (e) => {
    const chip = e.target.closest('[data-period]');
    if (chip) {
      period = chip.dataset.period;
      book = '';
      remember();
      return draw();
    }
    const bookChip = e.target.closest('[data-book]');
    if (bookChip) {
      book = bookChip.dataset.book;
      remember();
      return draw();
    }
    const nb = e.target.closest('[data-new]');
    if (nb) return createTest(ctx, nb.dataset.new || '', { format });
    const inPeriod = e.target.closest('[data-new-in]');
    if (inPeriod) {
      const entry = entries.find((x) => x.id === Number(inPeriod.dataset.entryNew));
      return createTest(ctx, '', { periodId: Number(inPeriod.dataset.newIn), entryId: entry?.id || null, bookName: entry ? entryName(entry) : '', format });
    }
    const copyBtn = e.target.closest('[data-copy-quizzes]');
    if (copyBtn) {
      const ok = await confirmDialog(
        'Quiz көшірмелерін жасау',
        `Quiz көшірмесі әлі жоқ ${pending} классикалық тесттің әрқайсысына бір Quiz көшірмесі жасалады: сұрақтар, жауаптар, суреттер, контекст, сыныбы, баспасы, кезеңі мен кітабы сол күйі сақталады. Классикалық тесттер өзгермейді. Көшіру алдында деректердің резервтік көшірмесі сақталады. Бұрын көшірілген (тіпті кейін жойылған) тест қайта көшірілмейді.`,
        { ok: 'Көшірмелерді жасау' },
      );
      if (!ok) return;
      await busy(copyBtn, async () => {
        try {
          const r = await org.post('/quizzes/copy');
          toast(r.mismatches.length ? `Көшірілді: ${r.copied} Quiz. Тексеруде ${r.mismatches.length} айырмашылық табылды.` : `Көшірілді: ${r.copied} Quiz (${r.questions} сұрақ), оның ${r.live} жарияланды. Барлығы түпнұсқамен сәйкес.`, r.mismatches.length ? 'error' : undefined);
          pending = (await org.get('/quizzes/copy')).pending;
          ({ entries } = await org.get('/period-books'));
          await ctx.reload();
          draw();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
      return;
    }
    const pick = e.target.closest('[data-pick-tests]');
    if (pick) {
      const entry = entries.find((x) => x.id === Number(pick.dataset.pickTests));
      const p = s().periods.find((x) => x.id === entry?.period_id);
      if (!entry || !p) return;
      try {
        const ids = await pickTests(s(), p, bookOf(entry), periodTests(p.id).filter((x) => idsOf(entry).includes(x.id)).map((x) => x.id));
        if (!ids) return;
        const saved = await org.put(`/period-books/${entry.id}`, { [idsField]: ids });
        entries = entries.map((x) => (x.id === entry.id ? saved : x));
        toast(`Сақталды: ${ids.length} тест.`);
        draw();
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }
    if (e.target.closest('[data-import]')) {
      const id = await importQuestions(ctx);
      if (id) {
        await ctx.reload();
        draw();
      }
      return;
    }
    const rowEl = e.target.closest('.o-row');
    const btn = e.target.closest('[data-act]');
    if (!rowEl || !btn) return;
    const act = btn.dataset.act;
    const x = s().tests.find((t) => t.id === Number(rowEl.dataset.id));
    if (!x) return;
    await busy(btn, async () => {
      if (act === 'up' || act === 'down') {
        const ol = rowEl.closest('[data-sort]');
        if (ol) {
          const ids = [...ol.children].map((li) => Number(li.dataset.id));
          const i = ids.indexOf(x.id);
          const j = i + (act === 'up' ? -1 : 1);
          [ids[i], ids[j]] = [ids[j], ids[i]];
          return saveOrder(ol.dataset.sort, ids);
        }
        const list = s().tests.filter((t) => t.topic_id === x.topic_id);
        await org.post('/tests/reorder', { ids: moved(list, list.indexOf(x), act === 'up' ? -1 : 1).map((t) => t.id) });
      } else if (act === 'books') {
        if (!(await editBooks(x))) return;
      } else if (act === 'toggle') {
        if (!x.topic_id && !x.live) return toast('Алдымен тестті тақырыпқа байланыстырыңыз (тестті өңдеу бетінде).', 'error');
        if (!(await publishTest(x.id, !x.live))) return;
      } else if (act === 'duplicate') {
        const copy = await org.post(`/tests/${x.id}/duplicate`);
        toast(`Көшірме жасалды: «${copy.title}». Ол жасырын күйде.`);
      } else if (act === 'delete') {
        if (!(await deleteTest(ctx, x))) return;
        ({ entries } = await org.get('/period-books'));
      } else if (act === 'copy-link') {
        if (!(await copyLink(x.id, x.share_id, x.link_enabled))) return;
      } else if (act === 'link-toggle') {
        await org.put(`/links/${x.id}`, { enabled: !x.link_enabled });
        toast(x.link_enabled ? 'Сілтеме өшірілді: жаңа тапсыру басталмайды.' : `Сілтеме қосылды: ${linkUrl(x.share_id)}`);
      }
      await ctx.reload();
      draw();
    });
  });

  /** Saves a new order of a list: inside a book (live at once) or inside a topic. */
  async function saveOrder(key, ids) {
    const [kind, raw] = key.split(':');
    try {
      if (kind === 'entry') {
        const saved = await org.post(`/period-books/${raw}/order`, { [idsField]: ids });
        entries = entries.map((x) => (x.id === saved.id ? saved : x));
        toast('Кітаптағы тесттердің реті сақталды.');
      } else {
        await org.post('/tests/reorder', { ids });
        await ctx.reload();
        toast('Тесттердің реті сақталды.');
      }
    } catch (err) {
      toast(err.message, 'error');
      ({ entries } = await org.get('/period-books'));
      await ctx.reload();
    }
    draw();
  }

  // Drag and drop with the mouse (the ⠿ handle, or anywhere on the row but its buttons and
  // links) and with a finger on the handle. The row moves while dragging; the order is saved on
  // release, and only inside the same list.
  let drag = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const li = e.target.closest('[data-sort] > .o-row');
    if (!li) return;
    const onHandle = Boolean(e.target.closest('[data-drag]'));
    if (!onHandle && (e.pointerType !== 'mouse' || e.target.closest('button, a, input, select, textarea, label, .o-link-line'))) return;
    const ol = li.parentElement;
    drag = { li, ol, start: e.clientY, moved: false, before: [...ol.children].map((x) => x.dataset.id).join(','), id: e.pointerId };
    if (onHandle) e.preventDefault();
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved) {
      if (Math.abs(e.clientY - drag.start) < 6) return;
      drag.moved = true;
      drag.li.classList.add('is-dragging');
      drag.ol.classList.add('is-sorting');
      try {
        el.setPointerCapture?.(e.pointerId);
      } catch {
        /* capture is optional */
      }
    }
    e.preventDefault();
    const others = [...drag.ol.children].filter((x) => x !== drag.li);
    const next = others.find((x) => {
      const r = x.getBoundingClientRect();
      return e.clientY < r.top + r.height / 2;
    });
    if (next) {
      if (drag.li.nextElementSibling !== next) drag.ol.insertBefore(drag.li, next);
    } else if (drag.ol.lastElementChild !== drag.li) drag.ol.append(drag.li);
    // Near the window edge the page scrolls, so long lists can be crossed.
    if (e.clientY < 60) window.scrollBy(0, -14);
    else if (e.clientY > window.innerHeight - 60) window.scrollBy(0, 14);
  });
  const finish = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (!d.moved) return;
    d.li.classList.remove('is-dragging');
    d.ol.classList.remove('is-sorting');
    // A drag is not a click on the row's link.
    const swallow = (c) => {
      c.preventDefault();
      c.stopPropagation();
    };
    el.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => el.removeEventListener('click', swallow, { capture: true }), 80);
    const ids = [...d.ol.children].map((x) => Number(x.dataset.id));
    if (ids.join(',') !== d.before) saveOrder(d.ol.dataset.sort, ids);
  };
  el.addEventListener('pointerup', finish);
  el.addEventListener('pointercancel', finish);

  draw();
  remember();
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
      <fieldset class="o-book-fields">
        <legend>Тестке пайдаланылған оқулық</legend>
        <p class="o-muted">Оқушы тест картасында «Пән | Сынып | Баспа» жолын, тестті ашқанда толық мәліметті көреді. Жыл, авторлар және беттер міндетті емес.</p>
        <div class="o-grid-3">
          <label class="o-field"><span class="o-label">Пән</span><input name="subject" maxlength="120" list="o-subjects" value="${esc(test.subject || '')}" placeholder="${esc(SUBJECT)}" /></label>
          ${select({ name: 'grade', label: 'Сынып', value: test.grade ?? '', options: [{ value: '', label: '— Таңдалмаған —' }, ...GRADES.map((g) => ({ value: g, label: gradeLabel(g) }))] }).replace('<select ', '<select data-type="id" ')}
          <label class="o-field"><span class="o-label">Баспа</span><input name="publisher" maxlength="80" list="o-publishers" value="${esc(test.publisher || '')}" placeholder="Атамұра, Мектеп…" /></label>
        </div>
        <div class="o-grid-3">
          <label class="o-field"><span class="o-label">Шыққан жылы</span><input name="book_year" type="number" min="1950" max="2100" step="1" inputmode="numeric" value="${test.book_year ?? ''}" placeholder="2022" /></label>
          <label class="o-field"><span class="o-label">Авторлары</span><input name="book_authors" maxlength="300" value="${esc(test.book_authors || '')}" placeholder="Мысалы: Қабылдинов З., Төлеубаев Ә." /></label>
          <label class="o-field"><span class="o-label">Беттер немесе тақырыптар</span><input name="book_pages" maxlength="300" value="${esc(test.book_pages || '')}" placeholder="Мысалы: 45–58-беттер, § 12–14" /></label>
        </div>
        <datalist id="o-subjects"><option value="${esc(SUBJECT)}"></option><option value="Дүниежүзі тарихы"></option><option value="Құқық негіздері"></option></datalist>
        <datalist id="o-publishers">${PUBLISHERS.map((x) => `<option value="${esc(x)}"></option>`).join('')}</datalist>
      </fieldset>
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
  grade: test.grade ?? null,
  publisher: test.publisher || '',
  subject: test.subject || '',
  book_year: test.book_year || null,
  book_authors: test.book_authors || '',
  book_pages: test.book_pages || '',
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
  const linkCache = {};
  const shelfCache = {};
  // The books card follows the saved topic: the server links a test only to books of that period.
  let savedTopicId = test.topic_id;

  const draw = () => {
    const problems = testProblems(test);
    const count = test.questions.reduce((s, q) => s + (q.type === 'context' ? q.children.length : 1), 0);
    const points = test.questions.reduce((s, q) => s + (q.type === 'context' ? q.children.reduce((a, c) => a + n(c.points), 0) : n(q.points)), 0);
    el.innerHTML = `
      <div class="o-card o-test-head">
        <div class="o-card-head">
          <a class="o-back" href="${test.format === 'quiz' ? '/organizer/quizzes' : '/organizer/tests'}" data-link>${test.format === 'quiz' ? '← Quiz тесттер' : '← Тесттер'}</a>
          ${test.format === 'quiz' ? `<span class="o-badge o-badge-quiz">${icon('quiz')} QUIZ</span>` : ''}
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
      <div data-link-card></div>
      <div data-shelf-card></div>
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
    const holder = el.querySelector('[data-link-card]');
    holder.dataset.dirty = dirty ? '1' : '';
    mountLinkCard(holder, test.id, linkCache, { dirty }).catch((err) => toast(err.message, 'error'));
    mountShelfCard(el.querySelector('[data-shelf-card]'), { id: test.id, saved_topic_id: savedTopicId }, ctx, shelfCache).catch((err) => toast(err.message, 'error'));
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
      savedTopicId = test.topic_id;
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
      if (target !== test.id) return ctx.navigate(`${test.format === 'quiz' ? '/organizer/quizzes' : '/organizer/tests'}/${target}`, { force: true });
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
        ctx.navigate(`${test.format === 'quiz' ? '/organizer/quizzes' : '/organizer/tests'}/${copy.id}`, { force: true });
      });
      return;
    }
    if (act === 'delete') {
      if (await deleteTest(ctx, { ...test, live: test.live_state !== 'hidden' })) {
        dirty = false;
        ctx.navigate(test.format === 'quiz' ? '/organizer/quizzes' : '/organizer/tests', { force: true });
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
