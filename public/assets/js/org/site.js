import { org } from './api.js';
import { TEXT_FIELDS } from '../site.js';
import { esc, toast, fileField, bindFileFields, trackDirty, busy } from './ui.js';

export function siteView(el, _params, ctx) {
  const s = ctx.state;
  const texts = s.texts;
  el.innerHTML = `
    <form class="o-card o-form" id="texts-form" novalidate>
      <div class="o-card-head">
        <div><h2>Сайт мәтіндері</h2><p class="o-muted">Бос қалдырылған өріс сайттың бастапқы мәтінін көрсетеді (сұр түспен жазылған).</p></div>
        <button type="submit" class="btn">Сақтау</button>
      </div>
      ${fileField({ name: 'banner_image_id', kind: 'image', value: texts.banner_image_id, label: 'Баннер суреті', hint: 'Таңдалмаса, баннердегі тарихи сурет (Түркістан, Яссауи кесенесі) көрсетіледі. Кең сурет таңдаңыз.' })}
      ${TEXT_FIELDS.map(
        (g) => `<fieldset class="o-fieldset"><legend>${esc(g.group)}</legend><div class="o-grid-2">
          ${g.fields
            .map(
              ([key, label, def, kind]) => `<label class="o-field${kind === 'long' ? ' o-span-2' : ''}"><span class="o-label">${esc(label)}</span>
                ${
                  kind === 'long'
                    ? `<textarea name="${key}" rows="2" maxlength="600" placeholder="${esc(def)}">${esc(texts[key] || '')}</textarea>`
                    : `<input name="${key}" maxlength="600" placeholder="${esc(def)}" value="${esc(texts[key] || '')}" />`
                }</label>`,
            )
            .join('')}
        </div></fieldset>`,
      ).join('')}
    </form>
    <section class="o-card">
      <div class="o-card-head"><div><h2>Тарихи кезеңдер</h2><p class="o-muted">Кезең карточкаларының атауы, уақыты және сипаттамасы.</p></div></div>
      <div class="o-periods">
        ${s.periods
          .map(
            (p, i) => `<form class="o-period" data-id="${p.id}">
              <span class="o-q-num">${String(i + 1).padStart(2, '0')}</span>
              <label class="o-field"><span class="o-label">Атауы <i>*</i></span><input name="title" value="${esc(p.title)}" maxlength="80" required /></label>
              <label class="o-field"><span class="o-label">Уақыты</span><input name="range_label" value="${esc(p.range_label)}" maxlength="80" /></label>
              <label class="o-field o-span-2"><span class="o-label">Сипаттама</span><textarea name="summary" rows="3" maxlength="400">${esc(p.summary)}</textarea></label>
              <button type="submit" class="btn btn-dark btn-sm">Кезеңді сақтау</button>
            </form>`,
          )
          .join('')}
      </div>
    </section>`;

  const form = el.querySelector('#texts-form');
  bindFileFields(form, ctx);
  const dirty = trackDirty(form, ctx);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const out = {};
    for (const field of form.elements) if (field.name) out[field.name] = field.value.trim();
    if (out.banner_image_id) out.banner_image_id = Number(out.banner_image_id);
    busy(form.querySelector('[type="submit"]'), async () => {
      await org.put('/texts', { texts: out });
      dirty.clear();
      toast('Мәтіндер сақталды. Сайтта көрінуі үшін жариялаңыз.');
      await ctx.refreshStatus();
    });
  });
  el.querySelectorAll('.o-period').forEach((pf) =>
    pf.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!pf.elements.title.value.trim()) return toast('Кезең атауын жазыңыз.', 'error');
      busy(pf.querySelector('[type="submit"]'), async () => {
        await org.put(`/periods/${pf.dataset.id}`, { title: pf.elements.title.value, range_label: pf.elements.range_label.value, summary: pf.elements.summary.value });
        toast('Кезең сақталды.');
        await ctx.refreshStatus();
      });
    }),
  );
}
