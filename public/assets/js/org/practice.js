import { org } from './api.js';
import { esc, icon, toast, dialog, confirmDialog, input, textarea, select, toggle, formValues, busy } from './ui.js';
import { reviewList } from '../views/review.js';

// «Карточкалар» and «Сынақ тесттер» in the cabinet. Cards and the mock settings are live: a save
// reaches the students at once, without «Жариялау».

const pad2 = (n) => String(n).padStart(2, '0');
const KIND = { date: 'Дата', person: 'Тұлға' };
const when = (value) => {
  if (!value) return '';
  const d = new Date(`${String(value).replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ru-RU', { timeZone: 'Asia/Almaty', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const duration = (sec) => {
  const s = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const num = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));
const LIVE_NOTE = `<p class="o-alert o-alert-ok o-live-note">${icon('info')} Мұндағы өзгеріс оқушыларға бірден көрінеді, «Жариялау» қажет емес.</p>`;

// ─── Карточкалар ─────────────────────────────────────────────────
export async function cardsAdminView(el, _params, _ctx, alive) {
  let data = await org.get('/practice/cards');
  if (!alive()) return;
  let kind = '';
  let period = '';
  let search = '';

  const periodTitle = (n) => data.periods.find((p) => p.number === n)?.title || 'Кезеңсіз';

  function cardForm(c = {}) {
    return `<form class="o-form" data-card-form>
      ${select({ name: 'kind', label: 'Түрі', value: c.kind || kind || 'date', options: [{ value: 'date', label: 'Дата: жыл және оқиға' }, { value: 'person', label: 'Тұлға: аты және кім екені' }], required: true })}
      ${input({ name: 'front', label: 'Алдыңғы беті (дата немесе есім)', value: c.front || '', max: 120, required: true, hint: 'Мысалы: 1465 немесе Абылай хан' })}
      ${textarea({ name: 'back', label: 'Артқы беті (оқиға немесе кім екені)', value: c.back || '', rows: 2, max: 300, required: true })}
      ${textarea({ name: 'note', label: 'Қосымша түсінік', value: c.note || '', rows: 2, max: 500, hint: 'Міндетті емес. Карточка аударылғанда төменде шығады.' })}
      ${input({ name: 'source', label: 'Дереккөзі (кітап, бет)', value: c.source || '', max: 300, hint: 'Мысалы: Қазақстан тарихы, 10-сынып (Мектеп, 2019), 139-бет. Карточканың астында кішкене жазумен шығады.' })}
      ${select({ name: 'period_number', label: 'Кезең', value: c.period_number ?? (period || ''), options: [{ value: '', label: 'Кезеңсіз' }, ...data.periods.map((p) => ({ value: p.number, label: `${pad2(p.number)} · ${p.title}` }))] })}
      ${toggle({ name: 'published', label: 'Оқушыларға көрсету', checked: c.published !== false })}
    </form>`;
  }

  async function edit(card) {
    let saved = null;
    await dialog({
      title: card ? 'Карточканы өңдеу' : 'Жаңа карточка',
      body: cardForm(card || {}),
      buttons: [],
      onOpen(modal, close) {
        const form = modal.querySelector('form');
        const foot = document.createElement('footer');
        foot.innerHTML = `<button type="button" class="btn btn-sm btn-ghost" data-cancel>Болдырмау</button><button type="submit" class="btn btn-sm" data-save>Сақтау</button>`;
        modal.append(foot);
        foot.querySelector('[data-cancel]').addEventListener('click', () => close(null));
        const submit = (e) => {
          e?.preventDefault();
          if (!form.reportValidity()) return;
          busy(foot.querySelector('[data-save]'), async () => {
            const v = formValues(form);
            const body = { ...v, period_number: v.period_number === '' ? null : Number(v.period_number) };
            saved = card ? await org.put(`/practice/cards/${card.id}`, body) : await org.post('/practice/cards', body);
            close(true);
          });
        };
        form.addEventListener('submit', submit);
        foot.querySelector('[data-save]').addEventListener('click', submit);
        form.querySelector('[name="front"]').focus();
      },
    });
    if (saved) {
      toast(card ? 'Карточка сақталды' : 'Карточка қосылды');
      await reload();
    }
  }

  async function reload() {
    data = await org.get('/practice/cards');
    if (alive()) draw();
  }

  const shown = () =>
    data.cards.filter(
      (c) =>
        (!kind || c.kind === kind) &&
        (!period || String(c.period_number ?? '') === period) &&
        (!search || `${c.front} ${c.back} ${c.note} ${c.source}`.toLocaleLowerCase('kk').includes(search)),
    );

  function row(c) {
    return `<li class="o-row${c.published ? '' : ' is-off'}">
      <span class="o-row-icon o-card-kind o-card-kind-${c.kind}">${icon(c.kind === 'date' ? 'clock' : 'profile')}</span>
      <div class="o-row-body o-cardrow">
        <b>${esc(c.front)}</b>
        <span>${esc(c.back)}</span>
        ${c.note ? `<small class="o-muted">${esc(c.note)}</small>` : ''}
        ${c.source ? `<small class="o-cardrow-src">${icon('materials')} ${esc(c.source)}</small>` : ''}
        ${c.learned_by ? `<small class="o-cardrow-learned">${icon('check')} ${c.learned_by} оқушы меңгерді</small>` : ''}
      </div>
      <div class="o-row-actions">
        ${c.published ? '' : '<span class="o-badge o-badge-off">Жасырын</span>'}
        <button type="button" class="btn btn-sm btn-ghost" data-edit="${c.id}">Өңдеу</button>
        <button type="button" class="o-icon-btn" data-del="${c.id}" aria-label="Өшіру" title="Өшіру">${icon('cross')}</button>
      </div>
    </li>`;
  }

  function draw() {
    const list = shown();
    const groups = new Map();
    for (const c of list) {
      const k = c.period_number ?? 0;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(c);
    }
    const dates = data.cards.filter((c) => c.kind === 'date').length;
    el.innerHTML = `
      <div class="o-toolbar">
        <button type="button" class="btn" data-add>+ Карточка қосу</button>
        <a class="btn btn-ghost" href="/cards" target="_blank" rel="noopener">Оқушы көрінісі</a>
      </div>
      ${LIVE_NOTE}
      <section class="o-card o-card-tight">
        <div class="o-filters">
          <label class="o-field"><span class="o-label">Түрі</span>
            <select data-filter="kind">
              <option value="">Барлығы (${data.cards.length})</option>
              <option value="date" ${kind === 'date' ? 'selected' : ''}>Даталар (${dates})</option>
              <option value="person" ${kind === 'person' ? 'selected' : ''}>Тұлғалар (${data.cards.length - dates})</option>
            </select></label>
          <label class="o-field"><span class="o-label">Кезең</span>
            <select data-filter="period"><option value="">Барлық кезең</option>${data.periods
              .map((p) => `<option value="${p.number}" ${String(p.number) === period ? 'selected' : ''}>${pad2(p.number)} · ${esc(p.title)}</option>`)
              .join('')}</select></label>
          <label class="o-field"><span class="o-label">Іздеу</span><input data-filter="search" value="${esc(search)}" placeholder="Дата, есім, оқиға" /></label>
        </div>
        <p class="o-muted">${list.length} карточка көрсетілді</p>
      </section>
      ${
        list.length
          ? [...groups.entries()]
              .sort((a, b) => (a[0] || 99) - (b[0] || 99))
              .map(
                ([n, cards]) => `<section class="o-card o-card-tight">
                  <div class="o-card-head"><div>${n ? `<p class="eyebrow">${pad2(n)} кезең</p>` : ''}<h2>${esc(n ? periodTitle(n) : 'Кезеңсіз')} <span class="o-count">${cards.length}</span></h2></div></div>
                  <ul class="o-rows">${cards.map(row).join('')}</ul></section>`,
              )
              .join('')
          : '<section class="o-card"><p class="o-muted">Бұл сүзгі бойынша карточка жоқ.</p></section>'
      }`;
  }

  draw();
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-add]')) return edit(null);
    const ed = e.target.closest('[data-edit]');
    if (ed) return edit(data.cards.find((c) => c.id === Number(ed.dataset.edit)));
    const del = e.target.closest('[data-del]');
    if (del) {
      const c = data.cards.find((x) => x.id === Number(del.dataset.del));
      if (!(await confirmDialog('Карточканы өшіру', `«${c.front}» өшірілсін бе? Оқушылардың осы карточкадағы прогресі де өшеді.`, { ok: 'Өшіру', danger: true }))) return;
      try {
        await org.del(`/practice/cards/${c.id}`);
        toast('Карточка өшірілді');
        await reload();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });
  el.addEventListener('change', (e) => {
    const f = e.target.dataset.filter;
    if (f === 'kind') kind = e.target.value;
    else if (f === 'period') period = e.target.value;
    else return;
    draw();
  });
  el.addEventListener('input', (e) => {
    if (e.target.dataset.filter !== 'search') return;
    search = e.target.value.trim().toLocaleLowerCase('kk');
    const pos = e.target.selectionStart;
    draw();
    const box = el.querySelector('[data-filter="search"]');
    box.focus();
    box.setSelectionRange(pos, pos);
  });
}

// ─── Сынақ тесттер ──────────────────────────────────────────────────
const LEVEL_TEXT = { A: 'А деңгейі: дерек, 1 балл', B: 'В деңгейі: түсіну, 1 балл', C: 'С деңгейі: бірнеше жауап, сәйкестендіру, реттілік, 2 балл' };

export async function mockAdminView(el, _params, _ctx, alive) {
  let data = await org.get('/practice/mock');
  if (!alive()) return;
  let open = null; // the variant read through below, with its answers

  const pname = (n) => data.periods.find((p) => p.number === Number(n))?.title || `${n}-кезең`;

  function draw() {
    const { settings, runs, variants } = data;
    const avg = runs.length ? Math.round((runs.reduce((s, r) => s + r.score / Math.max(1, r.max_score), 0) / runs.length) * 100) : 0;
    const shape = variants[0];
    el.innerHTML = `
      <div class="o-toolbar"><a class="btn btn-ghost" href="/sinaq" target="_blank" rel="noopener">Оқушы көрінісі</a></div>
      ${LIVE_NOTE}
      <div class="o-mock-grid">
        <section class="o-card">
          <div class="o-card-head"><h2>Сынақ баптаулары</h2></div>
          <form class="o-form" data-mock-form>
            ${input({ name: 'time_min', label: 'Бір нұсқаға уақыт (минут)', type: 'number', value: settings.time_min, hint: `10-нан 240-қа дейін. Әдепкі: ${data.defaults.time_min}.` })}
            <p class="o-muted">Әр нұсқада ${shape.questions} сұрақ, ең жоғары балл — ${shape.max_score}. С деңгейінде толық жауап 2 балл, бір қатемен 1 балл.</p>
            <div><button type="submit" class="btn" data-save>Сақтау</button></div>
          </form>
        </section>
        <section class="o-card">
          <div class="o-card-head"><h2>Нұсқа құрылымы</h2></div>
          <ul class="o-mock-pool">
            ${['A', 'B', 'C'].map((l) => `<li><span>${esc(LEVEL_TEXT[l])}</span><b>${shape.levels[l] || 0}</b></li>`).join('')}
            ${Object.entries(shape.periods).map(([n, c]) => `<li><span>${pad2(n)} · ${esc(pname(n))}</span><b>${c}</b></li>`).join('')}
          </ul>
          <p class="o-muted">Сұрақтар сайттағы оқулық тесттерінен құралып, әрқайсысы жауабымен тексерілген. Түсініктемесінде оқулық пен беті көрсетілген. Нұсқалар арасында сұрақ қайталанбайды.</p>
        </section>
      </div>
      <section class="o-card o-card-tight">
        <div class="o-card-head"><h2>Нұсқалар <span class="o-count">${variants.length}</span></h2></div>
        <ul class="o-variants">
          ${variants
            .map(
              (v) => `<li><button type="button" class="${open?.number === v.number ? 'is-open' : ''}" data-variant="${v.number}">
                <b>${v.number}-нұсқа</b><small>${v.tries ? `${v.tries} рет тапсырылды · орташа ${v.average_percent}%` : 'Әлі тапсырылмаған'}</small></button></li>`,
            )
            .join('')}
        </ul>
        <p class="o-muted">Нұсқаны басып, сұрақтарын дұрыс жауабымен қараңыз.</p>
      </section>
      ${
        open
          ? `<section class="o-card o-card-tight o-variant-read">
              <div class="o-card-head"><h2>${open.number}-нұсқа: сұрақтар мен жауаптар</h2><button type="button" class="btn btn-sm btn-ghost" data-close>Жабу</button></div>
              ${reviewList(open.items)}
            </section>`
          : ''
      }
      <section class="o-card o-card-tight">
        <div class="o-card-head"><h2>Тапсырылған сынақтар <span class="o-count">${runs.length}</span></h2></div>
        ${runs.length ? `<p class="o-muted">Орташа нәтиже: ${avg}%</p>` : ''}
        ${
          runs.length
            ? `<div class="o-table-wrap"><table class="o-table">
                <thead><tr><th>Оқушы</th><th>Күні</th><th>Нұсқа</th><th>Балл</th><th>Дұрыс</th><th>Уақыт</th></tr></thead>
                <tbody>${runs
                  .map(
                    (r) => `<tr>
                      <td><b>${esc(r.display_name)}</b><br /><small class="o-muted">${esc(r.email || '')}</small></td>
                      <td>${esc(when(r.created_at))}</td>
                      <td>${r.variant ? `${r.variant}-нұсқа` : '<small class="o-muted">ескі сынақ</small>'}</td>
                      <td><b>${num(r.score)}</b> / ${num(r.max_score)}</td>
                      <td>${r.correct} / ${r.total} · ${Math.round((r.correct / Math.max(1, r.total)) * 100)}%</td>
                      <td>${duration(r.duration_sec)}</td>
                    </tr>`,
                  )
                  .join('')}</tbody></table></div>`
            : '<p class="o-muted">Әзірге ешкім сынақ тапсырмады.</p>'
        }
      </section>`;
    const form = el.querySelector('[data-mock-form]');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      busy(form.querySelector('[data-save]'), async () => {
        const v = formValues(form);
        const r = await org.put('/practice/mock', { time_min: Number(v.time_min) });
        data.settings = r.settings;
        toast(`Сақталды: ${r.settings.time_min} минут`);
        draw();
      });
    });
    el.querySelectorAll('[data-variant]').forEach((b) =>
      b.addEventListener('click', async () => {
        const n = Number(b.dataset.variant);
        if (open?.number === n) open = null;
        else {
          try {
            open = await org.get(`/practice/mock/variants/${n}`);
          } catch (err) {
            toast(err.message, 'error');
            return;
          }
        }
        if (!alive()) return;
        draw();
        el.querySelector('.o-variant-read')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }),
    );
    el.querySelector('[data-close]')?.addEventListener('click', () => {
      open = null;
      draw();
    });
  }
  draw();
}
