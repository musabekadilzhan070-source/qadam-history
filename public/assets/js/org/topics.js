import { org } from './api.js';
import { renderIcon } from '../site.js';
import {
  esc, icon, toast, dialog, statusBadge, input, textarea, select, toggle,
  formValues, trackDirty, busy, moved,
} from './ui.js';
import { iconField, bindIconFields } from './icons.js';
import { TOPIC_CLASSES, topicClassLabel } from '../catalog.js';

const classKey = (t) => (t?.grade && t?.publisher ? `${t.grade}|${t.publisher}` : '');

const related = (s, id) => ({
  tests: s.tests.filter((x) => x.topic_id === id),
  persons: s.persons.filter((p) => p.topic_id === id),
});

/** Asks how to delete a topic: keep its tests, or delete them too. */
export async function deleteTopic(ctx, topic) {
  const r = related(ctx.state, topic.id);
  const total = r.tests.length + r.persons.length;
  const body = total
    ? `<p>Бұл тақырыпқа байланысты: <b>${r.tests.length}</b> тест, <b>${r.persons.length}</b> тұлға.</p>
       <p>Оларды сақтап қалуға (тақырыпсыз, жасырын күйде қалады, кейін басқа тақырыпқа байланыстыруға болады) немесе тақырыппен бірге жоюға болады.</p>
       <p class="o-muted">Оқушылардың бұрынғы нәтижелері «Менің нәтижелерім» бетінде сақталады.</p>`
    : '<p>Тақырып біржола жойылады. Оқушылардың бұрынғы нәтижелері сақталады.</p>';
  const mode = await dialog({
    title: `«${topic.title}» тақырыбын жою`,
    body,
    buttons: total
      ? [
          { label: 'Болдырмау', value: null, kind: 'ghost' },
          { label: 'Тесттерді сақтау', value: 'keep', kind: 'dark' },
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
    toast(mode === 'cascade' ? 'Тақырып тесттерімен бірге жойылды.' : 'Тақырып жойылды.');
    await ctx.reload();
    return true;
  } catch (err) {
    toast(err.message, 'error');
    return false;
  }
}

const topicPayload = (t, patch = {}) => ({
  period_id: t.period_id, title: t.title, slug: t.slug, range_label: t.range_label, summary: t.summary, body: t.body,
  key_points: t.key_points, image_id: t.image_id, icon: t.icon, published: Boolean(t.published),
  // A topic made before the grade and publisher field keeps none until it is edited.
  ...(t.grade ? { grade: t.grade, publisher: t.publisher } : {}),
  ...patch,
});

export function topicsView(el, _params, ctx) {
  // Filter by grade and publisher: '' all, 'none' not chosen yet, or '8|Атамұра'.
  let only = new URLSearchParams(location.search).get('class') || '';
  const matches = (t) => !only || (only === 'none' ? !classKey(t) : classKey(t) === only);
  const draw = () => {
    const s = ctx.state;
    const missing = s.topics.filter((t) => !classKey(t)).length;
    const shownCount = s.topics.filter(matches).length;
    el.innerHTML = `
      <section class="o-card o-topic-filter">
        <label class="o-field"><span class="o-label">Сынып және баспа бойынша сүзу</span>
          <select data-class-filter>
            <option value="">Барлық тақырыптар (${s.topics.length})</option>
            ${TOPIC_CLASSES.map(({ grade, publisher }) => {
              const key = `${grade}|${publisher}`;
              const n = s.topics.filter((t) => classKey(t) === key).length;
              return `<option value="${esc(key)}" ${only === key ? 'selected' : ''}>${grade}-сынып — ${esc(publisher)} (${n})</option>`;
            }).join('')}
            <option value="none" ${only === 'none' ? 'selected' : ''}>Сынып пен баспа таңдалмаған (${missing})</option>
          </select></label>
        <p class="o-muted">${only ? `Көрсетілгені: ${shownCount} тақырып.` : missing ? `${missing} тақырыпқа сынып пен баспа әлі таңдалмаған: оларды ашып, «Сынып және баспа» өрісін толтырыңыз.` : 'Барлық тақырыпқа сынып пен баспа таңдалған.'}</p>
      </section>` + s.periods
      .map((p) => {
        const all = s.topics.filter((t) => t.period_id === p.id);
        const list = all.filter(matches);
        if (only && !list.length) return '';
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
                    // Moving up/down works on the whole period, so it is off while a filter hides topics.
                    const at = all.indexOf(t);
                    return `<li class="o-row" data-id="${t.id}" data-period="${p.id}">
                      <div class="o-order">
                        <button type="button" class="o-icon-btn" data-act="up" ${only || at === 0 ? 'disabled' : ''} aria-label="Жоғары">▲</button>
                        <button type="button" class="o-icon-btn" data-act="down" ${only || at === all.length - 1 ? 'disabled' : ''} aria-label="Төмен">▼</button>
                      </div>
                      <span class="o-row-icon">${t.icon ? renderIcon(t.icon, null, 'icon') : String(i + 1).padStart(2, '0')}</span>
                      <div class="o-row-body">
                        <a href="/organizer/topics/${t.id}" data-link><b>${esc(t.title)}</b></a>
                        <small>${topicClassLabel(t) ? `<span class="o-class-tag">${esc(topicClassLabel(t))}</span> ` : '<span class="o-warn">Сынып пен баспа таңдалмаған</span> · '}${esc(t.range_label || '')}${t.range_label ? ' · ' : ''}${r.tests.length} тест${t.image_id ? ' · суреті бар' : ''}</small>
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

  el.addEventListener('change', (e) => {
    if (!e.target.matches('[data-class-filter]')) return;
    only = e.target.value;
    history.replaceState(null, '', only ? `/organizer/topics?class=${encodeURIComponent(only)}` : '/organizer/topics');
    draw();
  });
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

export function topicEditView(el, [id], ctx) {
  const s = ctx.state;
  const isNew = id === 'new';
  const periodParam = Number(new URLSearchParams(location.search).get('period'));
  const t = isNew
    ? { period_id: periodParam || s.periods[0]?.id, title: '', slug: '', range_label: '', summary: '', body: '', key_points: [], image_id: null, icon: null, published: 0, grade: null, publisher: '' }
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
          ${!isNew ? '<button type="button" class="btn btn-ghost btn-sm o-danger" id="del">Жою</button>' : ''}
          <button type="submit" class="btn">Сақтау</button>
        </div>
      </div>
      <div class="o-grid-2">
        ${input({ name: 'title', label: 'Тақырып атауы', value: t.title, required: true, max: 160 })}
        ${select({ name: 'period_id', label: 'Кезең', value: t.period_id, options: s.periods.map((p) => ({ value: p.id, label: p.title })), required: true })}
        ${input({ name: 'range_label', label: 'Уақыты (мысалы: XV ғасыр)', value: t.range_label, max: 80 })}
        ${select({
          name: 'class',
          label: 'Сынып және баспа',
          value: classKey(t),
          required: true,
          options: [{ value: '', label: 'Таңдаңыз…' }, ...TOPIC_CLASSES.map(({ grade, publisher }) => ({ value: `${grade}|${publisher}`, label: `${grade}-сынып — ${publisher}` }))],
        })}
      </div>
      ${!isNew && !classKey(t) ? '<p class="o-warn">Бұл тақырыпқа сынып пен баспа әлі таңдалмаған. Сақтау үшін «Сынып және баспа» өрісін толтырыңыз.</p>' : ''}
      ${textarea({ name: 'summary', label: 'Қысқаша сипаттама (тест карточкасында көрсетіледі)', value: t.summary, rows: 3, max: 600 })}
      ${iconField({ name: 'icon', label: 'Тақырып эмблемасы', value: t.icon, emblems: true })}
      ${toggle({ name: 'published', label: 'Оқушыларға көрсету (жариялағаннан кейін)', checked: t.published })}
    </form>`;
  const form = el.querySelector('#topic-form');
  bindIconFields(form, ctx);
  const dirty = trackDirty(form, ctx);

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
    if (!v.class) {
      toast('Сынып пен баспаны таңдаңыз. Онсыз тақырыпты сақтауға болмайды.', 'error');
      form.elements.class.focus();
      form.elements.class.closest('.o-field').classList.add('is-invalid');
      return;
    }
    const [grade, publisher] = v.class.split('|');
    // The reading text, key facts and picture are no longer shown to students; earlier values are kept as they are.
    const payload = topicPayload(t, {
      title: v.title,
      period_id: Number(v.period_id),
      range_label: v.range_label,
      summary: v.summary,
      icon: JSON.parse(v.icon || 'null'),
      published: Boolean(v.published),
      grade: Number(grade),
      publisher,
    });
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
