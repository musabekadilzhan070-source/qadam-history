import { org } from './api.js';
import { esc, toast, fileSrc, formatBytes, pickFiles, uploadFiles, busy, topicOptions, select } from './ui.js';
import { deleteFile } from './icons.js';

export function imagesView(el, _params, ctx) {
  let filter = 'image';
  const draw = () => {
    const s = ctx.state;
    const files = s.files.filter((f) => f.kind === filter);
    el.innerHTML = `
      <div class="o-card">
        <div class="o-card-head">
          <div><h2>Сурет және файл кітапханасы</h2><p class="o-muted">Суреттер: JPG, PNG, WEBP, 3 МБ дейін. PDF: 4 МБ дейін. Файлдар деректер қорында тұрақты сақталады.</p></div>
          <button type="button" class="btn" data-act="upload">${filter === 'pdf' ? 'PDF жүктеу' : 'Сурет жүктеу'}</button>
        </div>
        <div class="chips" role="group" aria-label="Файл түрі">
          <button type="button" class="chip" data-filter="image" aria-pressed="${filter === 'image'}">Суреттер (${s.files.filter((f) => f.kind === 'image').length})</button>
          <button type="button" class="chip" data-filter="pdf" aria-pressed="${filter === 'pdf'}">PDF (${s.files.filter((f) => f.kind === 'pdf').length})</button>
        </div>
      </div>
      <div class="o-gallery">
        ${
          files.length
            ? files
                .map(
                  (f) => `<form class="o-card o-media" data-id="${f.id}">
                    ${
                      f.kind === 'pdf'
                        ? `<a class="o-media-pdf" href="${fileSrc(f)}" target="_blank" rel="noopener">PDF<small>ашу</small></a>`
                        : `<a class="o-media-img" href="${fileSrc(f)}" target="_blank" rel="noopener"><img src="${fileSrc(f)}" alt="${esc(f.name)}" loading="lazy" /></a>`
                    }
                    <label class="o-field"><span class="o-label">Атауы</span><input name="name" value="${esc(f.name)}" maxlength="120" required /></label>
                    ${select({ name: 'topic_id', label: 'Тақырып', value: f.topic_id, options: topicOptions(s, { empty: '— Тақырыпқа байланыстырмау —' }) })}
                    <input type="hidden" name="material_id" value="${f.material_id ?? ''}" />
                    <p class="o-muted o-media-meta">${formatBytes(f.size)} · ${f.mime.replace('image/', '').toUpperCase()}${f.version > 1 ? ` · ${f.version}-нұсқа` : ''}</p>
                    ${f.used_by.length ? `<p class="o-media-used"><b>Қолданылады:</b> ${f.used_by.map(esc).join('; ')}</p>` : '<p class="o-muted o-media-used">Әзірге еш жерде қолданылмайды.</p>'}
                    <div class="o-row-actions">
                      <button type="submit" class="btn btn-sm">Сақтау</button>
                      <button type="button" class="btn btn-ghost btn-sm" data-act="replace">Ауыстыру</button>
                      <button type="button" class="btn btn-ghost btn-sm o-danger" data-act="delete">Жою</button>
                    </div>
                  </form>`,
                )
                .join('')
            : `<div class="o-card"><p class="o-muted">Кітапхана бос. «${filter === 'pdf' ? 'PDF жүктеу' : 'Сурет жүктеу'}» батырмасын басыңыз.</p></div>`
        }
      </div>`;
  };

  el.addEventListener('click', async (e) => {
    const chip = e.target.closest('[data-filter]');
    if (chip) {
      filter = chip.dataset.filter;
      return draw();
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'upload') {
      const created = await uploadFiles(filter, await pickFiles(filter, { multiple: true }), ctx);
      if (created.length) {
        await ctx.reload();
        draw();
      }
      return;
    }
    const card = e.target.closest('.o-media');
    if (!card || !act) return;
    const id = Number(card.dataset.id);
    if (act === 'replace') {
      const f = ctx.state.files.find((x) => x.id === id);
      const [file] = await pickFiles(f.kind);
      if (!file) return;
      try {
        await org.upload(`/files/${id}/content`, file);
        toast('Файл ауыстырылды. Ол қолданылған барлық жерде жаңа нұсқа көрсетіледі.');
        await ctx.reload();
        draw();
      } catch (err) {
        toast(err.message, 'error');
      }
    } else if (act === 'delete') {
      if (await deleteFile(ctx, id)) draw();
    }
  });
  el.addEventListener('submit', (e) => {
    e.preventDefault();
    const card = e.target.closest('.o-media');
    const id = Number(card.dataset.id);
    const name = card.elements.name.value.trim();
    if (!name) return toast('Файл атауын жазыңыз.', 'error');
    busy(card.querySelector('[type="submit"]'), async () => {
      await org.put(`/files/${id}`, {
        name,
        topic_id: Number(card.elements.topic_id.value) || null,
        material_id: Number(card.elements.material_id.value) || null,
      });
      toast('Файл мәліметтері сақталды.');
      await ctx.reload();
    });
  });
  draw();
}
