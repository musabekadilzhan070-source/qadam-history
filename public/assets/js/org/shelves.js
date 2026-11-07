import { org } from './api.js';
import { esc, icon, toast, dialog, confirmDialog, busy, statusBadge } from './ui.js';
import { gradeLabel } from '../catalog.js';
import { pad2 } from '../util.js';

// «Кезең кітаптары»: the organizer puts books from «Кітаптар» on a period and ticks the tests of
// each one. On the site the student opens the period, picks a book and sees only its tests. A
// period without books keeps its usual list of topics. Changes here are live at once.

const coverSrc = (b) => `/api/files/${b.cover_id}?v=${b.cover_version}`;
const bookLabel = (b) => [gradeLabel(b.grade), b.publisher].filter(Boolean).join(' | ');
const thumb = (b) => `<span class="o-book-thumb">${b?.cover_id && b.cover_kind === 'image' ? `<img src="${coverSrc(b)}" alt="" />` : icon('book')}</span>`;

/** A test's class and publisher: its own, or its topic's. */
const testClass = (x, state) => {
  const t = state.topics.find((tt) => tt.id === x.topic_id);
  return { grade: x.grade || t?.grade || null, publisher: x.publisher || t?.publisher || '' };
};
const matches = (x, book, state) => {
  if (!book.grade && !book.publisher) return false;
  const c = testClass(x, state);
  return (!book.grade || c.grade === book.grade) && (!book.publisher || c.publisher === book.publisher);
};

/** Tests of a period in the cabinet, grouped by topic in the organizer's order. */
const periodGroups = (state, periodId) =>
  state.topics
    .filter((t) => t.period_id === periodId)
    .map((t) => ({ topic: t, tests: state.tests.filter((x) => x.topic_id === t.id) }))
    .filter((g) => g.tests.length);

/** Why students do not see this entry yet; empty when they do. */
function entryProblems(entry, book, tests) {
  const out = [];
  if (!book) out.push('Кітап табылмады.');
  else if (!book.published) out.push('Кітап «Кітаптар» бөлімінде жасырын, сондықтан оқушыларға көрінбейді.');
  if (!tests.length) out.push('Тест таңдалмаған: кітап оқушыларға көрінбейді.');
  else if (!tests.some((x) => x.live)) out.push('Таңдалған тесттердің ешқайсысы жарияланбаған: кітап оқушыларға көрінбейді.');
  return out;
}

/** Picks a book from «Кітаптар». Resolves with its id, or null. */
async function pickBook(books, { taken = new Set(), current = null, title }) {
  if (!books.length) {
    await dialog({
      title,
      body: '<p>«Кітаптар» бөлімінде әзірге кітап жоқ. Алдымен кітапты сол жерге қосыңыз: мұқаба және PDF.</p><p><a class="btn btn-sm" href="/organizer/books/new" data-link>+ Кітап қосу</a></p>',
      buttons: [{ label: 'Жабу', value: null, kind: 'ghost' }],
    });
    return null;
  }
  let chosen = current;
  const value = await dialog({
    title,
    wide: true,
    body: `
      <p class="o-muted">Кітап «Кітаптар» бөлімінен алынады, қайта жүктеудің қажеті жоқ. Бір кітапты бірнеше кезеңге бекітуге болады.</p>
      <ul class="o-pick-list">
        ${books
          .map((b) => {
            const off = taken.has(b.id) && b.id !== current;
            return `<li><label class="o-pick${off ? ' is-off' : ''}">
              <input type="radio" name="pick-book" value="${b.id}" ${b.id === current ? 'checked' : ''} ${off ? 'disabled' : ''} />
              ${thumb(b)}
              <span class="o-pick-body"><b>${esc(b.title)}</b><small>${esc(bookLabel(b) || b.subject || '')}${off ? ' · осы кезеңде бар' : ''}</small></span>
              ${statusBadge(b.published)}
            </label></li>`;
          })
          .join('')}
      </ul>`,
    buttons: [
      { label: 'Болдырмау', value: null, kind: 'ghost' },
      { label: 'Таңдау', value: 'ok' },
    ],
    onOpen(modal) {
      modal.addEventListener('change', (e) => {
        if (e.target.name === 'pick-book') chosen = Number(e.target.value);
      });
      modal.addEventListener('click', (e) => {
        if (e.target.closest('a[data-link]')) modal.querySelector('[data-close]').click();
      });
    },
  });
  if (value !== 'ok') return null;
  if (!chosen || chosen === current) {
    if (!chosen) toast('Кітапты таңдаңыз.', 'error');
    return null;
  }
  return chosen;
}

/** Ticks the tests of a book on a period. Resolves with the new list of ids, or null. */
async function pickTests(state, period, book, selected) {
  const groups = periodGroups(state, period.id);
  if (!groups.length) {
    await dialog({
      title: 'Кітаптың тесттері',
      body: '<p>Бұл кезеңде әзірге тест жоқ. Тестті «Тесттер» бөлімінде жасап, осы кезеңнің тақырыбына байланыстырыңыз, сосын осы жерде белгілеңіз.</p>',
      buttons: [{ label: 'Жабу', value: null, kind: 'ghost' }],
    });
    return null;
  }
  let modalRef = null;
  const canMatch = Boolean(book?.grade || book?.publisher);
  const value = await dialog({
    title: `Тесттер: ${book ? book.title : 'кітап'}`,
    wide: true,
    body: `
      <p class="o-muted">Оқушы «${esc(period.title)}» кезеңінде осы кітапты таңдағанда тек белгіленген тесттерді көреді. Бір тест бірнеше кітапта бола алады. Жарияланбаған тест жарияланғаннан кейін ғана көрінеді.</p>
      <div class="o-pick-tools">
        ${canMatch ? `<button type="button" class="btn btn-dark btn-sm" data-pick="match">«${esc(bookLabel(book))}» тесттерін белгілеу</button>` : ''}
        <button type="button" class="btn btn-ghost btn-sm" data-pick="all">Барлығын белгілеу</button>
        <button type="button" class="btn btn-ghost btn-sm" data-pick="none">Тазалау</button>
        <span class="o-muted" data-pick-count></span>
      </div>
      ${groups
        .map(
          (g) => `
        <fieldset class="o-pick-group"><legend>${esc(g.topic.title)}</legend>
          ${g.tests
            .map((x) => {
              const c = testClass(x, state);
              return `<label class="o-check-row">
                <input type="checkbox" name="pick-test" value="${x.id}" ${selected.includes(x.id) ? 'checked' : ''} ${canMatch && matches(x, book, state) ? 'data-match="1"' : ''} />
                <span><b>${esc(x.title)}</b><small>${esc([bookLabel(c), `${x.question_count} сұрақ`].filter(Boolean).join(' · '))}</small></span>
                ${x.live ? '<span class="o-badge o-badge-on">Жарияланған</span>' : '<span class="o-badge o-badge-off">Жарияланбаған</span>'}
              </label>`;
            })
            .join('')}
        </fieldset>`,
        )
        .join('')}`,
    buttons: [
      { label: 'Болдырмау', value: null, kind: 'ghost' },
      { label: 'Сақтау', value: 'ok' },
    ],
    onOpen(modal) {
      modalRef = modal;
      const boxes = () => [...modal.querySelectorAll('[name="pick-test"]')];
      const count = () => {
        modal.querySelector('[data-pick-count]').textContent = `${boxes().filter((b) => b.checked).length} тест белгіленді`;
      };
      count();
      modal.addEventListener('change', count);
      modal.addEventListener('click', (e) => {
        const act = e.target.closest('[data-pick]')?.dataset.pick;
        if (!act) return;
        for (const b of boxes()) {
          if (act === 'all') b.checked = true;
          if (act === 'none') b.checked = false;
          if (act === 'match' && b.dataset.match) b.checked = true;
        }
        if (act === 'match' && !boxes().some((b) => b.dataset.match)) toast('Бұл кітаптың сыныбы мен баспасына сәйкес тест табылмады.', 'error');
        count();
      });
    },
  });
  if (value !== 'ok' || !modalRef) return null;
  return [...modalRef.querySelectorAll('[name="pick-test"]:checked')].map((b) => Number(b.value));
}

export async function shelvesView(el, _params, ctx, alive) {
  let [{ entries }, { books }] = await Promise.all([org.get('/period-books'), org.get('/books'), ctx.reload()]);
  if (!alive()) return;
  const bookOf = (e) => books.find((b) => b.id === e.book_id) || null;
  /** Only tests that are still in the period count (a test moved to another topic drops out). */
  const testsOf = (e) => {
    const ids = new Set(periodGroups(ctx.state, e.period_id).flatMap((g) => g.tests.map((x) => x.id)));
    return ctx.state.tests.filter((x) => ids.has(x.id) && e.test_ids.includes(x.id));
  };

  const entryRow = (e, i, list) => {
    const book = bookOf(e);
    const tests = testsOf(e);
    const problems = entryProblems(e, book, tests);
    return `
      <li class="o-row o-shelf-row" data-entry="${e.id}">
        <div class="o-order">
          <button type="button" class="o-icon-btn" data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="Жоғары">▲</button>
          <button type="button" class="o-icon-btn" data-act="down" ${i === list.length - 1 ? 'disabled' : ''} aria-label="Төмен">▼</button>
        </div>
        ${thumb(book)}
        <div class="o-row-body">
          ${book && bookLabel(book) ? `<span class="o-shelf-label">${esc(bookLabel(book))}</span>` : ''}
          <b>${esc(book?.title || 'Кітап табылмады')}</b>
          <small>${tests.length} тест таңдалған${tests.length ? `, оның ${tests.filter((x) => x.live).length} жарияланған` : ''}</small>
          ${problems.length ? `<small class="o-warn">${esc(problems.join(' '))}</small>` : '<small class="o-ok-text">Оқушыларға көрінеді.</small>'}
        </div>
        <div class="o-row-actions">
          <button type="button" class="btn btn-sm" data-act="tests">Тесттер</button>
          <button type="button" class="btn btn-ghost btn-sm" data-act="replace">Кітапты ауыстыру</button>
          <button type="button" class="o-icon-btn o-danger" data-act="remove" aria-label="Кезеңнен алып тастау" title="Кезеңнен алып тастау">${icon('cross')}</button>
        </div>
      </li>`;
  };

  const draw = () => {
    el.innerHTML = `
      <section class="o-card">
        <div class="o-card-head"><div><h2>Кезең кітаптары</h2>
          <p class="o-muted">Әр кезеңге «Кітаптар» бөліміндегі оқулықтарды бекітіп, әр кітаптың тесттерін белгілеңіз. Оқушы кезеңді ашқанда алдымен кітапты таңдайды, сосын тек сол кітаптың тесттерін көреді. Кітап бекітілмеген кезеңде оқушы бұрынғыдай тақырыптар тізімін көреді. Өзгерістер бірден сайтқа шығады.</p></div>
          <a class="btn btn-ghost btn-sm" href="/organizer/books" data-link>Кітаптар бөлімі</a></div>
      </section>
      ${ctx.state.periods
        .map((p) => {
          const list = entries.filter((e) => e.period_id === p.id);
          return `
        <section class="o-card o-shelf" data-period="${p.id}">
          <div class="o-card-head"><div><h2>${pad2(p.position || p.id)} · ${esc(p.title)}</h2>
            <p class="o-muted">${list.length ? `${list.length} кітап бекітілген` : 'Кітап бекітілмеген: оқушылар бұл кезеңде тақырыптар тізімін көреді.'}</p></div>
            <button type="button" class="btn btn-sm" data-act="add">+ Кітап бекіту</button></div>
          ${list.length ? `<ol class="o-rows">${list.map(entryRow).join('')}</ol>` : ''}
        </section>`;
        })
        .join('')}`;
  };
  draw();

  const refresh = async () => {
    ({ entries } = await org.get('/period-books'));
    draw();
  };

  /** Ticks the tests of an entry and saves them. */
  async function editTests(entry) {
    const period = ctx.state.periods.find((p) => p.id === entry.period_id);
    const ids = await pickTests(ctx.state, period, bookOf(entry), testsOf(entry).map((x) => x.id));
    if (!ids) return false;
    await org.put(`/period-books/${entry.id}`, { test_ids: ids });
    toast(`Сақталды: ${ids.length} тест.`);
    return true;
  }

  el.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const period = ctx.state.periods.find((p) => p.id === Number(btn.closest('[data-period]')?.dataset.period));
    if (!period) return;
    const list = entries.filter((x) => x.period_id === period.id);
    const entry = list.find((x) => x.id === Number(btn.closest('[data-entry]')?.dataset.entry));
    try {
      if (act === 'add') {
        const bookId = await pickBook(books, { taken: new Set(list.map((x) => x.book_id)), title: `«${period.title}» кезеңіне кітап бекіту` });
        if (!bookId) return;
        const created = await busy(btn, () => org.post('/period-books', { period_id: period.id, book_id: bookId }));
        if (!created) return;
        toast('Кітап бекітілді. Енді оның тесттерін белгілеңіз.');
        await refresh();
        await editTests(created);
        return refresh();
      }
      if (!entry) return;
      if (act === 'tests') {
        if (await editTests(entry)) await refresh();
      } else if (act === 'replace') {
        const bookId = await pickBook(books, { taken: new Set(list.map((x) => x.book_id)), current: entry.book_id, title: 'Кітапты ауыстыру' });
        if (!bookId) return;
        await busy(btn, () => org.put(`/period-books/${entry.id}`, { book_id: bookId }));
        toast('Кітап ауыстырылды, тесттер сол күйінде қалды.');
        await refresh();
      } else if (act === 'remove') {
        const book = bookOf(entry);
        const ok = await confirmDialog(
          'Кітапты кезеңнен алып тастау',
          `«${book?.title || 'Кітап'}» «${period.title}» кезеңінен алынады. Кітаптың өзі «Кітаптар» бөлімінде, тесттер «Тесттер» бөлімінде қалады; оқушылардың нәтижелері жойылмайды.`,
          { ok: 'Алып тастау', danger: true },
        );
        if (!ok) return;
        await busy(btn, () => org.del(`/period-books/${entry.id}`));
        toast('Кітап кезеңнен алынды.');
        await refresh();
      } else if (act === 'up' || act === 'down') {
        const i = list.indexOf(entry);
        const j = i + (act === 'up' ? -1 : 1);
        if (j < 0 || j >= list.length) return;
        const ids = list.map((x) => x.id);
        [ids[i], ids[j]] = [ids[j], ids[i]];
        await busy(btn, () => org.post('/period-books/reorder', { ids }));
        await refresh();
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

/**
 * The card in the test editor: which books of the test's period it belongs to. It works on the
 * saved topic (the server checks the same), so a new test is linked right after it is saved.
 */
export async function mountShelfCard(holder, test, ctx, cache) {
  if (!holder) return;
  holder.shelfArgs = { test, ctx, cache };
  const topic = ctx.state.topics.find((t) => t.id === test.saved_topic_id);
  if (!topic) {
    holder.innerHTML = '';
    return;
  }
  if (!cache.data) {
    const [{ entries }, { books }] = await Promise.all([org.get('/period-books'), org.get('/books')]);
    cache.data = { entries, books };
  }
  if (!holder.isConnected) return;
  const period = ctx.state.periods.find((p) => p.id === topic.period_id);
  const entries = cache.data.entries.filter((e) => e.period_id === topic.period_id);
  const bookOf = (e) => cache.data.books.find((b) => b.id === e.book_id);
  holder.innerHTML = `
    <section class="o-card o-shelf-card">
      <div class="o-card-head"><div><h2>Кезең кітаптары</h2>
        <p class="o-muted">Оқушы «${esc(period?.title || '')}» кезеңінде қай кітапты таңдағанда осы тестті көреді. Белгі бірден сақталады.</p></div>
        <a class="btn btn-ghost btn-sm" href="/organizer/period-books" data-link>Кезең кітаптары</a></div>
      ${
        entries.length
          ? `<div class="o-shelf-checks">${entries
              .map((e) => {
                const b = bookOf(e);
                return `<label class="o-check-row">
                  <input type="checkbox" data-shelf-entry="${e.id}" ${e.test_ids.includes(test.id) ? 'checked' : ''} />
                  ${thumb(b)}
                  <span><b>${esc(b ? bookLabel(b) || b.title : 'Кітап табылмады')}</b><small>${esc(b && bookLabel(b) ? b.title : '')}${b && !b.published ? ' · кітап жасырын' : ''}</small></span>
                </label>`;
              })
              .join('')}</div>`
          : '<p class="o-muted">Бұл кезеңге әлі кітап бекітілмеген. «Кезең кітаптары» бөлімінде кітап қосыңыз.</p>'
      }
    </section>`;
  if (holder.dataset.shelfBound) return;
  holder.dataset.shelfBound = '1';
  holder.addEventListener('change', async (e) => {
    if (!e.target.dataset.shelfEntry) return;
    const { test, ctx, cache } = holder.shelfArgs;
    const topic = ctx.state.topics.find((t) => t.id === test.saved_topic_id);
    if (!topic) return;
    const ids = [...holder.querySelectorAll('[data-shelf-entry]:checked')].map((b) => Number(b.dataset.shelfEntry));
    holder.querySelectorAll('[data-shelf-entry]').forEach((b) => (b.disabled = true));
    try {
      const { entries: fresh } = await org.put(`/period-books/test/${test.id}`, { entry_ids: ids });
      cache.data.entries = cache.data.entries.filter((x) => x.period_id !== topic.period_id).concat(fresh);
      toast('Тесттің кітаптары сақталды.');
    } catch (err) {
      toast(err.message, 'error');
    }
    mountShelfCard(holder, test, ctx, cache);
  });
}
