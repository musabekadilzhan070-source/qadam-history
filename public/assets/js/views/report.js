import { api } from '../api.js';
import { esc } from '../util.js';
import { pageHead } from '../components.js';
import { drawReport, pdfFromCanvas, dayTitle, almatyTime } from '../report-canvas.js';

// «Кураторға есеп беру». Two reports, both the signed-in student's own data, fetched fresh:
//  • «Тест бойынша»: one test, first result against the last one, history and what to repeat;
//  • «Бүгінгі есеп»: everything done today (Asia/Almaty day).
// The report is drawn on a canvas and saved as PNG, JPG or a one-page PDF, or shared from a phone.

const toBlob = (canvas, type, quality) =>
  new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Сурет жасалмады.'))), type, quality));

function save(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export async function reportView(el, _params, app, alive) {
  const { tests } = await api.get('/api/report/tests');
  if (!alive()) return;
  const asked = Number(new URLSearchParams(location.search).get('test'));
  let mode = new URLSearchParams(location.search).get('mode') === 'day' || !tests.length ? 'day' : 'test';
  let testId = tests.some((t) => t.test_id === asked) ? asked : tests[0]?.test_id ?? null;

  const option = (t) =>
    `<option value="${t.test_id}" ${t.test_id === testId ? 'selected' : ''}>${esc(t.title)} · ${t.attempts} рет · ${t.first_percent}% → ${t.last_percent}%</option>`;

  el.innerHTML = `
    ${pageHead({ eyebrow: 'Есеп', title: 'Кураторға есеп беру', text: 'Нәтижеңіз бір суретте: алғашқы және соңғы нәтиже, өзгеріс, тапсыру тарихы. Суретті немесе PDF-ті сақтап, кураторға жіберіңіз.' })}
    <div class="report-actions panel">
      <div class="report-modes" role="group" aria-label="Есеп түрі">
        <button type="button" class="chip" data-mode="test" aria-pressed="${mode === 'test'}" ${tests.length ? '' : 'disabled'}>Тест бойынша есеп</button>
        <button type="button" class="chip" data-mode="day" aria-pressed="${mode === 'day'}">Бүгінгі есеп</button>
      </div>
      ${
        tests.length
          ? `<label class="tag-filter report-test" data-test-pick ${mode === 'test' ? '' : 'hidden'}><span>Тест</span>
              <select name="test">${tests.map(option).join('')}</select></label>`
          : '<p class="report-note">Әзірге аяқталған тест жоқ. Тест тапсырған соң, мұнда алғашқы және соңғы нәтиже салыстырылады.</p>'
      }
      <div class="report-buttons">
        <button type="button" class="btn" data-act="png" disabled>PNG жүктеу</button>
        <button type="button" class="btn btn-ghost" data-act="jpg" disabled>JPG жүктеу</button>
        <button type="button" class="btn btn-ghost" data-act="pdf" disabled>PDF жүктеу</button>
        <button type="button" class="btn btn-dark" data-act="share" hidden disabled>Бөлісу</button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="refresh" disabled>Жаңарту</button>
      </div>
      <p class="report-note" data-note role="status">Есеп дайындалуда…</p>
    </div>
    <div class="report-preview" data-preview></div>`;

  const note = (t) => (el.querySelector('[data-note]').textContent = t);
  let canvas = null;
  let png = null;
  let base = '';
  let title = '';
  let run = 0;

  function syncUrl() {
    const qs = new URLSearchParams();
    if (mode === 'day') qs.set('mode', 'day');
    else if (testId) qs.set('test', testId);
    history.replaceState(null, '', qs.toString() ? `/report?${qs}` : '/report');
  }

  async function build() {
    const mine = ++run;
    el.querySelectorAll('[data-act]').forEach((b) => (b.disabled = true));
    note('Есеп дайындалуда…');
    // Fresh data every time: a new attempt or a new Almaty day shows up at once.
    const r = mode === 'test' ? await api.get(`/api/report/test/${testId}`) : await api.get('/api/report/daily');
    if (!alive() || mine !== run) return;
    const c = await drawReport(mode, r);
    const blob = await toBlob(c, 'image/png');
    if (!alive() || mine !== run) return;
    canvas = c;
    png = blob;
    const stamp = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(new Date(r.generated_at));
    base = mode === 'test' ? `qadam-esep-test-${testId}-${stamp}` : `qadam-esep-${r.day}`;
    title = mode === 'test' ? `QADAM: ${r.test.title} бойынша есеп` : `QADAM: ${dayTitle(r.day)} күнгі есеп`;
    const img = new Image();
    img.alt = mode === 'test' ? `${r.student}: «${r.test.title}» тесті бойынша есеп` : `${r.student}: ${dayTitle(r.day)} күнгі есеп`;
    img.src = c.toDataURL('image/png'); // the page's CSP allows data: images, not blob:
    el.querySelector('[data-preview]').replaceChildren(img);
    const file = new File([blob], `${base}.png`, { type: 'image/png' });
    const canShare = Boolean(navigator.canShare && navigator.share && navigator.canShare({ files: [file] }));
    el.querySelector('[data-act="share"]').hidden = !canShare;
    el.querySelectorAll('[data-act]').forEach((b) => (b.disabled = false));
    const what = mode === 'test' ? `«${r.test.title}» · ${r.attempts.length} тапсыру` : dayTitle(r.day);
    note(`${what} · жасалған уақыты ${almatyTime(r.generated_at)}`);
  }
  const rebuild = () => build().catch((err) => alive() && note(err.message || 'Есеп жасалмады.'));

  el.addEventListener('change', (e) => {
    if (e.target.name !== 'test') return;
    testId = Number(e.target.value);
    syncUrl();
    rebuild();
  });

  el.addEventListener('click', async (e) => {
    const modeBtn = e.target.closest('[data-mode]');
    if (modeBtn && modeBtn.dataset.mode !== mode) {
      mode = modeBtn.dataset.mode;
      el.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
      const pick = el.querySelector('[data-test-pick]');
      if (pick) pick.hidden = mode !== 'test';
      syncUrl();
      return rebuild();
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'refresh') return rebuild();
    if (!png) return;
    try {
      if (act === 'png') save(png, `${base}.png`);
      else if (act === 'jpg') save(await toBlob(canvas, 'image/jpeg', 0.92), `${base}.jpg`);
      else if (act === 'pdf') save(await pdfFromCanvas(canvas), `${base}.pdf`);
      else if (act === 'share') await navigator.share({ files: [new File([png], `${base}.png`, { type: 'image/png' })], title });
    } catch (err) {
      if (err?.name === 'AbortError') return;
      note(act === 'share' ? 'Бөлісу мүмкін болмады. «PNG жүктеу» батырмасын қолданыңыз.' : err.message || 'Файл жасалмады.');
    }
  });

  syncUrl();
  await rebuild();
}
