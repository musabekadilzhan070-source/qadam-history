import { org } from './api.js';
import { EMBLEMS, EMBLEM_CATEGORIES, emblemSvg } from '../emblems.js';
import { esc, toast, dialog, confirmDialog, fileSrc, pickFiles, uploadFiles, select, topicOptions } from './ui.js';

// Emblem library: 128 built-in historical emblems in 18 categories plus the organizer's own uploads.
// A topic stores {kind:'emblem', name} for a built-in one and {kind:'file', id} for an upload.

const CATEGORY = Object.fromEntries(EMBLEM_CATEGORIES);
const norm = (s) => String(s).toLocaleLowerCase('kk');

/** Built-in and own emblems as one list: { key, name, category, value, html }. */
function library(ctx) {
  const own = ctx.state.emblems.map((e) => ({
    key: `file-${e.file_id}`,
    own: e,
    name: e.name,
    category: e.category,
    value: { kind: 'file', id: e.file_id },
    html: `<img class="o-emblem-img" src="${fileSrc({ id: e.file_id, version: e.version })}" alt="" />`,
  }));
  const builtin = EMBLEMS.map((e) => ({ key: e.id, name: e.name, category: e.category, value: { kind: 'emblem', name: e.id }, html: emblemSvg(e.id, 'o-emblem-svg') }));
  return [...own, ...builtin];
}

const sameIcon = (a, b) => a && b && a.kind === b.kind && (a.kind === 'file' ? a.id === b.id : a.name === b.name);

/** Topics that show this emblem. */
const usedBy = (ctx, value) => ctx.state.topics.filter((t) => sameIcon(t.icon, value));

function filters(q, cat) {
  return `
    <div class="o-emblem-tools">
      <label class="o-field o-search"><span class="visually-hidden">Іздеу</span><input type="search" data-q value="${esc(q)}" placeholder="Эмблеманы атауы бойынша іздеу" /></label>
      <label class="o-field"><span class="visually-hidden">Санат</span>
        <select data-cat><option value="">Барлық санаттар (18)</option>${EMBLEM_CATEGORIES.map(([k, l]) => `<option value="${k}" ${k === cat ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
    </div>`;
}

const matches = (item, q, cat) => (!cat || item.category === cat) && (!q || norm(`${item.name} ${CATEGORY[item.category]}`).includes(norm(q)));

function grid(items, { current = null, ctx = null } = {}) {
  if (!items.length) return '<p class="o-muted">Ештеңе табылмады. Басқа сөзбен іздеп көріңіз.</p>';
  const groups = EMBLEM_CATEGORIES.map(([k, label]) => [label, items.filter((i) => i.category === k)]).filter(([, list]) => list.length);
  return groups
    .map(
      ([label, list]) => `<h3 class="o-sub">${esc(label)} <small>${list.length}</small></h3>
      <div class="o-emblem-grid">${list
        .map((i) => {
          const used = ctx ? usedBy(ctx, i.value) : [];
          return `<button type="button" class="o-emblem${sameIcon(current, i.value) ? ' is-on' : ''}${i.own ? ' is-own' : ''}" data-key="${esc(i.key)}" title="${esc(i.name)}">
            ${i.html}<span>${esc(i.name)}</span>${used.length ? `<small class="o-emblem-used">${used.length} тақырыпта</small>` : ''}${i.own ? '<small class="o-emblem-own">Өз эмблемаңыз</small>' : ''}</button>`;
        })
        .join('')}</div>`,
    )
    .join('');
}

/** Picker for a topic's emblem: search, category, own upload. Resolves with an icon value or null. */
export function chooseEmblem(ctx, current) {
  let q = '';
  let cat = current?.kind === 'emblem' ? EMBLEMS.find((e) => e.id === current.name)?.category || '' : '';
  const items = () => library(ctx);
  const size = current?.size || 22;
  return dialog({
    title: 'Тақырып эмблемасын таңдау',
    wide: true,
    body: `${filters(q, cat)}
      <div class="o-lib-tools"><button type="button" class="btn btn-sm btn-dark" data-up>Өз эмблемаңызды жүктеу</button></div>
      <div class="o-emblem-list" data-list></div>`,
    onOpen(box, close) {
      const paint = () => {
        box.querySelector('[data-list]').innerHTML = grid(items().filter((i) => matches(i, q, cat)), { current, ctx });
      };
      box.querySelector('[data-q]').addEventListener('input', (e) => {
        q = e.target.value.trim();
        paint();
      });
      box.querySelector('[data-cat]').addEventListener('change', (e) => {
        cat = e.target.value;
        paint();
      });
      box.addEventListener('click', async (e) => {
        const b = e.target.closest('.o-emblem');
        if (b) {
          const item = items().find((i) => i.key === b.dataset.key);
          return close({ ...item.value, size });
        }
        if (e.target.closest('[data-up]')) {
          const created = await addOwnEmblem(ctx, cat);
          if (created) close({ kind: 'file', id: created.file_id, size });
        }
      });
      paint();
      box.querySelector('[data-q]').focus();
    },
  });
}

/** Upload of the organizer's own emblem with a name and a category. Resolves with the created row or null. */
async function addOwnEmblem(ctx, category = '') {
  let file = null;
  let fields = { name: '', category };
  const ok = await dialog({
    title: 'Өз эмблемаңызды қосу',
    body: `<p class="o-muted">PNG, WEBP немесе SVG, 300 КБ дейін. Портрет пен картаны «Суреттер» бөліміне жүктеңіз: эмблема — шағын белгі.</p>
      <label class="o-field"><span class="o-label">Атауы <i>*</i></span><input data-name maxlength="80" placeholder="Мысалы: Ұлытау белгісі" /></label>
      ${select({ name: 'em-cat', label: 'Санаты', value: category, options: [{ value: '', label: '— Санатты таңдаңыз —' }, ...EMBLEM_CATEGORIES.map(([value, label]) => ({ value, label }))], required: true })}
      <div class="o-field"><span class="o-label">Файл <i>*</i></span><div class="o-file-box"><span class="o-file-preview" data-file>Таңдалмаған</span><button type="button" class="btn btn-sm btn-dark" data-pick>Файл таңдау</button></div></div>`,
    buttons: [
      { label: 'Болдырмау', value: false, kind: 'ghost' },
      { label: 'Қосу', value: true, kind: 'primary' },
    ],
    onOpen(box) {
      box.addEventListener('input', () => {
        fields = { name: box.querySelector('[data-name]').value.trim(), category: box.querySelector('[name="em-cat"]').value };
      });
      box.addEventListener('change', () => {
        fields = { name: box.querySelector('[data-name]').value.trim(), category: box.querySelector('[name="em-cat"]').value };
      });
      box.querySelector('[data-pick]').addEventListener('click', async () => {
        [file] = await pickFiles('icon');
        if (file) box.querySelector('[data-file]').textContent = file.name;
      });
      box.querySelector('[data-name]').focus();
    },
  });
  if (!ok) return null;
  if (!fields.name) return toast('Эмблема атауын жазыңыз.', 'error'), null;
  if (!fields.category) return toast('Эмблема санатын таңдаңыз.', 'error'), null;
  if (!file) return toast('Эмблема файлын таңдаңыз.', 'error'), null;
  const [uploaded] = await uploadFiles('icon', [file], ctx);
  if (!uploaded) return null;
  try {
    await org.post('/emblems', { name: fields.name, category: fields.category, file_id: uploaded.id });
    await ctx.reload();
    toast('Эмблема кітапханаға қосылды.');
    return ctx.state.emblems.find((e) => e.file_id === uploaded.id);
  } catch (err) {
    toast(err.message, 'error');
    return null;
  }
}

/** Assigns an emblem to a topic (draft); offers to publish right away. */
async function assign(ctx, topicId, value) {
  const t = ctx.state.topics.find((x) => x.id === topicId);
  await org.put(`/topics/${t.id}`, {
    period_id: t.period_id, title: t.title, slug: t.slug, range_label: t.range_label, summary: t.summary, body: t.body,
    key_points: t.key_points, image_id: t.image_id, published: Boolean(t.published), icon: { ...value, size: t.icon?.size || 22 },
  });
  await ctx.reload();
  return t;
}

// ─── Section ─────────────────────────────────────────────────────
export function emblemsView(el, _params, ctx) {
  let q = '';
  let cat = '';
  const draw = () => {
    const all = library(ctx);
    const shown = all.filter((i) => matches(i, q, cat));
    el.querySelector('[data-list]').innerHTML = grid(shown, { ctx });
    el.querySelector('[data-count]').textContent = `${shown.length} / ${all.length} эмблема`;
  };
  el.innerHTML = `
    <section class="o-card">
      <div class="o-card-head">
        <div><h2>Эмблемалар кітапханасы</h2><p class="o-muted">Әр тақырыптың өз эмблемасы бар. Эмблеманы ашып, тақырыпқа беріңіз немесе өз эмблемаңызды жүктеңіз. Тақырып беттерінде, тізімдерде және тест карталарында көрсетіледі.</p></div>
        <button type="button" class="btn btn-dark" data-add>+ Өз эмблемаңыз</button>
      </div>
      ${filters(q, cat)}
      <p class="o-muted" data-count></p>
      <div class="o-emblem-list" data-list></div>
    </section>`;
  el.querySelector('[data-q]').addEventListener('input', (e) => {
    q = e.target.value.trim();
    draw();
  });
  el.querySelector('[data-cat]').addEventListener('change', (e) => {
    cat = e.target.value;
    draw();
  });
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-add]')) {
      if (await addOwnEmblem(ctx, cat)) draw();
      return;
    }
    const b = e.target.closest('.o-emblem');
    if (!b) return;
    const item = library(ctx).find((i) => i.key === b.dataset.key);
    await openEmblem(ctx, item);
    draw();
  });
  draw();
}

/** Large preview, where it is used, and «assign to topic»; own emblems can be renamed or removed. */
async function openEmblem(ctx, item) {
  const used = usedBy(ctx, item.value);
  const big = item.own ? item.html.replace('o-emblem-img', 'o-emblem-big') : emblemSvg(item.key, 'o-emblem-big');
  let topicId = '';
  let ownFields = item.own ? { name: item.own.name, category: item.own.category } : null;
  const choice = await dialog({
    title: item.name,
    body: `
      <div class="o-emblem-preview">
        <div class="o-emblem-stage is-light">${big}</div>
        <div class="o-emblem-stage is-dark">${big}</div>
      </div>
      <p><b>Санаты:</b> ${esc(CATEGORY[item.category])}</p>
      <p class="o-muted">${used.length ? `Қолданылып тұр: ${used.map((t) => esc(t.title)).join(', ')}` : 'Әзірге ешбір тақырыпта қолданылмаған.'}</p>
      ${
        item.own
          ? `<div class="o-grid-2"><label class="o-field"><span class="o-label">Атауы</span><input data-own-name maxlength="80" value="${esc(item.own.name)}" /></label>
             ${select({ name: 'own-cat', label: 'Санаты', value: item.own.category, options: EMBLEM_CATEGORIES.map(([value, label]) => ({ value, label })) })}</div>`
          : ''
      }
      ${select({ name: 'assign-topic', label: 'Тақырыпқа беру', value: '', options: topicOptions(ctx.state, { empty: '— Тақырыпты таңдаңыз —' }) })}`,
    buttons: [
      ...(item.own ? [{ label: 'Жою', value: 'delete', kind: 'danger' }, { label: 'Атауын сақтау', value: 'rename', kind: 'ghost' }] : [{ label: 'Жабу', value: null, kind: 'ghost' }]),
      { label: 'Тақырыпқа беру', value: 'assign', kind: 'primary' },
    ],
    onOpen(box) {
      box.addEventListener('change', () => {
        topicId = box.querySelector('[name="assign-topic"]').value;
        if (item.own) ownFields = { name: box.querySelector('[data-own-name]').value, category: box.querySelector('[name="own-cat"]').value };
      });
      box.addEventListener('input', () => {
        if (item.own) ownFields = { ...ownFields, name: box.querySelector('[data-own-name]').value };
      });
    },
  });
  try {
    if (choice === 'assign') {
      if (!topicId) return toast('Эмблеманы беретін тақырыпты таңдаңыз.', 'error');
      const t = await assign(ctx, Number(topicId), item.value);
      toast(`«${item.name}» эмблемасы «${t.title}» тақырыбына берілді.`);
      if (await confirmDialog('Сайтқа жариялау', 'Эмблема оқушыларға жариялағаннан кейін көрінеді. Қазір жариялайсыз ба?', { ok: 'Жариялауға өту' })) await ctx.publish();
    } else if (choice === 'rename') {
      await org.put(`/emblems/${item.own.id}`, ownFields);
      await ctx.reload();
      toast('Эмблема сақталды.');
    } else if (choice === 'delete') {
      const note = used.length ? ' Ол тақырыптарда көрсетіле береді: файл «Белгішелер» бөлімінде қалады.' : '';
      if (!(await confirmDialog('Эмблеманы жою', `«${item.name}» кітапханадан алынады.${note}`, { ok: 'Жою', danger: true }))) return;
      await org.del(`/emblems/${item.own.id}`);
      await ctx.reload();
      toast('Эмблема кітапханадан алынды.');
    }
  } catch (err) {
    toast(err.message, 'error');
  }
}
