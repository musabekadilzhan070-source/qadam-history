import { api } from '../api.js';
import { esc, formatDate } from '../util.js';
import { icon } from '../art.js';
import { pageHead } from '../components.js';
import { medal } from '../badges.js';

// «Жетістіктер»: every badge, earned ones first in their own colour with the date, the others
// grey with how far the student has come.

export async function achievementsView(el, _params, _app, alive) {
  const data = await api.get('/api/practice/badges');
  if (!alive()) return;
  if (data.fresh.length) api.post('/api/practice/badges/seen', {}).catch(() => {});
  const fresh = new Set(data.fresh.map((b) => b.key));
  const earned = data.badges.filter((b) => b.earned_at).sort((a, b) => (a.earned_at < b.earned_at ? 1 : -1));
  const next = data.badges
    .filter((b) => !b.earned_at)
    .sort((a, b) => b.have / b.need - a.have / a.need);
  const tile = (b) => `
    <li class="badge-tile${b.earned_at ? ' is-earned' : ''}${fresh.has(b.key) ? ' is-fresh' : ''}">
      ${medal(b)}
      <h3>${esc(b.title)}</h3>
      <p>${esc(b.text)}</p>
      ${
        b.earned_at
          ? `<span class="badge-date">${icon('check')} ${esc(formatDate(b.earned_at).split(',')[0])}</span>`
          : `<span class="badge-progress"><i style="--w:${Math.round((b.have / b.need) * 100)}%"></i></span><span class="badge-count">${b.have} / ${b.need}</span>`
      }
    </li>`;
  el.innerHTML = `
    ${pageHead({
      eyebrow: 'Менің жолым',
      title: 'Жетістіктер',
      text: 'Тест, quiz, ҰБТ сынағы мен карточкалар үшін белгілер. Әр белгінің астында оған қанша қалғаны көрсетіледі.',
      extra: `<ul class="head-stats"><li><b>${data.earned}</b>/ ${data.badges.length} белгі</li><li><b>${data.stats.streak}</b>күн қатарынан (ең ұзақ)</li><li><b>${data.stats.cards_learned}</b>карточка меңгерілді</li></ul>`,
    })}
    ${
      earned.length
        ? `<section class="section"><div class="section-head"><div><p class="eyebrow">Алынды</p><h2 class="section-title">Менің белгілерім</h2></div></div>
            <ul class="badge-grid">${earned.map(tile).join('')}</ul></section>`
        : `<section class="panel badge-empty">${icon('medal')}<div><h2>Әзірге белгі жоқ</h2><p>Бірінші тестті тапсырыңыз: «Алғашқы қадам» белгісі бірден беріледі.</p></div>
            <a class="btn" href="/tests" data-link>Тесттерге өту ${icon('arrow', 'icon icon-arrow')}</a></section>`
    }
    ${
      next.length
        ? `<section class="section"><div class="section-head"><div><p class="eyebrow">Алда</p><h2 class="section-title">Келесі белгілер</h2></div></div>
            <ul class="badge-grid">${next.map(tile).join('')}</ul></section>`
        : ''
    }`;
}
