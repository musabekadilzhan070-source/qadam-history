import { esc } from './util.js';
import { fileUrl } from './site.js';

// Answering widgets for every question format. Used by the student test page and by the
// organizer's «Оқушы ретінде қарау» preview, so both behave the same.
//
// A test is a list of units: a single question, or a context with its own questions.
// Answers are kept by question id:
//   single/image  [optionId]          multiple  [optionId, …]
//   matching      { leftKey: rightKey }
//   ordering      [itemKey, …] (the order on screen)
//   open          'text'

const LETTERS = ['А', 'Ә', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З', 'И'];
export const letter = (i) => LETTERS[i] || String(i + 1);

export const unitQuestions = (unit) => (unit.type === 'context' ? unit.children : [unit]);

/** Starting answers: an ordering question starts in the order it was handed out. */
export function initialAnswers(units) {
  const answers = {};
  for (const u of units) for (const q of unitQuestions(u)) if (q.type === 'ordering') answers[q.id] = q.items.map((i) => i.key);
  return answers;
}

/** Whether the student did something with the question (an untouched ordering does not count). */
export function isAnswered(q, answers, touched) {
  const a = answers[q.id];
  if (q.type === 'ordering') return touched.has(q.id);
  if (q.type === 'open') return Boolean(String(a || '').trim());
  if (q.type === 'matching') return Boolean(a && Object.values(a).some(Boolean));
  return Array.isArray(a) && a.length > 0;
}

const TYPE_HINT = {
  multiple: 'Бірнеше дұрыс жауап бар: барлығын белгілеңіз.',
  matching: 'Сол жақтағы әр элементке оң жақтан сәйкесін таңдаңыз.',
  ordering: 'Оқиғаларды «Жоғары» / «Төмен» батырмаларымен дұрыс ретке қойыңыз (ең ертесі жоғарыда).',
  open: 'Жауапты өзіңіз жазыңыз.',
};

function choiceHtml(q, answers) {
  const chosen = answers[q.id] || [];
  const multi = q.multiple;
  return `
    <fieldset class="options" aria-label="Жауап нұсқалары">
      ${q.options
        .map(
          (o, i) => `<label class="option${multi ? ' option-multi' : ''}">
            <input type="${multi ? 'checkbox' : 'radio'}" name="q${q.id}" value="${o.id}" data-q="${q.id}" ${chosen.includes(o.id) ? 'checked' : ''} />
            <span class="letter">${letter(i)}</span>${o.image_id ? `<img class="option-image" src="${fileUrl(o.image_id)}" alt="" />` : ''}<span>${esc(o.text)}</span></label>`,
        )
        .join('')}
    </fieldset>`;
}

function matchingHtml(q, answers) {
  const a = answers[q.id] || {};
  return `
    <div class="match-list">
      ${q.left
        .map(
          (l, i) => `<div class="match-row">
            <span class="match-left"><b>${i + 1}</b>${esc(l.text)}</span>
            <select class="match-select" data-q="${q.id}" data-left="${esc(l.key)}" aria-label="${esc(l.text)}: сәйкесін таңдаңыз">
              <option value="">Таңдаңыз…</option>
              ${q.right.map((r, ri) => `<option value="${esc(r.key)}" ${a[l.key] === r.key ? 'selected' : ''}>${letter(ri)}. ${esc(r.text)}</option>`).join('')}
            </select>
          </div>`,
        )
        .join('')}
    </div>`;
}

function orderingHtml(q, answers) {
  const byKey = new Map(q.items.map((i) => [i.key, i]));
  const order = answers[q.id] || q.items.map((i) => i.key);
  return `
    <ol class="order-list" data-q="${q.id}">
      ${order
        .map(
          (k, i) => `<li class="order-item" data-key="${esc(k)}">
            <span class="order-num">${i + 1}</span>
            <span class="order-text">${esc(byKey.get(k)?.text || '')}</span>
            <span class="order-btns">
              <button type="button" class="order-btn" data-move="-1" ${i === 0 ? 'disabled' : ''} aria-label="Жоғары жылжыту">▲</button>
              <button type="button" class="order-btn" data-move="1" ${i === order.length - 1 ? 'disabled' : ''} aria-label="Төмен жылжыту">▼</button>
            </span>
          </li>`,
        )
        .join('')}
    </ol>`;
}

function openHtml(q, answers) {
  return `<input class="open-input" type="text" data-q="${q.id}" value="${esc(answers[q.id] || '')}" maxlength="300" placeholder="Жауабыңызды жазыңыз" autocomplete="off" />`;
}

function questionHtml(q, answers, number) {
  const body =
    q.type === 'matching' ? matchingHtml(q, answers) : q.type === 'ordering' ? orderingHtml(q, answers) : q.type === 'open' ? openHtml(q, answers) : choiceHtml(q, answers);
  const hint = q.type === 'multiple' || q.multiple ? TYPE_HINT.multiple : TYPE_HINT[q.type] || '';
  return `
    <div class="q-block" data-qid="${q.id}">
      <p class="q-num">${number}${q.points !== 1 ? ` · ${q.points} ұпай` : ''}</p>
      <h2 class="q-text">${esc(q.text)}</h2>
      ${q.image_id ? `<img class="q-image" src="${fileUrl(q.image_id)}" alt="Сұрақтың суреті" />` : ''}
      ${hint ? `<p class="q-hint">${hint}</p>` : ''}
      ${body}
    </div>`;
}

/** One page of the test. `first` is the number of the unit's first question. */
export function unitHtml(unit, answers, first, total) {
  if (unit.type !== 'context') return questionHtml(unit, answers, `Сұрақ ${first} / ${total}`);
  return `
    <section class="context-box">
      <p class="eyebrow">Контекст</p>
      ${unit.title ? `<h2>${esc(unit.title)}</h2>` : ''}
      ${unit.image_id ? `<img class="q-image" src="${fileUrl(unit.image_id)}" alt="Контекст суреті" />` : ''}
      ${unit.body ? `<div class="context-text">${esc(unit.body).replace(/\n/g, '<br />')}</div>` : ''}
    </section>
    ${unit.children.map((c, i) => questionHtml(c, answers, `Сұрақ ${first + i} / ${total}`)).join('')}`;
}

/** Wires the widgets inside `root` for the given unit; onChange(questionId) after each answer. */
export function bindUnit(root, unit, answers, touched, onChange) {
  const byId = new Map(unitQuestions(unit).map((q) => [q.id, q]));
  root.addEventListener('change', (e) => {
    const t = e.target;
    const q = byId.get(Number(t.dataset.q));
    if (!q) return;
    if (t.matches('.option input')) {
      answers[q.id] = [...root.querySelectorAll(`input[name="q${q.id}"]:checked`)].map((i) => Number(i.value));
    } else if (t.matches('.match-select')) {
      answers[q.id] = { ...(answers[q.id] || {}), [t.dataset.left]: t.value };
      if (!t.value) delete answers[q.id][t.dataset.left];
    }
    onChange(q.id);
  });
  root.addEventListener('input', (e) => {
    const t = e.target;
    if (!t.matches('.open-input')) return;
    answers[Number(t.dataset.q)] = t.value;
    onChange(Number(t.dataset.q));
  });
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('.order-btn');
    if (!btn) return;
    const list = btn.closest('.order-list');
    const q = byId.get(Number(list.dataset.q));
    const order = [...(answers[q.id] || q.items.map((i) => i.key))];
    const i = order.indexOf(btn.closest('.order-item').dataset.key);
    const j = i + Number(btn.dataset.move);
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    answers[q.id] = order;
    touched.add(q.id);
    list.outerHTML = orderingHtml(q, answers);
    root.querySelector(`.order-list[data-q="${q.id}"] .order-item[data-key="${CSS.escape(order[j])}"] .order-btn[data-move="${btn.dataset.move}"]`)?.focus();
    onChange(q.id);
  });
}
