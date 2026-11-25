import { api } from '../api.js';
import { esc } from '../util.js';
import { icon } from '../art.js';
import { pageHead } from '../components.js';
import { checkBadges } from '../badges.js';

// «Карточкалар»: dates and persons to learn by heart. A session shows the cards due for review
// first, then new ones; the student turns a card over and says whether they knew it. Known cards
// come back after longer and longer breaks (Leitner boxes, kept on the server); a card they did
// not know comes back again in the same session.

const SESSION = 20;
const KIND = { date: 'Дата', person: 'Тұлға' };
const shuffle = (list) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export async function cardsView(el, _params, app, alive) {
  const data = await api.get('/api/practice/cards');
  if (!alive()) return;
  const query = new URLSearchParams(location.search);
  const state = {
    kind: ['date', 'person'].includes(query.get('kind')) ? query.get('kind') : '',
    period: Number(query.get('period')) || 0,
    reverse: false,
  };
  const periodTitle = new Map(data.periods.map((p) => [p.number, p.title]));
  const progress = data.progress;
  const LEARNED = data.learned_box;
  let session = null;
  let keyHandler = null;

  const inDeck = () => data.cards.filter((c) => (!state.kind || c.kind === state.kind) && (!state.period || c.period_number === state.period));
  const boxOf = (c) => progress[c.id]?.box || 0;
  const isDue = (c) => boxOf(c) > 0 && boxOf(c) < 6 && progress[c.id].due_at <= data.now;
  const counts = (list) => ({
    all: list.length,
    fresh: list.filter((c) => !boxOf(c)).length,
    learning: list.filter((c) => boxOf(c) && boxOf(c) < LEARNED).length,
    learned: list.filter((c) => boxOf(c) >= LEARNED).length,
    due: list.filter(isDue).length,
  });

  function remember() {
    const qs = new URLSearchParams();
    if (state.kind) qs.set('kind', state.kind);
    if (state.period) qs.set('period', state.period);
    history.replaceState(null, '', qs.toString() ? `/cards?${qs}` : '/cards');
  }

  const all = counts(data.cards);

  function drawHome() {
    session = null;
    const deck = inDeck();
    const c = counts(deck);
    const ready = deck.filter(isDue).length + deck.filter((x) => !boxOf(x)).length;
    const share = c.all ? Math.round((c.learned / c.all) * 100) : 0;
    el.innerHTML = `
      ${pageHead({
        eyebrow: 'Есте сақта',
        title: 'Карточкалар',
        text: 'Маңызды даталар мен тарихи тұлғалар. Карточканы аударып, білгеніңді белгіле: білетінің сирек, білмейтінің жиі қайталанады.',
        extra: `<ul class="head-stats"><li><b>${all.all}</b>карточка</li><li><b>${all.learned}</b>меңгерілді</li><li><b>${all.due}</b>қайталау керек</li></ul>`,
      })}
      <div class="toolbar cards-toolbar">
        <div class="seg" role="group" aria-label="Карточка түрі">
          ${[['', 'Барлығы'], ['date', 'Даталар'], ['person', 'Тұлғалар']].map(([k, t]) => `<button type="button" data-kind="${k}" aria-pressed="${state.kind === k}">${t}</button>`).join('')}
        </div>
        <div class="chips" role="group" aria-label="Кезең">
          <button type="button" class="chip" data-period="0" aria-pressed="${!state.period}">Барлық кезең</button>
          ${data.periods.map((p) => `<button type="button" class="chip" data-period="${p.number}" aria-pressed="${state.period === p.number}"><span class="chip-num">${String(p.number).padStart(2, '0')}</span>${esc(p.title)}</button>`).join('')}
        </div>
      </div>
      <section class="panel cards-deck">
        <div class="cards-ring" style="--p:${share}" role="img" aria-label="Меңгерілгені ${share}%"><div><b>${share}%</b><span>меңгерілді</span></div></div>
        <ul class="cards-counts">
          <li><b>${c.fresh}</b><span>жаңа</span></li>
          <li><b>${c.learning}</b><span>оқылуда</span></li>
          <li><b>${c.learned}</b><span>меңгерілді</span></li>
          <li class="is-due"><b>${c.due}</b><span>қайталау уақыты келді</span></li>
        </ul>
        <div class="cards-actions">
          ${
            c.all
              ? `${ready ? `<button type="button" class="btn btn-lg" data-go="learn">${icon('cards')} Жаттауды бастау <small>${Math.min(ready, SESSION)}</small></button>` : '<p class="cards-done">Бүгінгі карточкалар қайталанды. Келесі қайталау уақыты келгенде осында шығады.</p>'}
                 <button type="button" class="btn btn-ghost" data-go="all">Барлығын аралас қайталау</button>
                 <label class="cards-flip-opt"><input type="checkbox" data-reverse ${state.reverse ? 'checked' : ''} /> Алдымен ${state.kind === 'person' ? 'сипаттамасы' : state.kind === 'date' ? 'оқиғасы' : 'жауабы'} көрсетілсін</label>`
              : '<p class="cards-done">Бұл сүзгі бойынша карточка жоқ.</p>'
          }
        </div>
      </section>
      ${
        deck.length
          ? `<section class="section">
              <div class="section-head"><div><p class="eyebrow">Тізім</p><h2 class="section-title">${state.kind === 'person' ? 'Тұлғалар' : state.kind === 'date' ? 'Даталар' : 'Барлық карточка'}</h2></div></div>
              <ul class="cards-list">
                ${deck
                  .map(
                    (x) => `<li class="box-${Math.min(boxOf(x), 5)}">
                      <span class="cl-front">${esc(x.front)}</span>
                      <span class="cl-back">${esc(x.back)}${x.note ? `<small>${esc(x.note)}</small>` : ''}</span>
                      <span class="cl-meta">${KIND[x.kind]}${periodTitle.get(x.period_number) ? ` · ${esc(periodTitle.get(x.period_number))}` : ''}
                        <i class="cl-level" aria-label="${boxOf(x) >= LEARNED ? 'Меңгерілді' : boxOf(x) ? 'Оқылуда' : 'Жаңа'}">${[1, 2, 3, 4, 5].map((n) => `<b class="${boxOf(x) >= n ? 'on' : ''}"></b>`).join('')}</i></span>
                    </li>`,
                  )
                  .join('')}
              </ul>
            </section>`
          : ''
      }`;
    el.querySelectorAll('[data-kind]').forEach((b) =>
      b.addEventListener('click', () => {
        state.kind = b.dataset.kind;
        remember();
        drawHome();
      }),
    );
    el.querySelectorAll('[data-period]').forEach((b) =>
      b.addEventListener('click', () => {
        state.period = Number(b.dataset.period);
        remember();
        drawHome();
      }),
    );
    el.querySelector('[data-reverse]')?.addEventListener('change', (e) => {
      state.reverse = e.target.checked;
    });
    el.querySelector('[data-go="learn"]')?.addEventListener('click', () => {
      const deckNow = inDeck();
      const due = deckNow.filter(isDue).sort((a, b) => boxOf(a) - boxOf(b));
      const fresh = deckNow.filter((x) => !boxOf(x));
      startSession([...due, ...fresh].slice(0, SESSION));
    });
    el.querySelector('[data-go="all"]')?.addEventListener('click', () => startSession(shuffle(inDeck()).slice(0, SESSION)));
  }

  function startSession(cards) {
    if (!cards.length) return;
    session = { queue: cards.map((c) => ({ card: c, retry: false })), size: cards.length, done: 0, known: 0, again: 0, flipped: false, busy: false };
    window.scrollTo(0, 0);
    drawCard();
  }

  function drawCard() {
    const item = session.queue[0];
    if (!item) return drawEnd();
    const c = item.card;
    const front = state.reverse ? c.back : c.front;
    const back = state.reverse ? c.front : c.back;
    session.flipped = false;
    el.innerHTML = `
      <div class="cards-session">
        <div class="cs-top">
          <button type="button" class="btn btn-ghost btn-sm" data-stop>${icon('back')} Шығу</button>
          <div class="cs-progress"><span>${session.done} / ${session.size}</span><div class="progress"><i style="width:${(session.done / session.size) * 100}%"></i></div></div>
        </div>
        <div class="flashcard ${c.kind === 'person' ? 'is-person' : 'is-date'}" tabindex="0" role="button" aria-label="Карточканы аудару">
          <div class="fc-inner">
            <div class="fc-face fc-front">
              <p class="fc-tag">${icon(c.kind === 'person' ? 'profile' : 'clock')} ${KIND[c.kind]}${periodTitle.get(c.period_number) ? ` · ${esc(periodTitle.get(c.period_number))}` : ''}</p>
              <p class="fc-text">${esc(front)}</p>
              <p class="fc-hint">${item.retry ? 'Қайта сұралып тұр · ' : ''}Аудару үшін басыңыз</p>
            </div>
            <div class="fc-face fc-back">
              <p class="fc-tag">${esc(front)}</p>
              <p class="fc-text">${esc(back)}</p>
              ${c.note ? `<p class="fc-note">${esc(c.note)}</p>` : ''}
            </div>
          </div>
        </div>
        <div class="cs-answer" hidden>
          <button type="button" class="btn cs-again" data-answer="0">${icon('repeat')} Қайталау керек</button>
          <button type="button" class="btn cs-know" data-answer="1">${icon('check')} Білемін</button>
        </div>
        <p class="cs-keys">Пернетақта: бос орын — аудару, ← қайталау, → білемін</p>
      </div>`;
    const card = el.querySelector('.flashcard');
    card.addEventListener('click', flip);
    el.querySelector('[data-stop]').addEventListener('click', () => (session.done ? drawEnd() : drawHome()));
    el.querySelectorAll('[data-answer]').forEach((b) => b.addEventListener('click', () => answer(b.dataset.answer === '1')));
    // A swipe on a turned card answers it: right = know, left = again.
    let x0 = null;
    card.addEventListener('touchstart', (e) => (x0 = e.touches[0].clientX), { passive: true });
    card.addEventListener('touchend', (e) => {
      if (x0 === null || !session?.flipped) return;
      const dx = e.changedTouches[0].clientX - x0;
      x0 = null;
      if (Math.abs(dx) > 70) answer(dx > 0);
    });
    card.focus({ preventScroll: true });
  }

  function flip() {
    if (!session || session.busy) return;
    session.flipped = !session.flipped;
    el.querySelector('.flashcard').classList.toggle('is-flipped', session.flipped);
    if (session.flipped) el.querySelector('.cs-answer').hidden = false;
  }

  async function answer(known) {
    if (!session || !session.flipped || session.busy) return;
    session.busy = true;
    const item = session.queue[0];
    const card = el.querySelector('.flashcard');
    card.classList.add(known ? 'go-right' : 'go-left');
    try {
      const p = await api.post(`/api/practice/cards/${item.card.id}/review`, { known });
      progress[item.card.id] = { box: p.box, due_at: p.due_at, right: p.right, wrong: p.wrong };
    } catch (err) {
      session.busy = false;
      card.classList.remove('go-right', 'go-left');
      alert(err.message);
      return;
    }
    session.queue.shift();
    if (known) {
      session.done += 1;
      session.known += item.retry ? 0 : 1;
    } else {
      session.again += item.retry ? 0 : 1;
      // The card comes back a few cards later in this session.
      session.queue.splice(Math.min(session.queue.length, 3), 0, { card: item.card, retry: true });
    }
    setTimeout(() => {
      if (!session) return;
      session.busy = false;
      drawCard();
    }, 260);
  }

  function drawEnd() {
    const s = session;
    session = null;
    el.innerHTML = `
      <section class="panel cards-end">
        <span class="cards-end-mark">${icon('check')}</span>
        <h1>Жарайсыз!</h1>
        <p>${s.done} карточка қайталанды.</p>
        <ul class="cards-counts">
          <li><b>${s.known}</b><span>бірден білдіңіз</span></li>
          <li class="is-due"><b>${s.again}</b><span>қайта жаттадыңыз</span></li>
        </ul>
        <div class="cards-actions">
          <button type="button" class="btn" data-more>Тағы жаттау</button>
          <button type="button" class="btn btn-ghost" data-home>Карточкаларға оралу</button>
        </div>
      </section>`;
    // The counts in the head are worked out again from the saved progress.
    Object.assign(all, counts(data.cards));
    el.querySelector('[data-home]').addEventListener('click', drawHome);
    el.querySelector('[data-more]').addEventListener('click', () => {
      drawHome();
      el.querySelector('[data-go="learn"]')?.click();
    });
    if (s.done) checkBadges();
  }

  keyHandler = (e) => {
    if (!session || e.target.closest('input, textarea, select')) return;
    if (e.key === ' ' || e.key === 'Enter') {
      if (e.target.closest('button') && !e.target.closest('.flashcard')) return;
      e.preventDefault();
      flip();
    } else if (e.key === 'ArrowRight' || e.key === '2') answer(true);
    else if (e.key === 'ArrowLeft' || e.key === '1') answer(false);
  };
  document.addEventListener('keydown', keyHandler);
  drawHome();
  app.guard = () => !session || !session.done || confirm('Жаттау аяқталмады. Шығасыз ба? Белгілеген карточкалар сақталды.');
  return () => {
    document.removeEventListener('keydown', keyHandler);
    app.guard = null;
  };
}
