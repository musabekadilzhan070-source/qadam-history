import { org } from './api.js';
import { TYPE_LABELS, CHOICE_TYPES } from '../question-rules.js';
import { esc, icon, toast, dialog, select, topicOptions } from './ui.js';

// Question import and export: Excel (.xlsx) or CSV. The server reads and checks the file;
// nothing is saved until the organizer confirms the preview.

const EXPORT = (id, format) => `/api/org/tests/${id}/export?format=${format}`;
export const TEMPLATE_URL = '/api/org/import/template';

/** Download links for a saved test's questions. */
export const exportButtons = (id) => `
  <a class="btn btn-ghost btn-sm" href="${EXPORT(id, 'xlsx')}" download data-export>Excel-ге экспорт</a>
  <a class="btn btn-ghost btn-sm" href="${EXPORT(id, 'csv')}" download data-export>CSV</a>`;

const flat = (questions) => questions.flatMap((q) => (q.type === 'context' ? [q, ...q.children] : [q]));

function answerSummary(q) {
  if (CHOICE_TYPES.includes(q.type)) {
    return `<ul class="o-imp-opts">${q.options
      .map((o) => `<li class="${o.is_correct ? 'is-right' : ''}">${o.is_correct ? icon('check') : ''}${o.image_id ? `<small>[сурет ${o.image_id}]</small> ` : ''}${esc(o.text)}</li>`)
      .join('')}</ul>`;
  }
  if (q.type === 'matching') return `<ul class="o-imp-opts">${q.data.pairs.map((p) => `<li>${esc(p.left)} → ${esc(p.right)}</li>`).join('')}</ul>`;
  if (q.type === 'ordering') return `<ol class="o-imp-opts">${q.data.items.map((i) => `<li>${esc(i.text)}${i.date ? ` <small>(${esc(i.date)})</small>` : ''}</li>`).join('')}</ol>`;
  if (q.type === 'open') return `<p class="o-muted">Дұрыс жауап: <b>${q.data.answers.map(esc).join(' / ')}</b></p>`;
  return '';
}

/** Is this question a duplicate for the chosen target (the target test or an earlier row of the file)? */
const dupNote = (q, targetId) => {
  const d = q.duplicate || {};
  const inTarget = targetId && d.tests?.find((t) => t.id === targetId);
  if (inTarget) return { skip: true, text: 'Бұл тестте бар' };
  if (d.row) return { skip: true, text: `${d.row}-жолмен қайталанады` };
  if (d.tests?.length) return { skip: false, text: `Басқа тестте бар: «${d.tests[0].title}»` };
  return null;
};

function previewHtml(result, target) {
  const tid = target.mode === 'existing' ? target.testId : null;
  const item = (q, inner = false) => {
    const dup = q.type === 'context' ? null : dupNote(q, tid);
    return `<li class="o-imp-q${inner ? ' is-child' : ''}${dup?.skip ? ' is-dup' : ''}">
      <div class="o-imp-q-head"><small>${q.row}-жол</small><span class="o-badge o-badge-type">${esc(TYPE_LABELS[q.type])}</span>
        ${q.type !== 'context' ? `<small>${q.points} ұпай</small>` : ''}
        ${dup ? `<span class="o-badge ${dup.skip ? 'o-badge-warn' : 'o-badge-off'}">${esc(dup.text)}</span>` : ''}</div>
      <p class="o-imp-text">${q.image_id ? `<small>[сурет ${q.image_id}]</small> ` : ''}${esc(q.text)}</p>
      ${q.type === 'context' ? `${q.data.body ? `<p class="o-muted o-imp-body">${esc(q.data.body.slice(0, 300))}${q.data.body.length > 300 ? '…' : ''}</p>` : ''}
        <ol class="o-imp-list">${q.children.map((c) => item(c, true)).join('')}</ol>` : answerSummary(q)}
    </li>`;
  };
  return `<ol class="o-imp-list">${result.questions.map((q) => item(q)).join('')}</ol>`;
}

function countFor(result, target, skip) {
  const tid = target.mode === 'existing' ? target.testId : null;
  const all = flat(result.questions).filter((q) => q.type !== 'context');
  const dups = all.filter((q) => dupNote(q, tid)?.skip).length;
  return { total: all.length, dups, added: skip ? all.length - dups : all.length };
}

/**
 * Opens the import flow: choose a file, see what the server read (errors by row, duplicates, preview),
 * pick the target test, confirm. Resolves with the test id that received questions, or null.
 */
export function importQuestions(ctx, { testId = null } = {}) {
  const tests = ctx.state.tests;
  return dialog({
    title: 'Сұрақтарды импорттау',
    wide: true,
    body: '<div data-imp></div>',
    onOpen(box, close) {
      const root = box.querySelector('[data-imp]');
      let result = null;
      let fileName = '';
      const target = {
        mode: testId ? 'existing' : 'new',
        testId: testId || tests[0]?.id || null,
        title: '',
        topicId: tests.find((t) => t.id === testId)?.topic_id || '',
      };
      let skip = true;

      const stepFile = (error = '') => {
        root.innerHTML = `
          <p>Excel (.xlsx) немесе CSV файлын таңдаңыз: компьютерден де, телефоннан да жүктеуге болады.
            Файл алдымен тексеріледі; сұрақтар сіз растағаннан кейін ғана сақталады.</p>
          ${error ? `<div class="o-alert">${icon('cross')}<span>${esc(error)}</span></div>` : ''}
          <div class="o-imp-pick">
            <label class="btn"><input type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" hidden data-file />Файлды таңдау</label>
            <a class="btn btn-ghost" href="${TEMPLATE_URL}" download>Excel үлгісін жүктеу</a>
          </div>
          <details class="o-imp-help"><summary>Файл қалай толтырылады және шектеулер</summary>
            <ul>
              <li>Бірінші жол — баған атаулары. Ең қарапайымы: <b>Сұрақ түрі, Сұрақ мәтіні, Жауаптар, Дұрыс жауап</b>; жауаптар бір ұяшықта «;» арқылы жазылады. Үлгідегі «Нұсқа 1, Нұсқа 2…» бағандары да жарайды. Толық сипаттама үлгі файлдың «Нұсқаулық» бетінде.</li>
              <li>Сұрақ түрі: <b>Біржауапты, Көпжауапты, Сәйкестендіру, Хронологиялық реттілік</b> (қосымша: суретпен берілетін сұрақ, ашық жауап, контекст).</li>
              <li>Викторинада «Дұрыс жауап» — жауаптың мәтіні («1465», «Керей; Жәнібек») немесе нөмірі/әрпі («1, 3», «А, Б»).</li>
              <li>Сәйкестендіру: «Керей — 1465–1473; Қасым — 1511–1521». Реттілік: «Оқиға — дата; …», дұрыс ретпен (немесе дұрыс реті «Дұрыс жауап» бағанында). Оқушыға элементтер араластырылып беріледі.</li>
              <li>Сурет файлға кірмейді: тек кабинеттегі суреттің ID нөмірі жазылады. Жаңа суретті алдымен «Суреттер» бөліміне жүктеңіз.</li>
              <li>Формулалар, түстер, бірінші беттен басқа беттер оқылмайды; ескі .xls форматы қолданылмайды. Бір файлда ең көбі 500 жол, бір тестте 200 сұрақ.</li>
            </ul>
          </details>`;
        root.querySelector('[data-file]').addEventListener('change', async (e) => {
          const file = e.target.files[0];
          if (!file) return;
          if (!/\.(xlsx|csv)$/i.test(file.name) && !/spreadsheetml|csv/.test(file.type)) return stepFile(`«${file.name}»: тек .xlsx немесе .csv файлы қабылданады.`);
          if (file.size > 4 * 1024 * 1024) return stepFile('Файл тым үлкен (ең көбі 4 МБ).');
          fileName = file.name;
          root.innerHTML = '<p class="o-muted">Файл тексерілуде…</p>';
          try {
            result = await org.upload('/import/parse', file);
            stepPreview();
          } catch (err) {
            stepFile(err.message);
          }
        });
      };

      const stepPreview = () => {
        const c = countFor(result, target, skip);
        const errors = result.errors || [];
        root.innerHTML = `
          <p><b>${esc(fileName)}</b> (${result.format.toUpperCase()}): <b>${c.total}</b> сұрақ дұрыс оқылды${errors.length ? `, <b class="o-warn">${errors.length}</b> жолда қате бар` : ''}${c.dups ? `, <b>${c.dups}</b> қайталанатын сұрақ` : ''}.</p>
          ${
            errors.length
              ? `<div class="o-alert">${icon('cross')}<span><b>Мына жолдар импортталмайды (файлды түзетіп, қайта жүктеуге болады):</b>
                <ul class="o-problems">${errors.map((e) => `<li>${e.row}-жол${e.column ? `, ${esc(e.column)} бағаны` : ''}: ${esc(e.message)}</li>`).join('')}</ul></span></div>`
              : ''
          }
          ${c.total ? `<p class="o-imp-types">${Object.entries(result.by_type || {}).map(([t, n]) => `<span class="o-badge o-badge-type">${esc(TYPE_LABELS[t])}: ${n}</span>`).join(' ')}</p>` : ''}
          ${result.warnings?.length ? `<div class="o-alert o-alert-warn"><span><b>Ескерту:</b><ul class="o-problems">${result.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></span></div>` : ''}
          ${
            c.total
              ? `<fieldset class="o-imp-target"><legend class="o-label">Сұрақтарды қайда қосу керек?</legend>
                  <label class="o-radio"><input type="radio" name="imp-mode" value="existing" ${target.mode === 'existing' ? 'checked' : ''} ${tests.length ? '' : 'disabled'} /> Бар тестке қосу (соңына)</label>
                  ${
                    target.mode === 'existing'
                      ? select({ name: 'imp-test', label: 'Тест', value: target.testId, options: tests.map((t) => ({ value: t.id, label: `${t.title} (${t.question_count} сұрақ)` })) })
                      : ''
                  }
                  <label class="o-radio"><input type="radio" name="imp-mode" value="new" ${target.mode === 'new' ? 'checked' : ''} /> Жаңа тест құру</label>
                  ${
                    target.mode === 'new'
                      ? `<label class="o-field"><span class="o-label">Тест атауы <i>*</i></span><input name="imp-title" maxlength="160" value="${esc(target.title)}" /></label>
                        ${select({ name: 'imp-topic', label: 'Тақырып', value: target.topicId, options: topicOptions(ctx.state, { empty: '— Тақырыпты таңдаңыз —' }), required: true })}`
                      : ''
                  }
                  <label class="o-radio"><input type="checkbox" name="imp-skip" ${skip ? 'checked' : ''} /> Қайталанатын сұрақтарды қоспау${c.dups ? ` (${c.dups})` : ''}</label>
                </fieldset>
                <h3 class="o-imp-title">Алдын ала қарау</h3>
                ${previewHtml(result, target)}`
              : '<p>Импорттауға жарайтын сұрақ табылмады. Қателерді түзетіп, файлды қайта жүктеңіз.</p>'
          }
          <div class="o-imp-actions">
            <button type="button" class="btn btn-ghost" data-again>Басқа файл таңдау</button>
            <button type="button" class="btn btn-ghost" data-cancel>Болдырмау</button>
            ${c.total ? `<button type="button" class="btn" data-commit ${c.added ? '' : 'disabled'}>Импорттау (${c.added} сұрақ)</button>` : ''}
          </div>`;
      };

      root.addEventListener('change', (e) => {
        const t = e.target;
        if (t.name === 'imp-mode') target.mode = t.value;
        else if (t.name === 'imp-test') target.testId = Number(t.value);
        else if (t.name === 'imp-topic') target.topicId = t.value;
        else if (t.name === 'imp-skip') skip = t.checked;
        else return;
        stepPreview();
      });
      root.addEventListener('input', (e) => {
        if (e.target.name === 'imp-title') target.title = e.target.value;
      });
      root.addEventListener('click', async (e) => {
        if (e.target.closest('[data-again]')) return stepFile();
        if (e.target.closest('[data-cancel]')) return close(null);
        const btn = e.target.closest('[data-commit]');
        if (!btn) return;
        if (target.mode === 'new' && !target.title.trim()) return toast('Жаңа тесттің атауын жазыңыз.', 'error');
        if (target.mode === 'new' && !target.topicId) return toast('Жаңа тестті тақырыпқа байланыстырыңыз.', 'error');
        btn.disabled = true;
        btn.textContent = 'Сақталуда…';
        try {
          const r = await org.post('/import/commit', {
            target: target.mode,
            test_id: target.testId,
            title: target.title,
            topic_id: Number(target.topicId) || null,
            questions: result.questions,
            skip_duplicates: skip,
          });
          toast(`${r.added} сұрақ «${r.test.title}» тестіне қосылды${r.skipped ? `, ${r.skipped} қайталанатын сұрақ қосылмады` : ''}. Оқушылар өзгерісті тест жарияланғаннан кейін көреді.`);
          close(r.test_id);
        } catch (err) {
          // Nothing was written: the save is one transaction.
          toast(`Импорт сәтсіз аяқталды, ештеңе өзгермеді: ${err.message}`, 'error');
          btn.disabled = false;
          btn.textContent = 'Қайталау';
        }
      });
      stepFile();
    },
  });
}
