import { org } from './api.js';
import { esc, icon, toast, dialog, confirmDialog, busy } from './ui.js';
import { reviewList } from '../views/review.js';

// Test links: every test has a permanent link (/t/<id>) that students open without an account.
// The cabinet turns a link on or off, sets its times and rules, and collects the results.

export const linkUrl = (shareId) => `${location.origin}/t/${shareId}`;

const pad = (n) => String(n).padStart(2, '0');
/** ISO → value of <input type="datetime-local"> in this device's time. */
const toLocal = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocal = (v) => (v ? new Date(v).toISOString() : null);
const fmt = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const dbTime = (s) => (s ? fmt.format(new Date(String(s).replace(' ', 'T') + 'Z')) : '—');
const isoTime = (s) => (s ? fmt.format(new Date(s)) : '');
export const minSec = (sec) => (sec == null ? '—' : sec < 60 ? `${sec} с` : `${Math.floor(sec / 60)} мин ${pad(sec % 60)} с`);

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers and http pages: a hidden field and the copy command.
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:-100px;opacity:0';
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

const STATE_TEXT = { open: 'Сілтеме ашық', closed: 'Сілтеме өшірулі', not_yet: 'Әлі ашылмаған', ended: 'Мерзімі өткен' };
export const linkBadge = (link) =>
  `<span class="o-badge ${link.state?.open ? 'o-badge-on' : 'o-badge-off'}" title="${esc(link.state?.message || '')}">${STATE_TEXT[link.state?.reason] || (link.enabled ? STATE_TEXT.open : STATE_TEXT.closed)}</span>`;

/**
 * Copies a test's link. A link that is off is useless to students, so the organizer is asked to
 * turn it on first. Returns the link as it is after that, or null.
 */
export async function copyLink(testId, shareId, enabled) {
  let link = null;
  if (!enabled) {
    const ok = await confirmDialog('Сілтеме өшірулі', 'Оқушылар бұл сілтеме арқылы тест тапсыра алмайды. Сілтемені қосып, көшіресіз бе?', { ok: 'Қосу және көшіру' });
    if (!ok) return null;
    link = await org.put(`/links/${testId}`, { enabled: true });
  }
  const url = linkUrl(shareId);
  if (await copyText(url)) toast(`Сілтеме көшірілді: ${url}`);
  else await dialog({ title: 'Сілтемені көшіріңіз', body: `<input class="o-link-input" readonly value="${esc(url)}" />`, buttons: [{ label: 'Жабу', value: true }] });
  return link;
}

// ─── The link card in the test editor ─────────────────────────────
function cardHtml(link, dirty) {
  return `
    <section class="o-card o-link-card">
      <div class="o-card-head"><div><h2>Сілтеме арқылы тапсыру</h2>
        <p class="o-muted">Сілтемені WhatsApp немесе басқа мессенджер арқылы жіберіңіз: оқушы тіркелмей, аты-жөнін жазып тапсырады. Сілтеме тұрақты, барлық оқушыға бір сілтеме жетеді.</p></div>
        ${linkBadge(link)}</div>
      <div class="o-link-row">
        <input class="o-link-input" readonly value="${esc(linkUrl(link.share_id))}" aria-label="Тест сілтемесі" />
        <button type="button" class="btn btn-sm" data-link-act="copy">Сілтемені көшіру</button>
        <a class="btn btn-ghost btn-sm" href="${esc(link.path)}" target="_blank" rel="noopener">Тестті ашу</a>
        <a class="btn btn-ghost btn-sm" href="/organizer/links?test=${link.test_id}" data-link>Нәтижелерді көру${link.finished ? ` (${link.finished})` : ''}</a>
      </div>
      ${dirty ? '<p class="o-warn">Сілтеме тесттің сақталған нұсқасын береді. Өзгерістерді алдымен «Сақтау» батырмасымен сақтаңыз.</p>' : '<p class="o-muted o-link-note">Сілтеме тесттің «Сақтау» басылған соңғы нұсқасын береді (жариялау міндетті емес). Тапсырып жатқан оқушы өз нұсқасы бойынша бағаланады.</p>'}
      <div class="o-flags o-link-flags">
        <label class="o-toggle"><input type="checkbox" data-link-field="enabled" ${link.enabled ? 'checked' : ''} /><span></span>Сілтеме арқылы тапсыру қосулы</label>
        <label class="o-toggle"><input type="checkbox" data-link-field="retakes" ${link.retakes ? 'checked' : ''} /><span></span>Қайта тапсыруға рұқсат беру</label>
        <label class="o-toggle"><input type="checkbox" data-link-field="show_result" ${link.show_result ? 'checked' : ''} /><span></span>Соңында оқушыға нәтижесін көрсету</label>
        <label class="o-toggle"><input type="checkbox" data-link-field="show_answers" ${link.show_answers ? 'checked' : ''} ${link.show_result ? '' : 'disabled'} /><span></span>Соңында дұрыс жауаптарды да көрсету (өшірулі болса, оқушы тек өз жауабының дұрыс-қатесін көреді)</label>
      </div>
      <div class="o-grid-2">
        <label class="o-field"><span class="o-label">Басталу уақыты (міндетті емес)</span><input type="datetime-local" data-link-field="opens_at" value="${toLocal(link.opens_at)}" /></label>
        <label class="o-field"><span class="o-label">Аяқталу уақыты (міндетті емес)</span><input type="datetime-local" data-link-field="closes_at" value="${toLocal(link.closes_at)}" /></label>
      </div>
      <p class="o-muted o-link-note">Мерзім қойылмаса, тест сіз сілтемені өшіргенше ашық тұрады. Уақыт шектеуі жоғарыдағы «Тест уақыты» баптауынан алынады. Бұл баптаулар бірден сақталады.</p>
    </section>`;
}

/**
 * Fills `holder` with the link card of a test. `cache` keeps the link between redraws of the
 * editor, so typing in the test never refetches it.
 */
export async function mountLinkCard(holder, testId, cache, { dirty = false } = {}) {
  if (!holder) return;
  if (!cache.link) {
    const { links } = await org.get('/links');
    cache.link = links.find((l) => l.test_id === testId) || null;
  }
  if (!cache.link || !holder.isConnected) return;
  holder.innerHTML = cardHtml(cache.link, dirty);
  if (holder.dataset.bound) return;
  holder.dataset.bound = '1';
  const save = async (patch) => {
    try {
      cache.link = { ...cache.link, ...(await org.put(`/links/${testId}`, patch)) };
      toast('Сілтеме баптауы сақталды.');
    } catch (err) {
      toast(err.message, 'error');
    }
    holder.innerHTML = cardHtml(cache.link, holder.dataset.dirty === '1');
  };
  holder.addEventListener('change', (e) => {
    const f = e.target.dataset.linkField;
    if (!f) return;
    if (e.target.type === 'checkbox') save({ [f]: e.target.checked });
    else save({ [f]: fromLocal(e.target.value) });
  });
  holder.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-link-act="copy"]');
    if (!btn) return;
    await busy(btn, async () => {
      const changed = await copyLink(testId, cache.link.share_id, cache.link.enabled);
      if (changed) {
        cache.link = { ...cache.link, ...changed };
        holder.innerHTML = cardHtml(cache.link, holder.dataset.dirty === '1');
      }
    });
  });
}

// ─── «Сілтеме арқылы тапсырылған тесттер» ─────────────────────────
const STATUS = {
  finished: '<span class="o-badge o-badge-on">Аяқталды</span>',
  in_progress: '<span class="o-badge o-badge-warn">Орындалуда</span>',
  unfinished: '<span class="o-badge o-badge-off">Аяқталмады</span>',
};
const COLUMNS = [
  { key: 'name', label: 'Оқушының аты-жөні' },
  { key: 'test_title', label: 'Тест', all: true },
  { key: 'score', label: 'Нәтиже' },
  { key: 'percent', label: 'Пайыз' },
  { key: 'duration_sec', label: 'Уақыты' },
  { key: 'reworks', label: 'Қатемен жұмыс' },
  { key: 'started_at', label: 'Тапсырған уақыты' },
  { key: 'status', label: 'Мәртебесі' },
];

export async function linksView(el, _params, ctx, alive) {
  let { links } = await org.get('/links');
  if (!alive()) return;
  const asked = Number(new URLSearchParams(location.search).get('test')) || null;
  let testId = links.some((l) => l.test_id === asked) ? asked : null;
  let results = [];
  let q = '';
  let sort = { key: 'started_at', dir: -1 };

  const syncUrl = () => history.replaceState(null, '', testId ? `/organizer/links?test=${testId}` : '/organizer/links');
  const load = async () => {
    results = (await org.get(`/links/results${testId ? `?test_id=${testId}` : ''}`)).results;
  };

  const shown = () => {
    const needle = q.trim().toLocaleLowerCase('kk');
    const list = needle ? results.filter((r) => r.name.toLocaleLowerCase('kk').includes(needle)) : results.slice();
    const val = (r) => (sort.key === 'score' ? (r.max_score ? r.score / r.max_score : -1) : r[sort.key] ?? -1);
    list.sort((a, b) => {
      const x = val(a);
      const y = val(b);
      if (typeof x === 'string' || typeof y === 'string') return String(x).localeCompare(String(y), 'kk') * sort.dir;
      return (x - y) * sort.dir || (a.id - b.id) * -1;
    });
    return list;
  };

  const drawTable = () => {
    const list = shown();
    const cols = COLUMNS.filter((c) => !c.all || !testId);
    const finished = list.filter((r) => r.status === 'finished');
    const avg = finished.length ? Math.round(finished.reduce((s, r) => s + r.percent, 0) / finished.length) : null;
    el.querySelector('[data-summary]').textContent = `${list.length} жұмыс · аяқталғаны ${finished.length}${avg !== null ? ` · орташа нәтиже ${avg}%` : ''}`;
    el.querySelector('[data-table]').innerHTML = list.length
      ? `<div class="o-table-wrap"><table class="o-table">
          <thead><tr><th>№</th>${cols
            .map((c) => `<th><button type="button" class="o-sort" data-sort="${c.key}" aria-sort="${sort.key === c.key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}">${c.label}${sort.key === c.key ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</button></th>`)
            .join('')}<th><span class="o-visually-hidden">Әрекеттер</span></th></tr></thead>
          <tbody>${list
            .map(
              (r, i) => `<tr data-id="${r.id}">
                <td>${i + 1}</td>
                <td><b>${esc(r.name)}</b></td>
                ${testId ? '' : `<td>${esc(r.test_title)}</td>`}
                <td>${r.status === 'finished' ? `${r.score}/${r.max_score}` : '—'}</td>
                <td>${r.status === 'finished' ? `<b>${r.percent}%</b>` : '—'}</td>
                <td>${r.status === 'finished' ? minSec(r.duration_sec) : '—'}</td>
                <td>${r.reworks ? `${r.reworks} рет<small class="o-muted o-cell-note">соңғысы: ${r.rework_last.correct}/${r.rework_last.total} дұрыс</small>` : '—'}</td>
                <td>${dbTime(r.started_at)}</td>
                <td>${STATUS[r.status]}</td>
                <td class="o-table-actions"><button type="button" class="btn btn-ghost btn-sm" data-open ${r.status === 'finished' ? '' : 'disabled'}>Жұмысын ашу</button>
                  <button type="button" class="o-icon-btn o-danger" data-delete aria-label="Жою" title="Жою">${icon('cross')}</button></td>
              </tr>`,
            )
            .join('')}</tbody></table></div>`
      : `<div class="o-empty"><p>${results.length ? 'Іздеу бойынша ештеңе табылмады.' : 'Әзірге бұл сілтеме арқылы ешкім тапсырмаған.'}</p></div>`;
  };

  const linkPanel = () => {
    const l = links.find((x) => x.test_id === testId);
    if (!l) return '';
    return `<div class="o-link-row o-link-panel">
        ${linkBadge(l)}
        <input class="o-link-input" readonly value="${esc(linkUrl(l.share_id))}" aria-label="Тест сілтемесі" />
        <button type="button" class="btn btn-sm" data-copy>Сілтемені көшіру</button>
        <a class="btn btn-ghost btn-sm" href="${esc(l.path)}" target="_blank" rel="noopener">Тестті ашу</a>
        <button type="button" class="btn btn-ghost btn-sm" data-toggle>${l.enabled ? 'Сілтемені өшіру' : 'Сілтемені қосу'}</button>
        <a class="btn btn-ghost btn-sm" href="/organizer/tests/${l.test_id}" data-link>Баптаулар</a>
      </div>`;
  };

  const draw = () => {
    const exportUrl = (format) => `/api/org/links/results/export?format=${format}${testId ? `&test_id=${testId}` : ''}`;
    el.innerHTML = `
      <section class="o-card">
        <div class="o-card-head"><div><h2>Сілтеме арқылы тапсырылған тесттер</h2>
          <p class="o-muted">Мұнда тек тест сілтемесі арқылы (тіркелусіз) тапсырылған жұмыстар түседі. Аты-жөні оқушының өзі жазғаны: бірдей есім бір адам деп біріктірілмейді.</p></div></div>
        <form class="o-fb-filters o-link-filters" data-filters>
          <label class="o-field"><span class="o-label">Тест</span>
            <select name="test"><option value="">Барлық тесттер</option>${links
              .filter((l) => l.finished || l.unfinished || l.enabled || l.test_id === testId)
              .map((l) => `<option value="${l.test_id}" ${l.test_id === testId ? 'selected' : ''}>${esc(l.title)} (${l.finished})</option>`)
              .join('')}</select></label>
          <label class="o-field o-fb-q"><span class="o-label">Аты-жөні бойынша іздеу</span><input type="search" name="q" value="${esc(q)}" placeholder="Мысалы: Айдана" /></label>
          <div class="o-field"><span class="o-label">Экспорт</span><div class="o-row-actions">
            <a class="btn btn-ghost btn-sm" href="${exportUrl('xlsx')}" download>Excel</a>
            <a class="btn btn-ghost btn-sm" href="${exportUrl('csv')}" download>CSV</a></div></div>
        </form>
        ${linkPanel()}
        <p class="o-muted o-fb-note" data-summary></p>
      </section>
      <section class="o-card o-card-tight" data-table></section>`;
    drawTable();
  };

  async function openWork(id) {
    const w = await org.get(`/links/results/${id}`);
    await dialog({
      title: `${w.name}: ${w.test_title}`,
      wide: true,
      body: `<div class="o-work-head">
          <span><b>${w.score}/${w.max_score}</b> ұпай</span><span><b>${w.percent}%</b></span>
          <span>Дұрыс: <b>${w.correct}/${w.total}</b></span><span>Уақыты: <b>${minSec(w.duration_sec)}</b></span>
          <span>Тапсырған: <b>${dbTime(w.started_at)}</b></span></div>
        <p class="o-muted">Бастапқы нәтиже. Қатемен жұмыс оны өзгертпейді, төменде бөлек көрсетіледі.</p>
        <div class="o-work-review">${reviewList(w.items)}</div>
        ${(w.rework_list || [])
          .map(
            (r, i) => `<div class="o-work-rework">
              <h3>Қатемен жұмыс ${i + 1}</h3>
              <div class="o-work-head"><span>Дұрыс: <b>${r.correct}/${r.total}</b></span><span>Әлі қате: <b>${r.total - r.correct}</b></span>
                <span>Уақыты: <b>${minSec(r.duration_sec)}</b></span><span>Аяқталған: <b>${dbTime(r.finished_at)}</b></span></div>
              <div class="o-work-review">${reviewList(r.items)}</div></div>`,
          )
          .join('')}`,
      buttons: [{ label: 'Жабу', value: true }],
    });
  }

  el.addEventListener('input', (e) => {
    if (e.target.name === 'q') {
      q = e.target.value;
      drawTable();
    }
  });
  el.addEventListener('change', async (e) => {
    if (e.target.name !== 'test') return;
    testId = Number(e.target.value) || null;
    syncUrl();
    await load();
    if (alive()) draw();
  });
  el.addEventListener('submit', (e) => e.preventDefault());
  el.addEventListener('click', async (e) => {
    const s = e.target.closest('[data-sort]');
    if (s) {
      const key = s.dataset.sort;
      sort = sort.key === key ? { key, dir: -sort.dir } : { key, dir: key === 'name' || key === 'test_title' ? 1 : -1 };
      return drawTable();
    }
    const l = links.find((x) => x.test_id === testId);
    if (e.target.closest('[data-copy]') && l) {
      const changed = await copyLink(l.test_id, l.share_id, l.enabled);
      if (changed) {
        Object.assign(l, changed);
        draw();
      }
      return;
    }
    const toggle = e.target.closest('[data-toggle]');
    if (toggle && l) {
      await busy(toggle, async () => {
        Object.assign(l, await org.put(`/links/${l.test_id}`, { enabled: !l.enabled }));
        toast(l.enabled ? 'Сілтеме қосылды.' : 'Сілтеме өшірілді: жаңа тапсыру басталмайды.');
      });
      return draw();
    }
    const row = e.target.closest('tr[data-id]');
    if (!row) return;
    const id = Number(row.dataset.id);
    if (e.target.closest('[data-open]')) {
      try {
        await openWork(id);
      } catch (err) {
        toast(err.message, 'error');
      }
    } else if (e.target.closest('[data-delete]')) {
      const r = results.find((x) => x.id === id);
      if (!(await confirmDialog('Нәтижені жою', `«${r.name}» жұмысы біржола жойылады.`, { ok: 'Жою', danger: true }))) return;
      await org.del(`/links/results/${id}`);
      results = results.filter((x) => x.id !== id);
      drawTable();
    }
  });

  await load();
  if (!alive()) return;
  draw();
  // New results come in while students take the test: refresh quietly every 30 seconds.
  const timer = setInterval(async () => {
    if (!alive()) return clearInterval(timer);
    if (document.hidden) return;
    try {
      await load();
      ({ links } = await org.get('/links'));
      if (alive() && !document.querySelector('.o-modal-wrap')) drawTable();
    } catch {
      /* the next tick tries again */
    }
  }, 30000);
}
