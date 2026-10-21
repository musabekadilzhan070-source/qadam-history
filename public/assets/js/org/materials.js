import { org } from './api.js';
import {
  esc, icon, toast, confirmDialog, statusBadge, input, textarea, select, toggle, fileField, bindFileFields,
  formValues, trackDirty, busy, moved, topicOptions, topicTitle,
} from './ui.js';

const payload = (m, patch = {}) => ({
  topic_id: m.topic_id, title: m.title, body: m.body, image_id: m.image_id, pdf_id: m.pdf_id, published: Boolean(m.published), ...patch,
});

export function materialsView(el, _params, ctx) {
  const draw = () => {
    const s = ctx.state;
    const list = [...s.materials].sort((a, b) => a.position - b.position || a.id - b.id);
    el.innerHTML = `
      <section class="o-card">
        <div class="o-card-head">
          <div><h2>Қосымша материалдар</h2><p class="o-muted">Мәтін, сурет немесе PDF. Тақырыпқа байланыстырсаңыз, тақырып бетінде көрінеді.</p></div>
          <a class="btn btn-sm" href="/organizer/materials/new" data-link>+ Жаңа материал</a>
        </div>
        ${
          list.length
            ? `<ol class="o-rows">${list
                .map(
                  (m, i) => `<li class="o-row" data-id="${m.id}">
                    <div class="o-order">
                      <button type="button" class="o-icon-btn" data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="Жоғары">▲</button>
                      <button type="button" class="o-icon-btn" data-act="down" ${i === list.length - 1 ? 'disabled' : ''} aria-label="Төмен">▼</button>
                    </div>
                    <span class="o-row-icon">${icon(m.pdf_id ? 'book' : 'materials')}</span>
                    <div class="o-row-body"><a href="/organizer/materials/${m.id}" data-link><b>${esc(m.title)}</b></a>
                      <small>${esc(topicTitle(s, m.topic_id) || 'Тақырыпсыз (жалпы материал)')}${m.pdf_id ? ' · PDF' : ''}${m.image_id ? ' · сурет' : ''}</small></div>
                    ${statusBadge(m.published)}
                    <div class="o-row-actions">
                      <a class="btn btn-ghost btn-sm" href="/organizer/materials/${m.id}" data-link>Өңдеу</a>
                      <button type="button" class="btn btn-ghost btn-sm" data-act="toggle">${m.published ? 'Жасыру' : 'Жариялау'}</button>
                      <button type="button" class="o-icon-btn o-danger" data-act="delete" aria-label="Жою" title="Жою">${icon('cross')}</button>
                    </div>
                  </li>`,
                )
                .join('')}</ol>`
            : '<p class="o-muted">Әзірге қосымша материал жоқ. Тақырыптың негізгі мәтіні «Тақырыптар» бөлімінде өңделеді.</p>'
        }
      </section>`;
  };
  el.addEventListener('click', async (e) => {
    const row = e.target.closest('.o-row');
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!row || !act) return;
    const list = [...ctx.state.materials].sort((a, b) => a.position - b.position || a.id - b.id);
    const m = list.find((x) => x.id === Number(row.dataset.id));
    try {
      if (act === 'up' || act === 'down') {
        await org.post('/materials/reorder', { ids: moved(list, list.indexOf(m), act === 'up' ? -1 : 1).map((x) => x.id) });
      } else if (act === 'toggle') {
        await org.put(`/materials/${m.id}`, payload(m, { published: !m.published }));
        toast(m.published ? 'Материал жасырылды.' : 'Материал жарияланатын болып белгіленді.');
      } else if (act === 'delete') {
        if (!(await confirmDialog('Материалды жою', `«${m.title}» материалы жойылады. Тіркелген файлдар «Суреттер» кітапханасында қалады.`, { ok: 'Жою', danger: true }))) return;
        await org.del(`/materials/${m.id}`);
        toast('Материал жойылды.');
      }
      await ctx.reload();
      draw();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  draw();
}

export function materialEditView(el, [id], ctx) {
  const s = ctx.state;
  const isNew = id === 'new';
  const m = isNew ? { topic_id: null, title: '', body: '', image_id: null, pdf_id: null, published: 0 } : s.materials.find((x) => x.id === Number(id));
  if (!m) {
    el.innerHTML = '<div class="o-card"><p>Материал табылмады.</p><a class="btn btn-sm" href="/organizer/materials" data-link>Материалдарға оралу</a></div>';
    return;
  }
  document.getElementById('o-title').textContent = isNew ? 'Жаңа материал' : m.title;
  el.innerHTML = `
    <form class="o-card o-form" id="mat-form" novalidate>
      <div class="o-card-head">
        <a class="o-back" href="/organizer/materials" data-link>← Материалдар</a>
        <div class="o-row-actions">
          ${!isNew ? '<button type="button" class="btn btn-ghost btn-sm o-danger" id="del">Жою</button>' : ''}
          <button type="submit" class="btn">Сақтау</button>
        </div>
      </div>
      <div class="o-grid-2">
        ${input({ name: 'title', label: 'Атауы', value: m.title, required: true, max: 160 })}
        ${select({ name: 'topic_id', label: 'Тақырып', value: m.topic_id, options: topicOptions(s, { empty: '— Тақырыпсыз (жалпы материал) —' }) })}
      </div>
      ${textarea({ name: 'body', label: 'Мәтіні', value: m.body, rows: 12, hint: '«## » — бөлім атауы, «- » — тізім. Мәтін немесе PDF файлдың кемінде біреуі қажет.' })}
      <div class="o-grid-2">
        ${fileField({ name: 'image_id', kind: 'image', value: m.image_id, label: 'Сурет', hint: 'JPG, PNG немесе WEBP, 3 МБ дейін.' })}
        ${fileField({ name: 'pdf_id', kind: 'pdf', value: m.pdf_id, label: 'PDF файл', hint: 'PDF, 4 МБ дейін. «Жүктеу» батырмасымен ауыстыруға болады.' })}
      </div>
      ${toggle({ name: 'published', label: 'Оқушыларға көрсету (жариялағаннан кейін)', checked: m.published })}
    </form>`;
  const form = el.querySelector('#mat-form');
  bindFileFields(form, ctx);
  const dirty = trackDirty(form, ctx);
  form.querySelector('#del')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Материалды жою', `«${m.title}» материалы жойылады.`, { ok: 'Жою', danger: true }))) return;
    try {
      await org.del(`/materials/${m.id}`);
      dirty.clear();
      toast('Материал жойылды.');
      ctx.navigate('/organizer/materials', { force: true });
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = formValues(form);
    if (!v.title.trim()) return toast('Материал атауын жазыңыз.', 'error');
    if (!v.body.trim() && !v.pdf_id) return toast('Материалға мәтін жазыңыз немесе PDF файл тіркеңіз.', 'error');
    const body = { ...v, topic_id: v.topic_id ? Number(v.topic_id) : null, image_id: v.image_id ? Number(v.image_id) : null, pdf_id: v.pdf_id ? Number(v.pdf_id) : null };
    busy(form.querySelector('[type="submit"]'), async () => {
      const r = isNew ? await org.post('/materials', body) : await org.put(`/materials/${m.id}`, body);
      dirty.clear();
      toast('Материал сақталды. Оқушылар оны жариялағаннан кейін көреді.');
      if (isNew) ctx.navigate(`/organizer/materials/${r.id}`, { replace: true, force: true });
      else await ctx.refreshStatus();
    });
  });
}
