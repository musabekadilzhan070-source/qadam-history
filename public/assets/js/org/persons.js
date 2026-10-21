import { org } from './api.js';
import {
  esc, icon, toast, confirmDialog, statusBadge, input, textarea, select, toggle, fileField, bindFileFields,
  formValues, trackDirty, busy, moved, topicOptions, topicTitle, fileSrc,
} from './ui.js';

const payload = (p, patch = {}) => ({
  topic_id: p.topic_id, name: p.name, role: p.role, reign: p.reign, biography: p.biography, facts: p.facts,
  image_id: p.image_id, published: Boolean(p.published), ...patch,
});

export function personsView(el, _params, ctx) {
  const draw = () => {
    const s = ctx.state;
    const list = s.persons;
    el.innerHTML = `
      <section class="o-card">
        <div class="o-card-head">
          <div><h2>Хандар мен тарихи тұлғалар</h2><p class="o-muted">Тұлға карточкасы байланыстырылған тақырып бетінде көрсетіледі.</p></div>
          <a class="btn btn-sm" href="/organizer/persons/new" data-link>+ Жаңа тұлға</a>
        </div>
        ${
          list.length
            ? `<ol class="o-rows">${list
                .map((p, i) => {
                  const img = p.image_id && s.files.find((f) => f.id === p.image_id);
                  return `<li class="o-row" data-id="${p.id}">
                    <div class="o-order">
                      <button type="button" class="o-icon-btn" data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="Жоғары">▲</button>
                      <button type="button" class="o-icon-btn" data-act="down" ${i === list.length - 1 ? 'disabled' : ''} aria-label="Төмен">▼</button>
                    </div>
                    <span class="o-row-icon o-row-photo">${img ? `<img src="${fileSrc(img)}" alt="" />` : icon('profile')}</span>
                    <div class="o-row-body"><a href="/organizer/persons/${p.id}" data-link><b>${esc(p.name)}</b></a>
                      <small>${esc([p.reign, topicTitle(s, p.topic_id) || 'Тақырыпқа байланыспаған'].filter(Boolean).join(' · '))}</small></div>
                    ${statusBadge(p.published)}
                    <div class="o-row-actions">
                      <a class="btn btn-ghost btn-sm" href="/organizer/persons/${p.id}" data-link>Өңдеу</a>
                      <button type="button" class="btn btn-ghost btn-sm" data-act="toggle">${p.published ? 'Жасыру' : 'Жариялау'}</button>
                      <button type="button" class="o-icon-btn o-danger" data-act="delete" aria-label="Жою" title="Жою">${icon('cross')}</button>
                    </div>
                  </li>`;
                })
                .join('')}</ol>`
            : '<p class="o-muted">Әзірге тұлға қосылмаған.</p>'
        }
      </section>`;
  };
  el.addEventListener('click', async (e) => {
    const row = e.target.closest('.o-row');
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!row || !act) return;
    const list = ctx.state.persons;
    const p = list.find((x) => x.id === Number(row.dataset.id));
    try {
      if (act === 'up' || act === 'down') {
        await org.post('/persons/reorder', { ids: moved(list, list.indexOf(p), act === 'up' ? -1 : 1).map((x) => x.id) });
      } else if (act === 'toggle') {
        await org.put(`/persons/${p.id}`, payload(p, { published: !p.published }));
        toast(p.published ? 'Тұлға жасырылды.' : 'Тұлға жарияланатын болып белгіленді.');
      } else if (act === 'delete') {
        if (!(await confirmDialog('Тұлғаны жою', `«${p.name}» карточкасы жойылады.`, { ok: 'Жою', danger: true }))) return;
        await org.del(`/persons/${p.id}`);
        toast('Тұлға жойылды.');
      }
      await ctx.reload();
      draw();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  draw();
}

const factRow = (f = '') => `<li class="o-kp o-kp-1"><input data-fact value="${esc(f)}" maxlength="400" placeholder="Тарихи дерек" />
  <button type="button" class="o-icon-btn o-danger" data-fact-del aria-label="Жою">${icon('cross')}</button></li>`;

export function personEditView(el, [id], ctx) {
  const s = ctx.state;
  const isNew = id === 'new';
  const p = isNew
    ? { topic_id: null, name: '', role: '', reign: '', biography: '', facts: [], image_id: null, published: 0 }
    : s.persons.find((x) => x.id === Number(id));
  if (!p) {
    el.innerHTML = '<div class="o-card"><p>Тұлға табылмады.</p><a class="btn btn-sm" href="/organizer/persons" data-link>Тізімге оралу</a></div>';
    return;
  }
  document.getElementById('o-title').textContent = isNew ? 'Жаңа тұлға' : p.name;
  el.innerHTML = `
    <form class="o-card o-form" id="person-form" novalidate>
      <div class="o-card-head">
        <a class="o-back" href="/organizer/persons" data-link>← Хандар мен тұлғалар</a>
        <div class="o-row-actions">
          ${!isNew ? '<button type="button" class="btn btn-ghost btn-sm o-danger" id="del">Жою</button>' : ''}
          <button type="submit" class="btn">Сақтау</button>
        </div>
      </div>
      <div class="o-grid-2">
        ${input({ name: 'name', label: 'Аты-жөні', value: p.name, required: true, max: 120 })}
        ${input({ name: 'role', label: 'Лауазымы (мысалы: Қазақ хандығының ханы)', value: p.role, max: 120 })}
        ${input({ name: 'reign', label: 'Билік жылдары', value: p.reign, max: 80 })}
        ${select({ name: 'topic_id', label: 'Тақырып', value: p.topic_id, options: topicOptions(s, { empty: '— Тақырыпқа байланыстырмау —' }) })}
      </div>
      ${textarea({ name: 'biography', label: 'Өмірбаяны', value: p.biography, rows: 8, max: 20000 })}
      <div class="o-field"><span class="o-label">Маңызды тарихи деректер</span>
        <ul class="o-kps" id="facts">${p.facts.map(factRow).join('')}</ul>
        <button type="button" class="btn btn-ghost btn-sm" id="fact-add">+ Дерек қосу</button>
      </div>
      ${fileField({ name: 'image_id', kind: 'image', value: p.image_id, label: 'Суреті', hint: 'JPG, PNG немесе WEBP, 3 МБ дейін.' })}
      ${toggle({ name: 'published', label: 'Оқушыларға көрсету (жариялағаннан кейін)', checked: p.published })}
    </form>`;
  const form = el.querySelector('#person-form');
  bindFileFields(form, ctx);
  const dirty = trackDirty(form, ctx);
  form.querySelector('#fact-add').addEventListener('click', () => {
    form.querySelector('#facts').insertAdjacentHTML('beforeend', factRow());
    form.querySelector('#facts li:last-child input').focus();
    dirty.mark();
  });
  form.querySelector('#facts').addEventListener('click', (e) => {
    if (e.target.closest('[data-fact-del]')) {
      e.target.closest('li').remove();
      dirty.mark();
    }
  });
  form.querySelector('#del')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Тұлғаны жою', `«${p.name}» карточкасы жойылады.`, { ok: 'Жою', danger: true }))) return;
    try {
      await org.del(`/persons/${p.id}`);
      dirty.clear();
      ctx.navigate('/organizer/persons', { force: true });
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = formValues(form);
    if (!v.name.trim()) return toast('Тұлғаның атын жазыңыз.', 'error');
    const body = {
      ...v,
      topic_id: v.topic_id ? Number(v.topic_id) : null,
      image_id: v.image_id ? Number(v.image_id) : null,
      facts: [...form.querySelectorAll('[data-fact]')].map((i) => i.value),
    };
    busy(form.querySelector('[type="submit"]'), async () => {
      const r = isNew ? await org.post('/persons', body) : await org.put(`/persons/${p.id}`, body);
      dirty.clear();
      toast('Тұлға сақталды. Оқушылар оны жариялағаннан кейін көреді.');
      if (isNew) ctx.navigate(`/organizer/persons/${r.id}`, { replace: true, force: true });
      else await ctx.refreshStatus();
    });
  });
}
