import { org } from './api.js';
import { esc, icon } from './ui.js';
import { gradeLabel } from '../catalog.js';

// «Quiz нәтижелері»: every student's quiz runs, apart from the classic test results. A finished
// quiz is always 100%; how it went is told by the first-try answers, the repeated questions,
// the wrong answers and the time.

const when = (value) => {
  if (!value) return '';
  const d = new Date(`${String(value).replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ru-RU', { timeZone: 'Asia/Almaty', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const duration = (sec) => {
  const s = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const quizName = (t) => String(t || '').replace(/\s*\(QUIZ\)\s*$/i, '');

export async function quizResultsView(el, _params, ctx, alive) {
  const query = new URLSearchParams(location.search);
  let testId = query.get('test') || '';
  let search = '';
  let status = '';
  let runs = [];

  const quizzes = [...(ctx.state.quizzes || [])].sort((a, b) => a.title.localeCompare(b.title, 'kk'));

  async function load() {
    const qs = new URLSearchParams();
    if (testId) qs.set('test', testId);
    if (query.get('user')) qs.set('user', query.get('user'));
    runs = (await org.get(`/quizzes/results${qs.toString() ? `?${qs}` : ''}`)).runs;
  }

  const shown = () =>
    runs.filter((r) => {
      if (status === 'done' && !r.finished) return false;
      if (status === 'open' && r.finished) return false;
      if (!search) return true;
      return `${r.user.display_name} ${r.user.login}`.toLocaleLowerCase('kk').includes(search);
    });

  function draw() {
    const list = shown();
    const finished = list.filter((r) => r.finished);
    el.innerHTML = `
      <div class="o-toolbar">
        <a class="btn btn-ghost" href="/organizer/quizzes" data-link>${icon('quiz')} Quiz тесттер</a>
      </div>
      <section class="o-card o-card-tight">
        <div class="o-filters">
          <label class="o-field"><span class="o-label">Quiz</span>
            <select data-filter="test"><option value="">Барлық Quiz</option>${quizzes
              .map((q) => `<option value="${q.id}" ${String(q.id) === testId ? 'selected' : ''}>${esc(quizName(q.title))}${q.grade ? ` · ${esc(gradeLabel(q.grade))}` : ''}${q.publisher ? ` ${esc(q.publisher)}` : ''}</option>`)
              .join('')}</select></label>
          <label class="o-field"><span class="o-label">Күйі</span>
            <select data-filter="status">
              <option value="">Барлығы</option>
              <option value="done" ${status === 'done' ? 'selected' : ''}>Аяқталған (100%)</option>
              <option value="open" ${status === 'open' ? 'selected' : ''}>Жалғасып жатқан</option>
            </select></label>
          <label class="o-field"><span class="o-label">Оқушы</span><input data-filter="search" value="${esc(search)}" placeholder="Аты немесе поштасы" /></label>
        </div>
        <p class="o-muted">${list.length} жазба · аяқталғаны ${finished.length}${finished.length ? ` · бірден дұрыс орта есеппен ${Math.round((finished.reduce((s, r) => s + r.first_correct / Math.max(1, r.total), 0) / finished.length) * 100)}%` : ''}</p>
        ${
          list.length
            ? `<div class="o-table-wrap"><table class="o-table">
                <thead><tr><th>Оқушы</th><th>Quiz</th><th>Басталды</th><th>Аяқталды</th><th>Бірден дұрыс</th><th>Қайталанған сұрақ</th><th>Қате жауап</th><th>Уақыт</th><th>Нәтиже</th></tr></thead>
                <tbody>${list
                  .map(
                    (r) => `<tr>
                      <td><b>${esc(r.user.display_name)}</b><br /><small class="o-muted">${esc(r.user.login)}</small></td>
                      <td>${esc(quizName(r.title))}<br /><small class="o-muted">${esc([r.period_title, [gradeLabel(r.grade), r.publisher].filter(Boolean).join(' | ')].filter(Boolean).join(' · '))}</small></td>
                      <td>${esc(when(r.started_at))}</td>
                      <td>${r.finished ? esc(when(r.finished_at)) : '<span class="o-badge o-badge-warn">Жалғасуда</span>'}</td>
                      <td>${r.first_correct} / ${r.total}</td>
                      <td>${r.repeated}</td>
                      <td>${r.wrong_answers}</td>
                      <td>${duration(r.duration_sec)}</td>
                      <td>${r.finished ? '<span class="o-badge o-badge-on">100%</span>' : `${r.done} / ${r.total}`}</td>
                    </tr>`,
                  )
                  .join('')}</tbody></table></div>`
            : '<p class="o-muted">Әзірге Quiz нәтижесі жоқ.</p>'
        }
      </section>`;
  }

  await load();
  if (!alive()) return;
  draw();
  el.addEventListener('change', async (e) => {
    const f = e.target.dataset.filter;
    if (f === 'test') {
      testId = e.target.value;
      const qs = new URLSearchParams(location.search);
      if (testId) qs.set('test', testId);
      else qs.delete('test');
      history.replaceState(null, '', `/organizer/quiz-results${qs.toString() ? `?${qs}` : ''}`);
      await load();
      if (alive()) draw();
    } else if (f === 'status') {
      status = e.target.value;
      draw();
    }
  });
  el.addEventListener('input', (e) => {
    if (e.target.dataset.filter !== 'search') return;
    search = e.target.value.trim().toLocaleLowerCase('kk');
    const pos = e.target.selectionStart;
    draw();
    const input = el.querySelector('[data-filter="search"]');
    input.focus();
    input.setSelectionRange(pos, pos);
  });
}
