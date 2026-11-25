import { api } from './api.js';
import { esc } from './util.js';
import { icon } from './art.js';

// Achievement badges: the medal drawn for a badge, and the toast that greets a new one.
// The server decides what is earned; checkBadges() asks after a test, a quiz, a mock exam
// or a cards session, and shows each badge that has not been shown yet.

/** The round medal of a badge (earned: red and gold; not yet: grey with the progress ring). */
export function medal(b, size = 'md') {
  const pct = b.need ? Math.min(1, b.have / b.need) : 0;
  const r = 30;
  const len = 2 * Math.PI * r;
  return `
    <span class="medal medal-${size}${b.earned_at ? ' is-earned' : ''}" aria-hidden="true">
      <svg class="medal-ring" viewBox="0 0 68 68"><circle cx="34" cy="34" r="${r}" class="medal-track"/>
        <circle cx="34" cy="34" r="${r}" class="medal-fill" stroke-dasharray="${(b.earned_at ? 1 : pct) * len} ${len}"/></svg>
      <span class="medal-face">${icon(b.icon || 'medal')}</span>
    </span>`;
}

let checking = null;

export function checkBadges() {
  checking ||= (async () => {
    try {
      const { fresh } = await api.get('/api/practice/badges');
      if (fresh?.length) {
        showToast(fresh);
        api.post('/api/practice/badges/seen', {}).catch(() => {});
      }
    } catch {
      // A badge is a bonus: never let it break the page.
    } finally {
      checking = null;
    }
  })();
  return checking;
}

function showToast(list) {
  document.querySelector('.badge-toast')?.remove();
  const box = document.createElement('div');
  box.className = 'badge-toast';
  box.setAttribute('role', 'status');
  const first = list[0];
  box.innerHTML = `
    ${medal(first, 'sm')}
    <div class="badge-toast-text">
      <p class="eyebrow">${list.length > 1 ? `${list.length} жаңа жетістік` : 'Жаңа жетістік'}</p>
      <b>${esc(first.title)}</b>
      <span>${list.length > 1 ? list.slice(1).map((b) => esc(b.title)).join(', ') : esc(first.text)}</span>
    </div>
    <a class="badge-toast-link" href="/achievements" data-link>Көру</a>
    <button type="button" class="badge-toast-close" aria-label="Жабу">${icon('cross')}</button>`;
  document.body.append(box);
  requestAnimationFrame(() => box.classList.add('is-in'));
  const close = () => {
    box.classList.remove('is-in');
    setTimeout(() => box.remove(), 400);
  };
  box.querySelector('.badge-toast-close').addEventListener('click', close);
  box.querySelector('.badge-toast-link').addEventListener('click', close);
  setTimeout(close, 7000);
}
