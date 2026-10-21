import { esc } from '../util.js';
import { icon } from '../art.js';
import { org } from './api.js';

export { esc, icon };

export const fileSrc = (f) => `/api/files/${f.id}?v=${f.version}`;

export function formatBytes(n) {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} КБ`;
  return `${(n / 1024 / 1024).toFixed(1)} МБ`;
}

export const statusBadge = (published) =>
  published ? '<span class="o-badge o-badge-on">Жарияланған</span>' : '<span class="o-badge o-badge-off">Жасырын</span>';

// ─── Toasts ───────────────────────────────────────────────────────
export function toast(message, kind = 'ok') {
  let box = document.getElementById('o-toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'o-toasts';
    box.className = 'o-toasts';
    box.setAttribute('role', 'status');
    document.body.append(box);
  }
  const t = document.createElement('div');
  t.className = `o-toast o-toast-${kind}`;
  t.textContent = message;
  box.append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 7000 : 3500);
}

// ─── Dialogs ──────────────────────────────────────────────────────
/**
 * A modal with a title, body and buttons. Resolves with the chosen button's value,
 * or null when closed. `buttons`: [{ label, value, kind: 'primary'|'danger'|'ghost' }].
 */
export function dialog({ title, body = '', buttons = [], wide = false, onOpen }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'o-modal-wrap';
    wrap.innerHTML = `
      <div class="o-modal${wide ? ' o-modal-wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="o-modal-title">
        <header><h2 id="o-modal-title">${esc(title)}</h2><button type="button" class="o-icon-btn" data-close aria-label="Жабу">${icon('cross')}</button></header>
        <div class="o-modal-body">${body}</div>
        ${buttons.length ? `<footer>${buttons.map((b, i) => `<button type="button" class="btn btn-sm ${b.kind === 'danger' ? 'o-btn-danger' : b.kind === 'ghost' ? 'btn-ghost' : b.kind === 'dark' ? 'btn-dark' : ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</footer>` : ''}
      </div>`;
    const last = document.activeElement;
    const close = (value) => {
      wrap.remove();
      document.removeEventListener('keydown', onKey);
      last?.focus?.();
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(null);
    };
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap || e.target.closest('[data-close]')) return close(null);
      const b = e.target.closest('footer [data-i]');
      if (b) close(buttons[Number(b.dataset.i)].value);
    });
    document.addEventListener('keydown', onKey);
    document.body.append(wrap);
    (wrap.querySelector('footer .btn') || wrap.querySelector('[data-close]')).focus();
    onOpen?.(wrap.querySelector('.o-modal'), close);
  });
}

export const confirmDialog = (title, text, { ok = 'Иә', danger = false } = {}) =>
  dialog({
    title,
    body: `<p>${esc(text)}</p>`,
    buttons: [
      { label: 'Болдырмау', value: false, kind: 'ghost' },
      { label: ok, value: true, kind: danger ? 'danger' : 'primary' },
    ],
  }).then(Boolean);

// ─── Upload checks (the server checks again by the file's real bytes) ─────
const ACCEPT = {
  image: '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp',
  pdf: '.pdf,application/pdf',
  icon: '.png,.webp,.svg,image/png,image/webp,image/svg+xml',
};
const EXT = { image: /\.(jpe?g|png|webp)$/i, pdf: /\.pdf$/i, icon: /\.(png|webp|svg)$/i };
const TYPE_TEXT = { image: 'JPG, PNG немесе WEBP', pdf: 'PDF', icon: 'PNG, WEBP немесе SVG' };

export function checkLocalFile(kind, file, limits) {
  if (!EXT[kind].test(file.name)) return `«${file.name}»: бұл форматқа рұқсат жоқ. ${TYPE_TEXT[kind]} файлын таңдаңыз.`;
  const lim = limits?.[kind];
  if (lim && file.size > lim.max) return `«${file.name}»: файл көлемі ${lim.limit} аспауы керек (қазір ${formatBytes(file.size)}).`;
  return null;
}

/** Opens the system file dialog; resolves with the chosen files (possibly empty). */
export function pickFiles(kind, { multiple = false } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ACCEPT[kind];
    input.multiple = multiple;
    input.addEventListener('change', () => resolve([...input.files]));
    input.click();
  });
}

/** Uploads files of a kind, reporting errors per file. Returns the created file rows. */
export async function uploadFiles(kind, files, ctx, extraQuery = '') {
  const created = [];
  for (const file of files) {
    const problem = checkLocalFile(kind, file, ctx.state.limits);
    if (problem) {
      toast(problem, 'error');
      continue;
    }
    try {
      const row = await org.upload(`/files?kind=${kind}${extraQuery}`, file);
      ctx.state.files.unshift({ ...row, used_by: [] });
      created.push(row);
    } catch (err) {
      toast(`«${file.name}»: ${err.message}`, 'error');
    }
  }
  if (created.length) toast(created.length > 1 ? `${created.length} файл жүктелді.` : 'Файл жүктелді.');
  return created;
}

// ─── File fields: preview + choose from library / upload / remove ─────────
const preview = (f) => {
  if (!f) return '<span class="o-file-empty">Таңдалмаған</span>';
  if (f.kind === 'pdf') return `<a class="o-file-pdf" href="${fileSrc(f)}" target="_blank" rel="noopener">${icon('book')}<span>${esc(f.name)}</span></a>`;
  return `<img src="${fileSrc(f)}" alt="" /><span class="o-file-name">${esc(f.name)}</span>`;
};

export function fileField({ name, kind, value, label, hint = '', compact = false }) {
  if (compact) {
    return `
  <div class="o-file-field o-file-compact" data-file-field="${esc(name)}" data-kind="${kind}">
    <input type="hidden" name="${esc(name)}" value="${value ?? ''}" />
    <div class="o-file-preview"></div>
    <button type="button" class="o-icon-btn" data-act="library" title="${esc(label)}" aria-label="${esc(label)}">${icon('book')}</button>
    <button type="button" class="o-icon-btn" data-act="clear" title="Суретті алып тастау" aria-label="Суретті алып тастау">${icon('cross')}</button>
  </div>`;
  }
  return `
  <div class="o-field o-file-field" data-file-field="${esc(name)}" data-kind="${kind}">
    <span class="o-label">${esc(label)}</span>
    <input type="hidden" name="${esc(name)}" value="${value ?? ''}" />
    <div class="o-file-box"><div class="o-file-preview"></div>
      <div class="o-file-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-act="library">Кітапханадан</button>
        <button type="button" class="btn btn-dark btn-sm" data-act="upload">Жүктеу</button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="clear">Алып тастау</button>
      </div>
    </div>
    ${hint ? `<small class="o-hint">${esc(hint)}</small>` : ''}
  </div>`;
}

/** Opens the library of uploaded files of a kind; resolves with a file id or null. */
export function chooseFromLibrary(kind, ctx) {
  const items = () => ctx.state.files.filter((f) => f.kind === kind || (kind === 'icon' && f.kind === 'image'));
  const grid = () =>
    items().length
      ? items()
          .map((f) => `<button type="button" class="o-lib-item" data-id="${f.id}">${preview(f)}</button>`)
          .join('')
      : '<p class="o-muted">Кітапхана бос. Алдымен файл жүктеңіз.</p>';
  return dialog({
    title: kind === 'pdf' ? 'PDF файлды таңдау' : kind === 'icon' ? 'Белгішені таңдау' : 'Суретті таңдау',
    wide: true,
    body: `<div class="o-lib-tools"><button type="button" class="btn btn-sm" data-up>Жаңа файл жүктеу</button></div><div class="o-lib">${grid()}</div>`,
    onOpen(box, close) {
      box.addEventListener('click', async (e) => {
        const item = e.target.closest('.o-lib-item');
        if (item) {
          e.preventDefault();
          return close(Number(item.dataset.id));
        }
        if (e.target.closest('[data-up]')) {
          const created = await uploadFiles(kind, await pickFiles(kind), ctx);
          if (created.length) close(created[0].id);
        }
      });
    },
  });
}

export function bindFileFields(root, ctx) {
  const paint = (field) => {
    const id = Number(field.querySelector('input').value) || null;
    const f = id ? ctx.state.files.find((x) => x.id === id) : null;
    field.querySelector('.o-file-preview').innerHTML = field.classList.contains('o-file-compact') ? (f ? `<img src="${fileSrc(f)}" alt="" />` : '') : preview(f);
    field.querySelector('[data-act="clear"]').hidden = !id;
  };
  const set = (field, id) => {
    field.querySelector('input').value = id ?? '';
    paint(field);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  };
  root.querySelectorAll('[data-file-field]').forEach((field) => {
    paint(field);
    const kind = field.dataset.kind;
    field.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'library') {
        const id = await chooseFromLibrary(kind, ctx);
        if (id) set(field, id);
      } else if (act === 'upload') {
        const [created] = await uploadFiles(kind, await pickFiles(kind), ctx);
        if (created) set(field, created.id);
      } else if (act === 'clear') set(field, null);
    });
  });
}

// ─── Forms ────────────────────────────────────────────────────────
export const input = ({ name, label, value = '', required = false, max = 200, hint = '', type = 'text' }) => `
  <label class="o-field"><span class="o-label">${esc(label)}${required ? ' <i>*</i>' : ''}</span>
    <input type="${type}" name="${esc(name)}" value="${esc(value)}" maxlength="${max}" ${required ? 'required' : ''} />
    ${hint ? `<small class="o-hint">${esc(hint)}</small>` : ''}</label>`;

export const textarea = ({ name, label, value = '', rows = 4, max = 60000, hint = '', required = false }) => `
  <label class="o-field"><span class="o-label">${esc(label)}${required ? ' <i>*</i>' : ''}</span>
    <textarea name="${esc(name)}" rows="${rows}" maxlength="${max}" ${required ? 'required' : ''}>${esc(value)}</textarea>
    ${hint ? `<small class="o-hint">${esc(hint)}</small>` : ''}</label>`;

export const select = ({ name, label, value, options, required = false }) => `
  <label class="o-field"><span class="o-label">${esc(label)}${required ? ' <i>*</i>' : ''}</span>
    <select name="${esc(name)}" ${required ? 'required' : ''}>
      ${options.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(value ?? '') ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
    </select></label>`;

export const toggle = ({ name, label, checked }) => `
  <label class="o-toggle"><input type="checkbox" name="${esc(name)}" ${checked ? 'checked' : ''} /><span></span>${esc(label)}</label>`;

/** Topic options grouped by period, for select fields. */
export function topicOptions(state, { empty = null } = {}) {
  const out = empty ? [{ value: '', label: empty }] : [];
  for (const p of state.periods) {
    for (const t of state.topics.filter((x) => x.period_id === p.id)) out.push({ value: t.id, label: `${p.title} · ${t.title}` });
  }
  return out;
}

export const topicTitle = (state, id) => state.topics.find((t) => t.id === id)?.title || null;

export function formValues(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else out[el.name] = el.value;
  }
  return out;
}

/** Marks a form dirty on any edit and offers a guard for leaving the page. */
export function trackDirty(form, ctx) {
  let dirty = false;
  const mark = () => {
    dirty = true;
    form.classList.add('is-dirty');
  };
  form.addEventListener('input', mark);
  form.addEventListener('change', mark);
  ctx.setDirtyCheck(() => dirty);
  return {
    mark,
    clear() {
      dirty = false;
      form.classList.remove('is-dirty');
    },
  };
}

/** Runs an async save with the button disabled; shows errors as a toast. */
export async function busy(button, fn) {
  if (button.disabled) return;
  const text = button.innerHTML;
  button.disabled = true;
  button.textContent = 'Сақталуда…';
  try {
    return await fn();
  } catch (err) {
    toast(err.message, 'error');
    return undefined;
  } finally {
    button.disabled = false;
    button.innerHTML = text;
  }
}

/** Moves item at index i by delta in a copy of the list. */
export function moved(list, i, delta) {
  const j = i + delta;
  if (j < 0 || j >= list.length) return list;
  const copy = [...list];
  [copy[i], copy[j]] = [copy[j], copy[i]];
  return copy;
}
