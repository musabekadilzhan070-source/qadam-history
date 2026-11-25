// Quiet motion for the pages inside the site: period cards draw their emblem when they come
// into view, and the numbers of a page head count up. All the motion itself is CSS
// (.pc-live, .banner.is-intro in qadam.css); here only the moment it starts is chosen.

const still = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const played = new Set();

/** True the first time a key is asked for in this tab: an opening plays once, not on every visit. */
export const firstTime = (key) => {
  if (played.has(key)) return false;
  played.add(key);
  return !still();
};

let seen = null;
const watch = (card) => {
  if (!('IntersectionObserver' in window)) return card.classList.add('is-seen');
  seen ||= new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('is-seen');
        seen.unobserve(e.target);
      }
    },
    { rootMargin: '0px 0px -12% 0px', threshold: 0.15 },
  );
  seen.observe(card);
};

function countUp(b) {
  const end = Number(b.textContent.replace(/\s/g, ''));
  if (!Number.isFinite(end) || end < 2) return;
  const text = b.textContent;
  const t0 = performance.now();
  const step = (now) => {
    if (!b.isConnected) return;
    const k = Math.min(1, (now - t0) / 1100);
    b.textContent = k < 1 ? String(Math.round(end * (1 - (1 - k) ** 3))) : text;
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** Called after every page is drawn. */
export function liven(root) {
  if (still()) return;
  root.querySelectorAll('.period-grid').forEach((grid) => {
    [...grid.querySelectorAll('.period-card')].forEach((card, i) => {
      card.style.setProperty('--i', i);
      card.classList.add('pc-live');
      watch(card);
    });
  });
  root.querySelectorAll('.page-head .head-stats b').forEach(countUp);
}
