import { TYPES, CHOICE_TYPES, TYPE_LABELS, questionProblems } from './questions.js';
import { writeXlsx, writeCsv } from './sheets.js';

// Question import and export as a table (Excel .xlsx or CSV). One row per question; a context block is
// its own row, and its questions point at it in the «Контекст» column. The same layout is read back,
// so an exported file can be edited and imported again.
//
//   choice (single, multiple, image)  Нұсқа N = answer text, «[сурет:ID]» in front adds an option picture;
//                                     Дұрыс жауап = numbers or letters of the right options: «1, 3» or «А, Б»
//   matching                          Нұсқа N = «Сол жақ = Оң жақ»
//   ordering                          Нұсқа N = «Оқиға | дата», in the right order
//   open                              Нұсқа N = every accepted answer; «Қатаң тексеру»: «регистр», «бос орын»
//   context                           ID = a label (К1), «Сұрақ мәтіні» = title, «Контекст мәтіні» = the text

export const MIN_OPTIONS = 8;
export const MAX_OPTIONS = 10;
export const MAX_ROWS = 500;

const LETTERS = ['А', 'Ә', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З', 'И'];
const LATIN = 'ABCDEFGHIJ';

const COLUMNS = [
  ['id', 'ID'],
  ['type', 'Түрі'],
  ['context', 'Контекст'],
  ['text', 'Сұрақ мәтіні'],
  ['body', 'Контекст мәтіні'],
  // options go here
  ['correct', 'Дұрыс жауап'],
  ['points', 'Ұпай'],
  ['explanation', 'Түсініктеме'],
  ['image', 'Сурет'],
  ['strict', 'Қатаң тексеру'],
];

const header = (optionCount) => [
  ...COLUMNS.slice(0, 5).map(([, h]) => h),
  ...Array.from({ length: optionCount }, (_, i) => `Нұсқа ${i + 1}`),
  ...COLUMNS.slice(5).map(([, h]) => h),
];

const imageRef = (id) => (id ? String(id) : '');
const num = (n) => String(Math.round(Number(n) * 100) / 100);

/** A test's questions as table rows (header first). */
export function questionsToRows(questions) {
  let width = MIN_OPTIONS;
  const each = (fn) => questions.forEach((q) => (q.type === 'context' ? [q, ...(q.children || [])] : [q]).forEach(fn));
  each((q) => {
    const n = CHOICE_TYPES.includes(q.type) ? q.options.length : (q.data.pairs || q.data.items || q.data.answers || []).length;
    width = Math.max(width, Math.min(MAX_OPTIONS, n));
  });
  const rows = [header(width)];
  let n = 0;
  let k = 0;
  const row = (q, contextLabel) => {
    let cells = [];
    let correct = '';
    if (CHOICE_TYPES.includes(q.type)) {
      cells = q.options.map((o) => `${o.image_id ? `[сурет:${o.image_id}] ` : ''}${o.text}`);
      correct = q.options.map((o, i) => (o.is_correct ? i + 1 : 0)).filter(Boolean).join(', ');
    } else if (q.type === 'matching') cells = q.data.pairs.map((p) => `${p.left} = ${p.right}`);
    else if (q.type === 'ordering') cells = q.data.items.map((i) => (i.date ? `${i.text} | ${i.date}` : i.text));
    else if (q.type === 'open') cells = q.data.answers;
    const strict = q.type === 'open' ? [q.data.ignore_case ? '' : 'регистр', q.data.ignore_spaces ? '' : 'бос орын'].filter(Boolean).join(', ') : '';
    const label = q.type === 'context' ? `К${++k}` : String(++n);
    const out = [
      label,
      TYPE_LABELS[q.type],
      contextLabel,
      q.text,
      q.type === 'context' ? q.data.body : '',
      ...Array.from({ length: width }, (_, i) => cells[i] ?? ''),
      correct,
      q.type === 'context' ? '' : num(q.points),
      q.explanation || '',
      imageRef(q.image_id),
      strict,
    ];
    rows.push(out);
    return label;
  };
  for (const q of questions) {
    const label = row(q, '');
    if (q.type === 'context') for (const c of q.children || []) row(c, label);
  }
  return rows;
}

const widths = (optionCount) => [6, 22, 10, 50, 40, ...Array(optionCount).fill(24), 12, 7, 36, 10, 14];

export function exportFile(questions, format, title) {
  const rows = questionsToRows(questions);
  if (format === 'csv') return writeCsv(rows);
  return writeXlsx([{ name: (title || 'Сұрақтар').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Сұрақтар', rows, widths: widths(rows[0].length - 10) }, guideSheet()]);
}

// ─── Template ─────────────────────────────────────────────────────
const SAMPLE = [
  { type: 'single', text: 'Қазақ хандығы қай жылы құрылды?', options: ['1465', '1456', '1511', '1723'], correct: '1', explanation: 'Керей мен Жәнібек 1465 жылы хандық құрды.' },
  { type: 'multiple', text: 'Алаш қозғалысының көшбасшыларын таңдаңыз.', options: ['Әлихан Бөкейхан', 'Ахмет Байтұрсынұлы', 'Абылай хан', 'Міржақып Дулатұлы'], correct: '1, 2, 4', points: 2 },
  { type: 'matching', text: 'Тұлғаны оқиғамен сәйкестендіріңіз.', options: ['Абылай хан = Аңырақай шайқасы', 'Кенесары = 1837–1847 жылдардағы көтеріліс', 'Әлихан Бөкейхан = Алаш автономиясы'], points: 3 },
  { type: 'ordering', text: 'Оқиғаларды хронологиялық ретпен орналастырыңыз.', options: ['Қазақ хандығының құрылуы | 1465', 'Аңырақай шайқасы | 1729', 'Алаш автономиясы | 1917', 'Тәуелсіздік | 1991'], points: 2 },
  { type: 'open', text: 'Қазақстан тәуелсіздігін қай жылы жариялады?', options: ['1991', '1991 жыл'], explanation: 'Бірнеше дұрыс жауапты әр нұсқаға жазуға болады.' },
  { id: 'К1', type: 'context', text: 'Тарихи құжат', body: 'Құжат мәтіні осында жазылады. Төмендегі сұрақтар осы мәтінге сүйенеді.' },
  { context: 'К1', type: 'single', text: 'Құжатта қай кезең сипатталған?', options: ['XV ғасыр', 'XVIII ғасыр', 'XX ғасыр'], correct: '2' },
  { context: 'К1', type: 'open', text: 'Құжатта аталған қаланы жазыңыз.', options: ['Түркістан'] },
];

export function templateFile() {
  let n = 0;
  const rows = [
    header(MIN_OPTIONS),
    ...SAMPLE.map((s) => [
      s.id || String(++n),
      TYPE_LABELS[s.type],
      s.context || '',
      s.text,
      s.body || '',
      ...Array.from({ length: MIN_OPTIONS }, (_, i) => s.options?.[i] ?? ''),
      s.correct || '',
      s.type === 'context' ? '' : String(s.points ?? 1),
      s.explanation || '',
      s.image || '',
      '',
    ]),
  ];
  return writeXlsx([{ name: 'Сұрақтар', rows, widths: widths(MIN_OPTIONS) }, guideSheet()]);
}

function guideSheet() {
  const rows = [
    ['Баған', 'Не жазылады'],
    ['ID', 'Кез келген белгі. Контекст жолында міндетті (мысалы, К1): контекст сұрақтары осы белгіге сілтейді.'],
    ['Түрі', Object.values(TYPE_LABELS).join('; ') + '. Ағылшынша кілт те жарайды: ' + TYPES.join(', ') + '.'],
    ['Контекст', 'Сұрақ контекст блогына жатса, сол контекстің ID белгісі (мысалы, К1).'],
    ['Сұрақ мәтіні', 'Сұрақтың өзі. Контекст жолында — блок атауы.'],
    ['Контекст мәтіні', 'Тек контекст жолында: мәтін немесе құжат.'],
    ['Нұсқа 1…10', 'Таңдау сұрағында — жауап нұсқалары. Нұсқа суреті: «[сурет:ID] мәтін». Сәйкестендіруде — «Сол жақ = Оң жақ». Реттілікте — «Оқиға | дата», дұрыс ретпен. Ашық жауапта — қабылданатын жауаптар.'],
    ['Дұрыс жауап', 'Таңдау сұрағында дұрыс нұсқалардың нөмірі немесе әрпі: «1» немесе «1, 3» немесе «А, Б». Басқа түрлерде бос қалады.'],
    ['Ұпай', '0-ден 100-ге дейінгі сан. Бос болса — 1.'],
    ['Түсініктеме', 'Нәтиже бетінде көрсетілетін түсіндірме (міндетті емес).'],
    ['Сурет', 'Кабинеттегі «Суреттер» бөліміндегі суреттің ID нөмірі немесе /api/files/ID сілтемесі. «Суретпен берілетін сұрақ» түрінде міндетті: мысалы, Түрі = «Суретпен берілетін сұрақ», Сурет = 12, Нұсқа 1 = Түркістан, Нұсқа 2 = Тараз, Дұрыс жауап = 1.'],
    ['Қатаң тексеру', 'Тек ашық жауапта: «регистр» — бас/кіші әріп ескеріледі, «бос орын» — бос орындар ескеріледі. Бос болса — ескерілмейді.'],
    ['', ''],
    ['Шектеулер', ''],
    ['Сурет', 'Суреттің өзі файлға кірмейді: тек оның ID нөмірі. Басқа сайттан немесе компьютерден сурет қосу үшін алдымен оны кабинетке жүктеңіз.'],
    ['Пішім', 'Excel формулалары, түстер, біріктірілген ұяшықтар және бірінші беттен басқа беттер оқылмайды. Ескі .xls форматы қолданылмайды.'],
    ['Көлем', `Бір файлда ең көбі ${MAX_ROWS} жол, бір тестте ең көбі 200 сұрақ, бір сұрақта ең көбі ${MAX_OPTIONS} нұсқа.`],
    ['CSV', 'CSV файлын «CSV UTF-8» ретінде сақтаңыз: үтір мен нүктелі үтір екеуі де танылады.'],
  ];
  return { name: 'Нұсқаулық', rows, widths: [18, 110] };
}

// ─── Reading ──────────────────────────────────────────────────────
const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

const HEADER_ALIASES = {
  id: ['id', 'ид', '№', 'нөмір'],
  type: ['түрі', 'тип', 'type', 'сұрақ түрі'],
  context: ['контекст', 'context', 'контекст id'],
  text: ['сұрақ мәтіні', 'сұрақ', 'question', 'text', 'мәтін'],
  body: ['контекст мәтіні', 'context text', 'body'],
  correct: ['дұрыс жауап', 'дұрыс', 'correct', 'answer', 'жауап'],
  points: ['ұпай', 'points', 'балл'],
  explanation: ['түсініктеме', 'explanation', 'түсіндірме'],
  image: ['сурет', 'image', 'сурет id'],
  strict: ['қатаң тексеру', 'strict'],
};

const TYPE_ALIASES = {
  single: ['single', 'бір дұрыс жауап', 'бір жауап', 'бір'],
  multiple: ['multiple', 'бірнеше дұрыс жауап', 'бірнеше жауап', 'бірнеше'],
  image: ['image', 'суретпен берілетін сұрақ', 'суретті сұрақ', 'сурет'],
  matching: ['matching', 'сәйкестендіру', 'сәйкестік'],
  ordering: ['ordering', 'хронологиялық реттілік', 'реттілік', 'хронология'],
  open: ['open', 'ашық жауап', 'ашық'],
  context: ['context', 'контекст', 'контекст блогы'],
};
const typeOf = (v) => Object.entries(TYPE_ALIASES).find(([, list]) => list.includes(norm(v)))?.[0];

function mapHeader(row) {
  const map = { options: [] };
  row.forEach((cell, i) => {
    const h = norm(cell);
    if (!h) return;
    const opt = /^(?:нұсқа|вариант|option)\s*(\d+)$/.exec(h);
    if (opt) {
      map.options[Number(opt[1]) - 1] = i;
      return;
    }
    const key = Object.entries(HEADER_ALIASES).find(([, list]) => list.includes(h))?.[0];
    if (key && map[key] === undefined) map[key] = i;
  });
  map.options = map.options.filter((i) => i !== undefined);
  return map;
}

/** A picture reference: a number, «/api/files/12» or a full link to it. */
const fileIdOf = (v) => {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const m = /^(\d+)$/.exec(s) || /\/api\/files\/(\d+)/.exec(s);
  return m ? Number(m[1]) : NaN;
};

/** Numbers or letters of the right options. */
function correctIndexes(v, count) {
  const parts = String(v ?? '')
    .split(/[,;\s]+/)
    .map((p) => p.trim().replace(/[.)]$/, ''))
    .filter(Boolean);
  const out = [];
  for (const p of parts) {
    let i = /^\d+$/.test(p) ? Number(p) - 1 : LETTERS.indexOf(p.toUpperCase());
    if (i < 0 && /^[a-j]$/i.test(p)) i = LATIN.indexOf(p.toUpperCase());
    if (i < 0 || i >= count) return { bad: p };
    if (!out.includes(i)) out.push(i);
  }
  return { list: out };
}

const textKey = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Comparison key of a question for duplicate checks: its type and text without punctuation or case. */
export const duplicateKey = (q) => `${q.type}:${textKey(q.text)}`;

/**
 * Table rows → questions in the cabinet model (see questions.js), with every problem listed by row number.
 * Returns { questions, errors: [{ row, message }], warnings: [string], rows: [{ row, index }] }.
 * A question with an error is left out; the rest can still be imported.
 */
export function rowsToQuestions(rows) {
  const errors = [];
  const warnings = [];
  const headerAt = rows.findIndex((r) => r.some((c) => String(c ?? '').trim()));
  if (headerAt < 0) return { questions: [], errors: [{ row: 1, message: 'Файл бос.' }], warnings };
  const map = mapHeader(rows[headerAt]);
  const missing = [];
  if (map.type === undefined) missing.push('Түрі');
  if (map.text === undefined) missing.push('Сұрақ мәтіні');
  if (!map.options.length) missing.push('Нұсқа 1');
  if (missing.length) {
    return {
      questions: [],
      errors: [{ row: headerAt + 1, message: `Тақырып жолында міндетті баған жоқ: ${missing.join(', ')}. Үлгі файлды жүктеп алып, сол бағандарды қолданыңыз.` }],
      warnings,
    };
  }
  const cell = (r, key) => (map[key] === undefined ? '' : String(r[map[key]] ?? '').trim());
  const body = rows.slice(headerAt + 1);
  if (body.length > MAX_ROWS) warnings.push(`Файлда ${body.length} жол бар: тек алғашқы ${MAX_ROWS} жол оқылды.`);

  const contexts = new Map();
  const top = [];
  const pendingChildren = [];
  const images = new Set();

  body.slice(0, MAX_ROWS).forEach((r, i) => {
    const rowNo = headerAt + i + 2;
    if (!r.some((c) => String(c ?? '').trim())) return;
    const bad = (message) => errors.push({ row: rowNo, message });
    const rawType = cell(r, 'type');
    const type = rawType ? typeOf(rawType) : 'single';
    if (!type) return bad(`«${rawType}» деген сұрақ түрі белгісіз. Мүмкін мәндер: ${Object.values(TYPE_LABELS).join(', ')}.`);
    const text = cell(r, 'text');
    if (text.length > (type === 'context' ? 300 : 2000)) return bad('Сұрақ мәтіні тым ұзын.');
    const cells = map.options.map((ci) => String(r[ci] ?? '').trim());
    while (cells.length && !cells[cells.length - 1]) cells.pop();
    if (cells.length > MAX_OPTIONS) return bad(`Нұсқа тым көп: ең көбі ${MAX_OPTIONS}.`);
    if (cells.some((c) => c.length > 500)) return bad('Нұсқа мәтіні тым ұзын (ең көбі 500 таңба).');

    const pointsRaw = cell(r, 'points').replace(',', '.');
    let points = 1;
    if (pointsRaw) {
      points = Number(pointsRaw);
      if (!Number.isFinite(points) || points < 0 || points > 100) return bad(`«Ұпай» бағанында 0–100 аралығындағы сан болуы керек («${pointsRaw}»).`);
      points = Math.round(points);
    }
    const imageId = fileIdOf(cell(r, 'image'));
    if (Number.isNaN(imageId)) return bad(`«Сурет» бағанында суреттің ID нөмірі болуы керек («${cell(r, 'image')}»).`);
    if (imageId) images.add(imageId);

    const q = { type, text, explanation: cell(r, 'explanation').slice(0, 2000), image_id: imageId, points, options: [], data: {}, row: rowNo };

    if (CHOICE_TYPES.includes(type)) {
      const filled = cells.filter(Boolean);
      if (filled.length < cells.length) return bad('Нұсқалардың арасында бос ұяшық бар.');
      q.options = filled.map((c) => {
        const m = /^\[сурет:\s*(\d+)\]\s*/i.exec(c);
        if (m) images.add(Number(m[1]));
        return { text: m ? c.slice(m[0].length) : c, image_id: m ? Number(m[1]) : null, is_correct: false };
      });
      const { list, bad: wrong } = correctIndexes(cell(r, 'correct'), q.options.length);
      if (wrong) return bad(`«Дұрыс жауап» бағанындағы «${wrong}» ешбір нұсқаға сәйкес келмейді.`);
      list.forEach((ci) => {
        q.options[ci].is_correct = true;
      });
    } else if (type === 'matching') {
      const pairs = [];
      for (const c of cells.filter(Boolean)) {
        const at = c.indexOf('=');
        if (at < 0) return bad(`Сәйкестендіру нұсқасы «Сол жақ = Оң жақ» түрінде жазылуы керек («${c}»).`);
        pairs.push({ left: c.slice(0, at).trim(), right: c.slice(at + 1).trim() });
      }
      q.data = { pairs };
    } else if (type === 'ordering') {
      q.data = {
        items: cells.filter(Boolean).map((c) => {
          const at = c.lastIndexOf('|');
          return at < 0 ? { text: c, date: '' } : { text: c.slice(0, at).trim(), date: c.slice(at + 1).trim().slice(0, 60) };
        }),
      };
    } else if (type === 'open') {
      const strict = norm(cell(r, 'strict'));
      q.data = { answers: cells.filter(Boolean).map((a) => a.slice(0, 200)), ignore_case: !strict.includes('регистр'), ignore_spaces: !strict.includes('бос') };
    } else if (type === 'context') {
      q.points = 0;
      q.data = { body: cell(r, 'body').slice(0, 20000) };
      q.children = [];
      const label = cell(r, 'id');
      if (!label) return bad('Контекст жолында «ID» бағаны толтырылуы керек (мысалы, К1): сұрақтар осы белгіге сілтейді.');
      if (contexts.has(norm(label))) return bad(`«${label}» контекст белгісі қайталанады.`);
      contexts.set(norm(label), q);
    }
    if (type !== 'context' && CHOICE_TYPES.includes(type) === false && cell(r, 'correct')) {
      warnings.push(`${rowNo}-жол: «${TYPE_LABELS[type]}» түрінде «Дұрыс жауап» бағаны ескерілмейді.`);
    }
    const problems = questionProblems(type === 'context' ? { ...q, children: [{}] } : q);
    if (problems.length) return bad(`${problems.join('; ').replace(/^./, (c) => c.toUpperCase())}.`);

    const parent = cell(r, 'context');
    if (parent && type !== 'context') pendingChildren.push({ q, parent, rowNo });
    else top.push(q);
  });

  for (const { q, parent, rowNo } of pendingChildren) {
    const ctx = contexts.get(norm(parent));
    if (!ctx) {
      errors.push({ row: rowNo, message: `«${parent}» деген контекст файлда табылмады.` });
      continue;
    }
    if (ctx.children.length >= 40) {
      errors.push({ row: rowNo, message: 'Бір контекстке ең көбі 40 сұрақ.' });
      continue;
    }
    ctx.children.push(q);
  }
  const questions = top.filter((q) => {
    if (q.type === 'context' && !q.children.length) {
      errors.push({ row: q.row, message: 'Контекстке бірде-бір дұрыс сұрақ байланыспаған: контекст сұрақтарының «Контекст» бағанына осы белгіні жазыңыз.' });
      return false;
    }
    return true;
  });
  errors.sort((a, b) => a.row - b.row);
  return { questions, errors, warnings, images: [...images] };
}

/** Drops unknown pictures from parsed questions, with a warning per row. */
export function dropMissingImages(questions, known, warnings) {
  const walk = (q) => {
    if (q.image_id && !known.has(q.image_id)) {
      warnings.push(`${q.row}-жол: ${q.image_id} нөмірлі сурет табылмады, сұрақ суретсіз қосылады.`);
      q.image_id = null;
    }
    for (const o of q.options) {
      if (o.image_id && !known.has(o.image_id)) {
        warnings.push(`${q.row}-жол: нұсқадағы ${o.image_id} нөмірлі сурет табылмады, нұсқа суретсіз қосылады.`);
        o.image_id = null;
      }
    }
    (q.children || []).forEach(walk);
  };
  questions.forEach(walk);
}
