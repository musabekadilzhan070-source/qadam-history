import crypto from 'node:crypto';
import { TYPES, CHOICE_TYPES, TYPE_LABELS, questionProblems, testProblems } from '../public/assets/js/question-rules.js';

export { TYPES, CHOICE_TYPES, TYPE_LABELS, questionProblems, testProblems };

// Question formats, shared by the cabinet (save, checks, preview), publishing and grading.
//
//   single, multiple, image   options[] with is_correct (image: the picture is the question)
//   matching                  data.pairs  [{ key, left, right }]   correct = each left with its right
//   ordering                  data.items  [{ key, text, date }]    correct = the stored order
//   open                      data.answers [string], data.ignore_case, data.ignore_spaces
//   context                   text = title, data.body, image_id; children = its questions (any type but context)

export const DEFAULT_SETTINGS = {
  question_limit: 0, // 0 = every question
  time_limit_min: 0, // 0 = no limit for the whole test
  question_time_sec: 0, // 0 = no limit per question
  pass_percent: 50,
  partial_credit: false,
  show_answers: true,
  shuffle_questions: false,
  shuffle_options: true,
};

const parse = (text, fallback) => {
  try {
    return JSON.parse(text) ?? fallback;
  } catch {
    return fallback;
  }
};

export const newKey = () => crypto.randomBytes(5).toString('hex');

export function settingsOf(raw) {
  const s = { ...DEFAULT_SETTINGS, ...(typeof raw === 'string' ? parse(raw, {}) : raw || {}) };
  const int = (v, min, max) => Math.max(min, Math.min(max, Math.round(Number(v) || 0)));
  return {
    question_limit: int(s.question_limit, 0, 500),
    time_limit_min: int(s.time_limit_min, 0, 600),
    question_time_sec: int(s.question_time_sec, 0, 3600),
    pass_percent: int(s.pass_percent, 0, 100),
    partial_credit: Boolean(s.partial_credit),
    show_answers: s.show_answers !== false,
    shuffle_questions: Boolean(s.shuffle_questions),
    shuffle_options: s.shuffle_options !== false,
  };
}

/** Type-specific data with defaults, cleaned of anything that does not belong to the type. */
export function dataOf(type, raw) {
  const d = typeof raw === 'string' ? parse(raw, {}) : raw || {};
  const s = (v, max) => String(v ?? '').slice(0, max);
  if (type === 'matching') {
    return { pairs: (Array.isArray(d.pairs) ? d.pairs : []).slice(0, 20).map((p) => ({ key: s(p?.key, 20) || newKey(), left: s(p?.left, 300), right: s(p?.right, 300) })) };
  }
  if (type === 'ordering') {
    return { items: (Array.isArray(d.items) ? d.items : []).slice(0, 20).map((i) => ({ key: s(i?.key, 20) || newKey(), text: s(i?.text, 300), date: s(i?.date, 60) })) };
  }
  if (type === 'open') {
    return {
      answers: (Array.isArray(d.answers) ? d.answers : []).map((a) => s(a, 200)).slice(0, 20),
      ignore_case: d.ignore_case !== false,
      ignore_spaces: d.ignore_spaces !== false,
    };
  }
  if (type === 'context') return { body: s(d.body, 20000) };
  return {};
}

/** Builds nested questions (context children inside their context) from table rows. */
export function assembleQuestions(questionRows, optionRows) {
  const byPos = (a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id - b.id;
  const opts = new Map();
  for (const o of [...optionRows].sort(byPos)) {
    if (!opts.has(o.question_id)) opts.set(o.question_id, []);
    opts.get(o.question_id).push({ id: o.id, text: o.text, image_id: o.image_id ?? null, is_correct: Boolean(o.is_correct) });
  }
  const make = (r) => {
    const type = TYPES.includes(r.type) ? r.type : 'single';
    return {
      id: r.id,
      type,
      text: r.text,
      explanation: r.explanation || '',
      image_id: r.image_id ?? null,
      points: Math.max(0, Number(r.points ?? 1)),
      options: CHOICE_TYPES.includes(type) ? opts.get(r.id) || [] : [],
      data: dataOf(type, r.data),
    };
  };
  const rows = [...questionRows].sort(byPos);
  const top = rows.filter((r) => !r.parent_id).map(make);
  for (const q of top) {
    if (q.type === 'context') q.children = rows.filter((r) => r.parent_id === q.id).map(make).filter((c) => c.type !== 'context');
  }
  return top;
}

/** Keeps only questions students can answer; contexts keep their ready children. */
export function readyQuestions(questions) {
  return questions
    .map((q) => (q.type === 'context' ? { ...q, children: (q.children || []).filter((c) => !questionProblems(c).length) } : q))
    .filter((q) => !questionProblems(q).length);
}

export const gradable = (questions) => questions.flatMap((q) => (q.type === 'context' ? q.children : [q]));

// ─── For students ─────────────────────────────────────────────────
function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** The parts of the test a student gets: question limit and shuffling applied (units = question or context). */
export function pickUnits(questions, settings) {
  let units = settings.shuffle_questions ? shuffle(questions) : [...questions];
  if (settings.question_limit) {
    const picked = [];
    let count = 0;
    for (const u of settings.shuffle_questions ? units : shuffle(units)) {
      const n = u.type === 'context' ? u.children.length : 1;
      if (count + n > settings.question_limit && count > 0) continue;
      picked.push(u);
      count += n;
      if (count >= settings.question_limit) break;
    }
    // Keep the organizer's order unless shuffling was asked for.
    const order = new Map(questions.map((q, i) => [q.id, i]));
    units = settings.shuffle_questions ? picked : picked.sort((a, b) => order.get(a.id) - order.get(b.id));
  }
  return units;
}

/** One question as a student sees it: no correct answers. */
export function forStudent(q, settings) {
  const base = { id: q.id, type: q.type, text: q.text, image_id: q.image_id, points: q.points };
  if (CHOICE_TYPES.includes(q.type)) {
    const opts = settings.shuffle_options ? shuffle(q.options) : q.options;
    return {
      ...base,
      multiple: q.type === 'multiple' || q.options.filter((o) => o.is_correct).length > 1,
      options: opts.map((o) => ({ id: o.id, text: o.text, image_id: o.image_id })),
    };
  }
  if (q.type === 'matching') {
    return {
      ...base,
      left: q.data.pairs.map((p) => ({ key: p.key, text: p.left })),
      right: shuffle(q.data.pairs).map((p) => ({ key: p.key, text: p.right })),
    };
  }
  if (q.type === 'ordering') {
    let items = shuffle(q.data.items);
    // Never hand out the answer already in order.
    for (let n = 0; n < 5 && items.every((it, i) => it.key === q.data.items[i].key); n += 1) items = shuffle(q.data.items);
    return { ...base, items: items.map((i) => ({ key: i.key, text: i.text })) };
  }
  if (q.type === 'open') return base;
  if (q.type === 'context') {
    return { id: q.id, type: 'context', title: q.text, body: q.data.body, image_id: q.image_id, children: q.children.map((c) => forStudent(c, settings)) };
  }
  return base;
}

// ─── Grading ──────────────────────────────────────────────────────
export function normalizeOpen(value, data) {
  let s = String(value ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').replace(/[.!]+$/, '');
  if (data.ignore_spaces) s = s.replace(/\s+/g, '');
  if (data.ignore_case) s = s.toLocaleLowerCase('kk');
  return s;
}

/** Cleans a raw answer into the stored form for the question's type. */
export function cleanAnswer(q, raw) {
  if (CHOICE_TYPES.includes(q.type)) {
    return [...new Set([].concat(raw ?? []).map(Number))].filter((id) => q.options.some((o) => o.id === id)).sort((a, b) => a - b);
  }
  if (q.type === 'matching') {
    const keys = new Set(q.data.pairs.map((p) => p.key));
    const out = {};
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [l, r] of Object.entries(raw)) if (keys.has(l) && keys.has(String(r))) out[l] = String(r);
    }
    return out;
  }
  if (q.type === 'ordering') {
    const keys = q.data.items.map((i) => i.key);
    const list = Array.isArray(raw) ? raw.map(String).filter((k) => keys.includes(k)) : [];
    return new Set(list).size === keys.length ? list : [];
  }
  if (q.type === 'open') return String(raw ?? '').slice(0, 300);
  return null;
}

const isEmpty = (q, a) =>
  q.type === 'open' ? !String(a).trim() : Array.isArray(a) ? a.length === 0 : !a || Object.keys(a).length === 0;

/** Share of the question earned, 0..1. */
function share(q, a, settings) {
  if (isEmpty(q, a)) return 0;
  if (CHOICE_TYPES.includes(q.type)) {
    const right = q.options.filter((o) => o.is_correct).map((o) => o.id);
    const hit = a.filter((id) => right.includes(id)).length;
    const miss = a.length - hit;
    if (hit === right.length && miss === 0) return 1;
    return settings.partial_credit && right.length > 1 ? Math.max(0, (hit - miss) / right.length) : 0;
  }
  if (q.type === 'matching') {
    const ok = q.data.pairs.filter((p) => a[p.key] === p.key).length;
    if (ok === q.data.pairs.length) return 1;
    return settings.partial_credit ? ok / q.data.pairs.length : 0;
  }
  if (q.type === 'ordering') {
    const ok = q.data.items.filter((it, i) => a[i] === it.key).length;
    if (ok === q.data.items.length) return 1;
    return settings.partial_credit ? ok / q.data.items.length : 0;
  }
  if (q.type === 'open') {
    const given = normalizeOpen(a, q.data);
    return q.data.answers.some((ans) => ans.trim() && normalizeOpen(ans, q.data) === given) ? 1 : 0;
  }
  return 0;
}

/** Review entry for one answered (or skipped) question. */
export function reviewItem(q, answer, settings, context = null) {
  const a = answer ?? cleanAnswer(q, null);
  const part = share(q, a, settings);
  const earned = Math.round(part * q.points * 100) / 100;
  const item = {
    id: q.id,
    type: q.type,
    text: q.text,
    image_id: q.image_id,
    explanation: q.explanation,
    points: q.points,
    earned,
    is_correct: part === 1,
    answered: !isEmpty(q, a),
    context: context && { id: context.id, title: context.text, body: context.data.body, image_id: context.image_id },
  };
  if (CHOICE_TYPES.includes(q.type)) {
    Object.assign(item, {
      multiple: q.type === 'multiple' || q.options.filter((o) => o.is_correct).length > 1,
      options: q.options.map((o) => ({ id: o.id, text: o.text, image_id: o.image_id })),
      chosen_option_ids: a,
      correct_option_ids: q.options.filter((o) => o.is_correct).map((o) => o.id),
    });
  } else if (q.type === 'matching') {
    const rightOf = new Map(q.data.pairs.map((p) => [p.key, p.right]));
    item.pairs = q.data.pairs.map((p) => ({ left: p.left, right: p.right, chosen: a[p.key] ? rightOf.get(a[p.key]) : null, ok: a[p.key] === p.key }));
  } else if (q.type === 'ordering') {
    const byKey = new Map(q.data.items.map((i) => [i.key, i]));
    item.correct_order = q.data.items.map((i) => ({ text: i.text, date: i.date }));
    item.chosen_order = a.map((k) => ({ text: byKey.get(k).text, date: byKey.get(k).date }));
  } else if (q.type === 'open') {
    item.answer = a;
    item.accepted = q.data.answers.filter((x) => x.trim());
  }
  if (!settings.show_answers) {
    // The organizer chose to hide correct answers: only the verdict is shown.
    delete item.correct_option_ids;
    delete item.accepted;
    delete item.correct_order;
    if (item.pairs) item.pairs = item.pairs.map(({ left, chosen, ok }) => ({ left, chosen, ok }));
    item.explanation = '';
    item.answers_hidden = true;
  }
  return item;
}

/** Grades the served questions. Returns totals and review items (context children carry their context). */
export function grade(test, servedIds, answers, settings) {
  const items = [];
  const stored = [];
  const served = new Set(servedIds);
  for (const q of test.questions) {
    const list = q.type === 'context' ? q.children.map((c) => [c, q]) : [[q, null]];
    for (const [question, ctx] of list) {
      if (!served.has(question.id)) continue;
      const raw = answers?.[question.id] ?? answers?.[String(question.id)];
      const a = cleanAnswer(question, raw);
      items.push(reviewItem(question, a, settings, ctx));
      stored.push({ question, answer: a });
    }
  }
  const score = Math.round(items.reduce((s, i) => s + i.earned, 0) * 100) / 100;
  const max = items.reduce((s, i) => s + i.points, 0);
  return {
    items,
    stored,
    correct: items.filter((i) => i.is_correct).length,
    total: items.length,
    score,
    max_score: max,
    percent: max ? Math.round((score / max) * 100) : 0,
  };
}
