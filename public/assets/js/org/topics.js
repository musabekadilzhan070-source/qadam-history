import { org } from './api.js';
import { renderIcon } from '../site.js';
import {
  esc, icon, toast, dialog, statusBadge, input, textarea, select, toggle, fileField, bindFileFields,
  formValues, trackDirty, busy, moved,
} from './ui.js';
import { iconField, bindIconFields } from './icons.js';

const related = (s, id) => ({
  tests: s.tests.filter((x) => x.topic_id === id),
  materials: s.materials.filter((m) => m.topic_id === id),
  persons: s.persons.filter((p) => p.topic_id === id),
});

/** Asks how to delete a topic: keep its tests and materials, or delete them too. */
export async function deleteTopic(ctx, topic) {
  const r = related(ctx.state, topic.id);
  const total = r.tests.length + r.materials.length + r.persons.length;
  const body = total
    ? `<p>Бұл тақырыпқа байланысты: <b>${r.tests.length}</b> тест, <b>${r.materials.length}</b> материал, <b>${r.persons.length}</b> тұлға.</p>
       <p>Оларды сақтап қалуға (тақырыпсыз, жасырын күйде қалады, кейін басқа тақырыпқа байланыстыруға болады) немесе тақырыппен бірге жоюға болады.</p>
       <p class="o-muted">Оқушылардың бұрынғы нәтижелері «Менің нәтижелерім» бетінде сақталады.</p>`
    : '<p>Тақырып біржола жойылады. Оқушылардың бұрынғы нәтижелері сақталады.</p>';
  const mode = await dialog({
    title: `«${topic.title}» тақырыбын жою`,
    body,
    buttons: total
      ? [
          { label: 'Болдырмау', value: null, kind: 'ghost' },
          { label: 'Тест пен материалды сақтау', value: 'keep', kind: 'dark' },
          { label: 'Барлығын бірге жою', value: 'cascade', kind: 'danger' },
        ]
      : [
          { label: 'Болдырмау', value: null, kind: 'ghost' },
          { label: 'Жою', value: 'keep', kind: 'danger' },
        ],
  });
  if (!mode) return false;
  try {
    await org.del(`/topics/${topic.id}?mode=${mode}`);
    toast(mode === 'cascade' ? 'Тақырып тест пен материалдарымен бірге жойылды.' : 'Тақырып жойылды.');
    await ctx.reload();
    return true;
  } catch (err) {
    toast(err.message, 'error');
    return false;
  }
}

const topicPayload = (t, patch = {}) => ({
  period_id: t.period_id, title: t.title, slug: t.slug, range_label: t.range_label, summary: t.summary, body: t.body,
  key_points: t.key_points, image_id: t.image_id, icon: t.icon, published: Boolean(t.published), ...patch,
});

export function topicsView(el, _params, ctx) {
  const draw = () => {
    const s = ctx.state;
    el.innerHTML = s.periods
      .map((p) => {
        const list = s.topics.filter((t) => t.period_id === p.id);
        return `
        <section class="o-card">
          <div class="o-card-head">
            <div><p class="eyebrow">${esc(p.range_label)}</p><h2>${esc(p.title)}</h2></div>
            <a class="btn btn-sm" href="/organizer/topics/new?period=${p.id}" data-link>+ Жаңа тақырып</a>
          </div>
          ${
            list.length
              ? `<ol class="o-rows">${list
                  .map((t, i) => {
                    const r = related(s, t.id);
                    return `<li class="o-row" data-id="${t.id}" data-period="${p.id}">
                      <div class="o-order">
                        <button type="button" class="o-icon-btn" data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="Жоғары">▲</button>
                        <button type="button" class="o-icon-btn" data-act="down" ${i === list.length - 1 ? 'disabled' : ''} aria-label="Төмен">▼</button>
                      </div>
                      <span class="o-row-icon">${t.icon ? renderIcon(t.icon, null, 'icon') : String(i + 1).padStart(2, '0')}</span>
                      <div class="o-row-body">
                        <a href="/organizer/topics/${t.id}" data-link><b>${esc(t.title)}</b></a>
                        <small>${esc(t.range_label || '')}${t.range_label ? ' · ' : ''}${r.tests.length} тест · ${r.materials.length} материал${t.image_id ? ' · суреті бар' : ''}</small>
                      </div>
                      ${statusBadge(t.published)}
                      <div class="o-row-actions">
                        <a class="btn btn-ghost btn-sm" href="/organizer/topics/${t.id}" data-link>Өңдеу</a>
                        <button type="button" class="btn btn-ghost btn-sm" data-act="toggle">${t.published ? 'Жасыру' : 'Жариялау'}</button>
                        <button type="button" class="o-icon-btn o-danger" data-act="delete" aria-label="Жою" title="Жою">${icon('cross')}</button>
                      </div>
                    </li>`;
                  })
                  .join('')}</ol>`
              : '<p class="o-muted">Бұл кезеңде тақырып жоқ.</p>'
          }
        </section>`;
      })
      .join('');
  };

  el.addEventListener('click', async (e) => {
    const row = e.target.closest('.o-row');
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!row || !act) return;
    const s = ctx.state;
    const topic = s.topics.find((t) => t.id === Number(row.dataset.id));
    try {
      if (act === 'up' || act === 'down') {
        const list = s.topics.filter((t) => t.period_id === topic.period_id);
        const order = moved(list, list.indexOf(topic), act === 'up' ? -1 : 1).map((t) => t.id);
        await org.post('/topics/reorder', { ids: order });
        await ctx.reload();
        draw();
      } else if (act === 'toggle') {
        await org.put(`/topics/${topic.id}`, topicPayload(topic, { published: !topic.published }));
        toast(topic.published ? 'Тақырып жасырылды. Жариялаған соң оқушыларға көрінбейді.' : 'Тақырып жарияланатын болып белгіленді.');
        await ctx.reload();
        draw();
      } else if (act === 'delete') {
        if (await deleteTopic(ctx, topic)) draw();
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  draw();
}

const keyPointRow = (k = { label: '', text: '' }) => `
  <li class="o-kp"><input data-kp="label" value="${esc(k.label)}" placeholder="Дата немесе ұғым" maxlength="120" />
    <input data-kp="text" value="${esc(k.text)}" placeholder="Түсіндірмесі" maxlength="500" />
    <button type="button" class="o-icon-btn o-danger" data-kp-del aria-label="Жою">${icon('cross')}</button></li>`;

export function topicEditView(el, [id], ctx) {
  const s = ctx.state;
  const isNew = id === 'new';
  const periodParam = Number(new URLSearchParams(location.search).get('period'));
  const t = isNew
    ? { period_id: periodParam || s.periods[0]?.id, title: '', slug: '', range_label: '', summary: '', body: '', key_points: [], image_id: null, icon: null, published: 0 }
    : s.topics.find((x) => x.id === Number(id));
  if (!t) {
    el.innerHTML = '<div class="o-card"><p>Тақырып табылмады.</p><a class="btn btn-sm" href="/organizer/topics" data-link>Тақырыптарға оралу</a></div>';
    return;
  }
  document.getElementById('o-title').textContent = isNew ? 'Жаңа тақырып' : t.title;
  el.innerHTML = `
    <form class="o-card o-form" id="topic-form" novalidate>
      <div class="o-card-head">
        <a class="o-back" href="/organizer/topics" data-link>← Тақырыптар</a>
        <div class="o-row-actions">
          ${!isNew && t.published ? `<a class="btn btn-ghost btn-sm" href="/topics/${encodeURIComponent(t.slug)}" target="_blank" rel="noopener">Сайтта көру</a>` : ''}
          ${!isNew ? '<button type="button" class="btn btn-ghost btn-sm o-danger" id="del">Жою</button>' : ''}
          <button type="submit" class="btn">Сақтау</button>
        </div>
      </div>
      <div class="o-grid-2">
        ${input({ name: 'title', label: 'Тақырып атауы', value: t.title, required: true, max: 160 })}
        ${select({ name: 'period_id', label: 'Кезең', value: t.period_id, options: s.periods.map((p) => ({ value: p.id, label: p.title })), required: true })}
        ${input({ name: 'range_label', label: 'Уақыты (мысалы: XV ғасыр)', value: t.range_label, max: 80 })}
        ${input({ name: 'slug', label: 'Сілтеме (URL)', value: t.slug, max: 60, hint: 'Бос қалдырсаңыз, атауынан жасалады. Өзгертсеңіз, ескі сілтеме жұмыс істемейді.' })}
      </div>
      ${textarea({ name: 'summary', label: 'Қысқаша сипаттама', value: t.summary, rows: 3, max: 600 })}
      ${textarea({ name: 'body', label: 'Оқу материалы', value: t.body, rows: 14, hint: '«## » деп басталған жол — бөлім атауы, «- » деп басталған жол — тізім. Абзацтарды бос жолмен бөліңіз.' })}
      <div class="o-field"><span class="o-label">Есте сақтайтын деректер</span>
        <ul class="o-kps" id="kps">${t.key_points.map(keyPointRow).join('')}</ul>
        <button type="button" class="btn btn-ghost btn-sm" id="kp-add">+ Дерек қосу</button>
      </div>
      <div class="o-grid-2">
        ${fileField({ name: 'image_id', kind: 'image', value: t.image_id, label: 'Тақырып суреті', hint: 'JPG, PNG немесе WEBP, 3 МБ дейін.' })}
        ${iconField({ name: 'icon', label: 'Тақырып белгішесі', value: t.icon })}
      </div>
      ${toggle({ name: 'published', label: 'Оқушыларға көрсету (жариялағаннан кейін)', checked: t.published })}
    </form>`;
  const form = el.querySelector('#topic-form');
  bindFileFields(form, ctx);
  bindIconFields(form, ctx);
  const dirty = trackDirty(form, ctx);

  form.querySelector('#kp-add').addEventListener('click', () => {
    form.querySelector('#kps').insertAdjacentHTML('beforeend', keyPointRow());
    form.querySelector('#kps li:last-child input').focus();
    dirty.mark();
  });
  form.querySelector('#kps').addEventListener('click', (e) => {
    if (e.target.closest('[data-kp-del]')) {
      e.target.closest('li').remove();
      dirty.mark();
    }
  });
  form.querySelector('#del')?.addEventListener('click', async () => {
    if (await deleteTopic(ctx, t)) {
      dirty.clear();
      ctx.navigate('/organizer/topics', { force: true });
    }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = formValues(form);
    if (!v.title.trim()) {
      toast('Тақырып атауын жазыңыз.', 'error');
      form.elements.title.focus();
      return;
    }
    const payload = {
      ...v,
      period_id: Number(v.period_id),
      image_id: v.image_id ? Number(v.image_id) : null,
      icon: JSON.parse(v.icon || 'null'),
      key_points: [...form.querySelectorAll('#kps li')].map((li) => ({
        label: li.querySelector('[data-kp="label"]').value,
        text: li.querySelector('[data-kp="text"]').value,
      })),
    };
    busy(form.querySelector('[type="submit"]'), async () => {
      const r = isNew ? await org.post('/topics', payload) : await org.put(`/topics/${t.id}`, payload);
      dirty.clear();
      toast('Тақырып сақталды. Оқушылар оны жариялағаннан кейін көреді.');
      if (isNew) ctx.navigate(`/organizer/topics/${r.id}`, { replace: true, force: true });
      else {
        await ctx.refreshStatus();
        if (r.slug !== t.slug) ctx.navigate(location.pathname, { replace: true, force: true });
      }
    });
  });
}
