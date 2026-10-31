import { api } from './api.js';

// Active time for the daily report. While the page is visible and the student has touched,
// typed or scrolled recently, a heartbeat goes to the server every 15 seconds. The server marks
// 15-second slots of the Almaty day, so two open tabs count once and an idle or hidden page adds nothing.

const BEAT_MS = 15000;
const IDLE_MS = { site: 3 * 60000, test: 4 * 60000, book: 5 * 60000 };

let enabled = false;
let lastInput = Date.now();
let lastBeat = 0;
let context = { kind: 'site' };
let timer = null;

const markInput = () => {
  lastInput = Date.now();
};

function active() {
  return enabled && document.visibilityState === 'visible' && Date.now() - lastInput < (IDLE_MS[context.kind] || IDLE_MS.site);
}

async function beat() {
  if (!active()) {
    lastBeat = 0;
    return;
  }
  const now = Date.now();
  const continuous = lastBeat > 0 && now - lastBeat < BEAT_MS * 1.8;
  lastBeat = now;
  try {
    await api.post('/api/activity', { ...context, continuous });
  } catch {
    /* offline or signed out: the next beat tries again */
  }
}

export const activity = {
  /** Starts (signed in) or stops (signed out) the heartbeat. */
  enable(on) {
    enabled = Boolean(on);
    clearInterval(timer);
    timer = enabled ? setInterval(beat, BEAT_MS) : null;
  },
  /** What the student is doing now: { kind: 'site' | 'test' | 'book', book_id, page }. */
  set(next) {
    context = { kind: 'site', ...next };
  },
  page(page) {
    if (context.kind === 'book') context.page = page;
  },
  touch: markInput,
};

for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll']) {
  window.addEventListener(type, markInput, { passive: true, capture: true });
}
let moveAt = 0;
window.addEventListener('pointermove', () => {
  if (Date.now() - moveAt > 5000) {
    moveAt = Date.now();
    markInput();
  }
}, { passive: true });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') markInput();
  else lastBeat = 0;
});
