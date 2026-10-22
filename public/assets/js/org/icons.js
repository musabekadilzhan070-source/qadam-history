import { org } from './api.js';
import { ICON_SLOTS, renderIcon } from '../site.js';
import { chooseEmblem } from './emblems.js';
import { esc, icon, toast, dialog, confirmDialog, fileSrc, formatBytes, pickFiles, uploadFiles, busy } from './ui.js';

// Built-in library: the site's own line icons and the four period emblems (same list as the server).
export const BUILTIN = [
  ['home', 'Үй'], ['periods', 'Ғимарат'], ['tests', 'Тест'], ['materials', 'Кітап'], ['results', 'Диаграмма'], ['profile', 'Адам'],
  ['book', 'Дәптер'], ['clock', 'Сағат'], ['search', 'Іздеу'], ['check', 'Белгі'], ['arrow', 'Көрсеткі'], ['logout', 'Шығу'],
  ['emblem-1', 'Қорған мен күн'], ['emblem-2', 'Кесене'], ['emblem-3', 'Қолжазба'], ['emblem-4', 'Бәйтерек'],
];

const preview = (value, fallback) => renderIcon(value, fallback, 'icon o-icon-preview');

/** Opens the icon library: built-in icons plus uploaded icon files. Resolves with a value or null. */
export function chooseIcon(ctx, current) {
  const files = () => ctx.state.files.filter((f) => f.kind === 'icon' || f.kind === 'image');
  const body = () => `
    <h3 class="o-sub">Дайын белгішелер</h3>
    <div class="o-icon-grid">${BUILTIN.map(
      ([name, label]) => `<button type="button" class="o-icon-choice${current?.kind === 'builtin' && current.name === name ? ' is-on' : ''}" data-name="${name}">${renderIcon({ kind: 'builtin', name }, null, 'icon')}<span>${esc(label)}</span></button>`,
    ).join('')}</div>
    <h3 class="o-sub">Жүктелген белгішелер <button type="button" class="btn btn-sm" data-up>Жаңа белгіше жүктеу</button></h3>
    <div class="o-icon-grid" data-files>${
      files().length
        ? files()
            .map((f) => `<button type="button" class="o-icon-choice${current?.kind === 'file' && current.id === f.id ? ' is-on' : ''}" data-id="${f.id}"><img src="${fileSrc(f)}" alt="" /><span>${esc(f.name)}</span></button>`)
            .join('')
        : '<p class="o-muted">Әзірге жүктелген белгіше жоқ. PNG, WEBP немесе SVG (300 КБ дейін).</p>'
    }</div>`;
  return dialog({
    title: 'Белгіше таңдау',
    wide: true,
    body: body(),
    onOpen(box, close) {
      box.addEventListener('click', async (e) => {
        const b = e.target.closest('.o-icon-choice');
        if (b?.dataset.name) return close({ kind: 'builtin', name: b.dataset.name, size: current?.size || 22 });
        if (b?.dataset.id) return close({ kind: 'file', id: Number(b.dataset.id), size: current?.size || 22 });
        if (e.target.closest('[data-up]')) {
          const [created] = await uploadFiles('icon', await pickFiles('icon'), ctx);
          if (created) close({ kind: 'file', id: created.id, size: current?.size || 22 });
        }
      });
    },
  });
}

/** An icon field for forms (used by topics): hidden JSON value, preview, library, size, remove. */
export function iconField({ name, label, value, emblems = false }) {
  return `
  <div class="o-field o-icon-field" data-icon-field="${esc(name)}" ${emblems ? 'data-emblems' : ''}>
    <span class="o-label">${esc(label)}</span>
    <input type="hidden" name="${esc(name)}" value="${esc(JSON.stringify(value || null))}" />
    <div class="o-file-box">
      <div class="o-icon-current"></div>
      <div class="o-file-actions">
        <button type="button" class="btn btn-dark btn-sm" data-act="choose">Таңдау</button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="clear">Алып тастау</button>
      </div>
    </div>
  </div>`;
}

export function bindIconFields(root, ctx) {
  root.querySelectorAll('[data-icon-field]').forEach((field) => {
    const hidden = field.querySelector('input');
    const get = () => JSON.parse(hidden.value || 'null');
    const set = (v) => {
      hidden.value = JSON.stringify(v);
      paint();
      field.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const paint = () => {
      const v = get();
      field.querySelector('.o-icon-current').innerHTML = v
        ? `${preview(v)}<label class="o-size">Өлшемі <input type="range" min="14" max="64" value="${v.size || 22}" data-size /> <b>${v.size || 22}px</b></label>`
        : `<span class="o-file-empty">${'emblems' in field.dataset ? 'Әдепкі эмблема қолданылады' : 'Белгіше жоқ'}</span>`;
      field.querySelector('[data-act="clear"]').hidden = !v;
    };
    paint();
    field.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'choose') {
        const v = 'emblems' in field.dataset ? await chooseEmblem(ctx, get()) : await chooseIcon(ctx, get());
        if (v) set(v);
      } else if (act === 'clear') set(null);
    });
    field.addEventListener('input', (e) => {
      if (!e.target.matches('[data-size]')) return;
      const v = get();
      v.size = Number(e.target.value);
      hidden.value = JSON.stringify(v);
      field.querySelector('.o-icon-preview')?.replaceWith(document.createRange().createContextualFragment(preview(v)));
      field.querySelector('.o-size b').textContent = `${v.size}px`;
    });
  });
}

// ─── Section: site icons and the icon file library ───────────────
export function iconsView(el, _params, ctx) {
  const icons = structuredClone(ctx.state.icons);
  let dirty = false;
  ctx.setDirtyCheck(() => dirty);

  const draw = () => {
    const files = ctx.state.files.filter((f) => f.kind === 'icon');
    el.innerHTML = `
      <div class="o-card">
        <div class="o-card-head">
          <div><h2>Сайт белгішелері</h2><p class="o-muted">Мәзір белгішесі мен кезең эмблемасын ауыстырыңыз. Өзгеріс бүкіл сайтқа қолданылады (жариялағаннан кейін).</p></div>
          <button type="button" class="btn" id="save-icons">Сақтау</button>
        </div>
        <ul class="o-slots">
          ${ICON_SLOTS.map(([slot, label, fallback]) => {
            const v = icons[slot];
            const isNav = slot.startsWith('nav.');
            return `<li class="o-slot${v ? ' is-custom' : ''}" data-slot="${slot}">
              <span class="o-slot-icon ${isNav ? 'is-nav' : 'is-emblem'}">${renderIcon(v, fallback, isNav ? 'icon' : 'emblem')}</span>
              <div class="o-slot-body"><b>${esc(label)}</b><small>${v ? (v.kind === 'file' ? 'Жүктелген файл' : 'Кітапханадан') : 'Әдепкі белгіше'}</small>
                ${v && isNav ? `<label class="o-size">Өлшемі <input type="range" min="14" max="64" value="${v.size || 22}" data-size /> <b>${v.size || 22}px</b></label>` : ''}
              </div>
              <div class="o-row-actions">
                <button type="button" class="btn btn-dark btn-sm" data-act="choose">Ауыстыру</button>
                ${v ? '<button type="button" class="btn btn-ghost btn-sm" data-act="reset">Әдепкіге қайтару</button>' : ''}
              </div>
            </li>`;
          }).join('')}
        </ul>
      </div>
      <div class="o-card">
        <div class="o-card-head">
          <div><h2>Белгіше файлдары</h2><p class="o-muted">PNG, WEBP немесе SVG, 300 КБ дейін. Тақырып белгішесін тақырыпты өңдеу бетінде таңдайсыз.</p></div>
          <button type="button" class="btn btn-dark" id="upload-icons">Белгіше жүктеу</button>
        </div>
        <div class="o-icon-grid">${
          files.length
            ? files
                .map(
                  (f) => `<div class="o-icon-file" data-id="${f.id}"><img src="${fileSrc(f)}" alt="" /><span>${esc(f.name)}</span><small>${formatBytes(f.size)}${f.used_by.length ? ` · ${f.used_by.length} жерде` : ''}</small>
                    <div class="o-row-actions"><button type="button" class="o-icon-btn" data-act="replace" title="Ауыстыру" aria-label="Ауыстыру">${icon('arrow')}</button>
                    <button type="button" class="o-icon-btn o-danger" data-act="delete" title="Жою" aria-label="Жою">${icon('cross')}</button></div></div>`,
                )
                .join('')
            : '<p class="o-muted">Жүктелген белгіше жоқ.</p>'
        }</div>
      </div>`;
  };

  const markDirty = () => {
    dirty = true;
    el.querySelector('#save-icons')?.classList.add('o-pulse');
  };

  el.addEventListener('click', async (e) => {
    const slotEl = e.target.closest('[data-slot]');
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (slotEl && act === 'choose') {
      const v = await chooseIcon(ctx, icons[slotEl.dataset.slot]);
      if (v) {
        icons[slotEl.dataset.slot] = v;
        draw();
        markDirty();
      }
    } else if (slotEl && act === 'reset') {
      delete icons[slotEl.dataset.slot];
      draw();
      markDirty();
    } else if (e.target.closest('#save-icons')) {
      await busy(e.target.closest('#save-icons'), async () => {
        await org.put('/icons', { icons });
        dirty = false;
        toast('Белгішелер сақталды. Сайтта көрінуі үшін жариялаңыз.');
        await ctx.reload();
        draw();
      });
    } else if (e.target.closest('#upload-icons')) {
      if ((await uploadFiles('icon', await pickFiles('icon', { multiple: true }), ctx)).length) {
        await ctx.reload();
        draw();
        if (dirty) markDirty();
      }
    } else {
      const fileEl = e.target.closest('.o-icon-file');
      if (!fileEl) return;
      const id = Number(fileEl.dataset.id);
      if (act === 'replace') {
        const [file] = await pickFiles('icon');
        if (!file) return;
        try {
          await org.upload(`/files/${id}/content`, file);
          toast('Белгіше ауыстырылды.');
          await ctx.reload();
          draw();
        } catch (err) {
          toast(err.message, 'error');
        }
      } else if (act === 'delete') {
        await deleteFile(ctx, id);
        draw();
      }
    }
  });
  el.addEventListener('input', (e) => {
    if (!e.target.matches('[data-size]')) return;
    const slot = e.target.closest('[data-slot]').dataset.slot;
    icons[slot] = { ...icons[slot], size: Number(e.target.value) };
    e.target.nextElementSibling.textContent = `${e.target.value}px`;
    const holder = e.target.closest('[data-slot]').querySelector('.o-slot-icon');
    holder.innerHTML = renderIcon(icons[slot], null, 'icon');
    markDirty();
  });
  draw();
}

/** Deletes a file; if it is in use, lists where and asks before detaching it. */
export async function deleteFile(ctx, id) {
  const f = ctx.state.files.find((x) => x.id === id);
  if (!f) return false;
  const used = f.used_by.length
    ? `<p>Бұл файл қолданылып тұр:</p><ul class="o-list">${f.used_by.map((u) => `<li>${esc(u)}</li>`).join('')}</ul><p>Жойсаңыз, осы жерлерден алынып тасталады.</p>`
    : '<p>Файл біржола жойылады. Бұл әрекетті қайтару мүмкін емес.</p>';
  const ok = await dialog({
    title: `«${f.name}» файлын жою`,
    body: used,
    buttons: [
      { label: 'Болдырмау', value: false, kind: 'ghost' },
      { label: 'Жою', value: true, kind: 'danger' },
    ],
  });
  if (!ok) return false;
  try {
    await org.del(`/files/${id}${f.used_by.length ? '?force=1' : ''}`);
    toast('Файл жойылды.');
    await ctx.reload();
    return true;
  } catch (err) {
    if (err.status === 409 && (await confirmDialog('Файл қолданылып тұр', `Файл ${err.data.used_by.length} жерде қолданылады. Сонда да жоясыз ба?`, { ok: 'Жою', danger: true }))) {
      await org.del(`/files/${id}?force=1`);
      await ctx.reload();
      return true;
    }
    if (err.status !== 409) toast(err.message, 'error');
    return false;
  }
}
