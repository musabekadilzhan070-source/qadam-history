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
    ['Түрі (Сұрақ түрі)', 'Негізгі түрлер: Біржауапты (Викторина — біржауапты), Көпжауапты (Викторина — көпжауапты), Сәйкестендіру, Хронологиялық реттілік. Қосымша: ' + ['image', 'open', 'context'].map((t) => TYPE_LABELS[t]).join(', ') + '. Ағылшынша кілт те жарайды: ' + TYPES.join(', ') + '.'],
    ['Контекст', 'Сұрақ контекст блогына жатса, сол контекстің ID белгісі (мысалы, К1).'],
    ['Сұрақ мәтіні', 'Сұрақтың өзі. Контекст жолында — блок атауы.'],
    ['Контекст мәтіні', 'Тек контекст жолында: мәтін немесе құжат.'],
    ['Нұсқа 1…10', 'Таңдау сұрағында — жауап нұсқалары. Нұсқа суреті: «[сурет:ID] мәтін». Сәйкестендіруде — «Сол жақ = Оң жақ» немесе «Сол жақ — Оң жақ». Реттілікте — «Оқиға | дата» немесе «Оқиға — дата», дұрыс ретпен. Ашық жауапта — қабылданатын жауаптар.'],
    ['Жауаптар', '«Нұсқа N» бағандарының орнына барлық жауапты бір ұяшыққа «;» арқылы жазуға болады: «1456; 1465; 1470». Сәйкестендіруде: «Керей — 1465–1473; Қасым — 1511–1521». Реттілікте: «Оқиға — дата; Оқиға — дата» (кез келген ретпен, егер «Дұрыс жауап» толтырылса).'],
    ['Дұрыс жауап', 'Викторинада дұрыс жауаптың мәтіні («1465», көпжауаптыда «Керей; Жәнібек») немесе нөмірі/әрпі («1», «1, 3», «А, Б»). Сәйкестендіруде дұрыс жұптар «Сол — Оң; …» (міндетті емес, «Жауаптар» жұп болса). Реттілікте элементтердің дұрыс реті; бос болса, «Жауаптар» ретінің өзі дұрыс деп саналады.'],
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
  type: ['түрі', 'тип', 'type', 'сұрақ түрі', 'тапсырма түрі'],
  context: ['контекст', 'context', 'контекст id'],
  text: ['сұрақ мәтіні', 'сұрақ', 'question', 'text', 'мәтін', 'тапсырма'],
  body: ['контекст мәтіні', 'context text', 'body'],
  // One cell with every answer, option, pair or event, separated by «;» or new lines.
  answers: ['жауаптар', 'жауап нұсқалары', 'нұсқалар', 'элементтер', 'answers', 'options'],
  correct: ['дұрыс жауап', 'дұрыс жауаптар', 'дұрыс', 'дұрыс жұптар', 'дұрыс реттілік', 'дұрыс рет', 'correct', 'answer', 'жауап'],
  points: ['ұпай', 'points', 'балл'],
  explanation: ['түсініктеме', 'explanation', 'түсіндірме'],
  image: ['сурет', 'image', 'сурет id'],
  strict: ['қатаң тексеру', 'strict'],
};

const COLUMN_LABEL = {
  type: 'Сұрақ түрі', text: 'Сұрақ мәтіні', body: 'Контекст мәтіні', answers: 'Жауаптар', correct: 'Дұрыс жауап',
  points: 'Ұпай', image: 'Сурет', id: 'ID', context: 'Контекст', strict: 'Қатаң тексеру',
};

// Type names are compared by their letters only, so «Викторина — біржауапты», «викторина (біржауапты)»
// and «ВИКТОРИНА-БІРЖАУАПТЫ» are the same.
const letters = (v) => String(v ?? '').toLowerCase().replace(/[^\p{L}]/gu, '');
const TYPE_ALIASES = {
  single: ['single', 'викторина — біржауапты', 'біржауапты', 'бір жауапты', 'біржауапты сұрақ', 'бір дұрыс жауап', 'бір жауап', 'бір', 'викторина'],
  multiple: ['multiple', 'викторина — көпжауапты', 'көпжауапты', 'көп жауапты', 'көпжауапты сұрақ', 'бірнеше дұрыс жауап', 'бірнеше жауап', 'бірнеше'],
  image: ['image', 'суретпен берілетін сұрақ', 'суретті сұрақ', 'сурет'],
  matching: ['matching', 'сәйкестендіру', 'сәйкестік', 'сәйкестендіру тапсырмасы'],
  ordering: ['ordering', 'хронологиялық реттілік', 'хронологиялық рет', 'реттілік', 'хронология'],
  open: ['open', 'ашық жауап', 'ашық'],
  context: ['context', 'контекст', 'контекст блогы'],
};
const typeOf = (v) => Object.entries(TYPE_ALIASES).find(([, list]) => list.some((a) => letters(a) === letters(v)))?.[0];

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

/** A list in one cell: «Керей; Жәнібек» or one item per line. */
const splitList = (v) =>
  String(v ?? '')
    .split(/\s*[;\n]\s*/)
    .map((x) => x.trim())
    .filter(Boolean);

const same = (a, b) => textKey(a) === textKey(b);

/**
 * The right options of a quiz question. The answer can be written as the option texts («1465», «Керей; Жәнібек»)
 * or as their numbers or letters («2», «1, 3», «А, Б»).
 */
function correctIndexes(v, options) {
  const raw = String(v ?? '').trim();
  if (!raw) return { list: [] };
  const texts = splitList(raw);
  const byText = texts.map((t) => options.findIndex((o) => same(o.text, t)));
  if (byText.every((i) => i >= 0)) return { list: [...new Set(byText)] };
  const out = [];
  for (const p of raw.split(/[,;\s]+/).map((x) => x.trim().replace(/[.)]$/, '')).filter(Boolean)) {
    let i = /^\d+$/.test(p) ? Number(p) - 1 : LETTERS.indexOf(p.toUpperCase());
    if (i < 0 && /^[a-j]$/i.test(p)) i = LATIN.indexOf(p.toUpperCase());
    if (i < 0 || i >= options.length) {
      const missing = texts.find((t, k) => byText[k] < 0) || p;
      return { bad: missing };
    }
    if (!out.includes(i)) out.push(i);
  }
  return { list: out };
}

// «Керей — 1465–1473», «Керей = 1465–1473», «Керей → 1465–1473». A dash inside a date range (1465–1473) is not a separator.
const PAIR_SPLIT = /\s*(?:=|→|->)\s*|\s+[—–-]\s+/;
function splitPair(c) {
  const m = PAIR_SPLIT.exec(c);
  return m ? { left: c.slice(0, m.index).trim(), right: c.slice(m.index + m[0].length).trim() } : null;
}
/** «Оқиға — 1465», «Оқиға | 1465» or just «Оқиға». The last separator is used, so the event text may contain dashes. */
function splitEvent(c) {
  const bar = c.lastIndexOf('|');
  if (bar >= 0) return { text: c.slice(0, bar).trim(), date: c.slice(bar + 1).trim().slice(0, 60) };
  const dashes = [...c.matchAll(/\s+[—–-]\s+/g)];
  const m = dashes[dashes.length - 1];
  return m ? { text: c.slice(0, m.index).trim(), date: c.slice(m.index + m[0].length).trim().slice(0, 60) } : { text: c, date: '' };
}

const textKey = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Comparison key of a question for duplicate checks: its type and text without punctuation or case. */
export const duplicateKey = (q) => `${q.type}:${textKey(q.text)}`;

const colLetter = (i) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

/** Which column a question check points at. */
const problemColumn = (p) =>
  /мәтін/.test(p) && !/контекст/.test(p) ? 'text' : /дұрыс жауап|белгілен|тек бір/.test(p) ? 'correct' : /суреті/.test(p) ? 'image' : /контекст/.test(p) ? 'body' : 'answers';

/**
 * Table rows → questions in the cabinet model (see questions.js). The type column decides what is built:
 * a quiz gets options with the right ones marked, matching gets linked pairs, ordering gets events in the right order.
 * Returns { questions, errors: [{ row, column, message }], warnings: [string], images }.
 * A question with an error is left out; the rest can still be imported.
 */
export function rowsToQuestions(rows) {
  const errors = [];
  const warnings = [];
  const headerAt = rows.findIndex((r) => r.some((c) => String(c ?? '').trim()));
  if (headerAt < 0) return { questions: [], errors: [{ row: 1, column: '', message: 'Файл бос.' }], warnings, images: [] };
  const header = rows[headerAt];
  const map = mapHeader(header);
  const missing = [];
  if (map.type === undefined) missing.push('Сұрақ түрі');
  if (map.text === undefined) missing.push('Сұрақ мәтіні');
  if (!map.options.length && map.answers === undefined) missing.push('Жауаптар (немесе Нұсқа 1, Нұсқа 2…)');
  if (missing.length) {
    return {
      questions: [],
      errors: [{ row: headerAt + 1, column: '', message: `Тақырып жолында міндетті баған жоқ: ${missing.join(', ')}. Үлгі файлды жүктеп алып, сол бағандарды қолданыңыз.` }],
      warnings,
      images: [],
    };
  }
  /** «D бағаны («Дұрыс жауап»)» for messages. */
  const columnName = (key) => {
    const i = key === 'answers' && map.answers === undefined ? map.options[0] : map[key];
    if (i === undefined) return COLUMN_LABEL[key] || '';
    return `${colLetter(i)} («${String(header[i]).trim() || COLUMN_LABEL[key]}»)`;
  };
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
    const bad = (key, message) => errors.push({ row: rowNo, column: columnName(key), message });
    const rawType = cell(r, 'type');
    if (!rawType) return bad('type', 'Сұрақ түрі көрсетілмеген. Мысалы: Біржауапты, Көпжауапты, Сәйкестендіру, Хронологиялық реттілік.');
    const type = typeOf(rawType);
    if (!type) return bad('type', `«${rawType}» деген сұрақ түрі белгісіз. Мүмкін мәндер: Біржауапты, Көпжауапты, Сәйкестендіру, Хронологиялық реттілік, ${['image', 'open', 'context'].map((t) => TYPE_LABELS[t]).join(', ')}.`);
    const text = cell(r, 'text');
    if (text.length > (type === 'context' ? 300 : 2000)) return bad('text', 'Сұрақ мәтіні тым ұзын.');

    // Answers come from «Нұсқа N» columns, or from one «Жауаптар» cell separated by «;».
    let cells = map.options.map((ci) => String(r[ci] ?? '').trim());
    while (cells.length && !cells[cells.length - 1]) cells.pop();
    if (!cells.length && map.answers !== undefined) cells = splitList(cell(r, 'answers'));
    if (cells.length > MAX_OPTIONS && type !== 'matching' && type !== 'ordering') return bad('answers', `Жауап тым көп: ең көбі ${MAX_OPTIONS}.`);
    if (cells.length > 20) return bad('answers', 'Элемент тым көп: ең көбі 20.');
    if (cells.some((c) => c.length > 500)) return bad('answers', 'Жауап мәтіні тым ұзын (ең көбі 500 таңба).');
    const correct = cell(r, 'correct');

    const pointsRaw = cell(r, 'points').replace(',', '.');
    let points = 1;
    if (pointsRaw) {
      points = Number(pointsRaw);
      if (!Number.isFinite(points) || points < 0 || points > 100) return bad('points', `0–100 аралығындағы сан болуы керек («${pointsRaw}»).`);
      points = Math.round(points);
    }
    const imageId = fileIdOf(cell(r, 'image'));
    if (Number.isNaN(imageId)) return bad('image', `Суреттің ID нөмірі болуы керек («${cell(r, 'image')}»).`);
    if (imageId) images.add(imageId);

    const q = { type, text, explanation: cell(r, 'explanation').slice(0, 2000), image_id: imageId, points, options: [], data: {}, row: rowNo };

    if (CHOICE_TYPES.includes(type)) {
      const filled = cells.filter(Boolean);
      if (filled.length < cells.length) return bad('answers', 'Жауап нұсқаларының арасында бос ұяшық бар.');
      q.options = filled.map((c) => {
        const m = /^\[сурет:\s*(\d+)\]\s*/i.exec(c);
        if (m) images.add(Number(m[1]));
        return { text: m ? c.slice(m[0].length) : c, image_id: m ? Number(m[1]) : null, is_correct: false };
      });
      if (!correct) return bad('correct', 'Дұрыс жауап көрсетілмеген.');
      const { list, bad: wrong } = correctIndexes(correct, q.options);
      if (wrong) return bad('correct', `«${wrong}» жауап нұсқаларының ешқайсысына сәйкес келмейді.`);
      if (type === 'single' && list.length > 1) return bad('correct', `Біржауапты сұрақта тек бір дұрыс жауап болады (көрсетілгені: ${list.length}). Бірнеше дұрыс жауап болса, түрін «Көпжауапты» деп жазыңыз.`);
      if (type === 'multiple' && list.length < 2) warnings.push(`${rowNo}-жол: көпжауапты сұрақта бір ғана дұрыс жауап белгіленген.`);
      list.forEach((ci) => {
        q.options[ci].is_correct = true;
      });
    } else if (type === 'matching') {
      // The right pairs: from «Дұрыс жауап» when it holds pairs, otherwise from the answers column.
      const toPairs = (list) => list.map((c) => ({ c, pair: splitPair(c) }));
      const given = toPairs(cells.filter(Boolean));
      const key = toPairs(splitList(correct));
      const source = key.length && key.every((x) => x.pair) ? key : given;
      const broken = source.find((x) => !x.pair);
      if (broken) return bad(source === key ? 'correct' : 'answers', `Сәйкестендіру жұбы «Сол жақ — Оң жақ» түрінде жазылуы керек («${broken.c}»).`);
      const pairs = source.map((x) => x.pair);
      if (source === key && given.length && given.every((x) => x.pair)) {
        const asKey = (p) => `${textKey(p.left)}=${textKey(p.right)}`;
        const a = new Set(given.map((x) => asKey(x.pair)));
        if (a.size !== pairs.length || !pairs.every((p) => a.has(asKey(p)))) {
          return bad('correct', '«Жауаптар» мен «Дұрыс жауап» бағандарындағы жұптар бір-біріне сәйкес келмейді.');
        }
      }
      if (new Set(pairs.map((p) => textKey(p.left))).size < pairs.length) return bad(source === key ? 'correct' : 'answers', 'Сол жақтағы элементтер қайталанады.');
      q.data = { pairs };
    } else if (type === 'ordering') {
      // The right order: «Дұрыс жауап» when filled (the answers may be mixed up), otherwise the answers as written.
      const given = cells.filter(Boolean).map(splitEvent);
      const key = splitList(correct).map(splitEvent);
      let items = given;
      if (key.length) {
        if (given.length) {
          const left = given.map((g) => textKey(g.text));
          const unknown = key.find((k) => !left.includes(textKey(k.text)));
          if (unknown || key.length !== given.length) {
            return bad('correct', unknown ? `«${unknown.text}» «Жауаптар» бағанында жоқ.` : '«Дұрыс жауап» бағанындағы элементтер саны «Жауаптар» бағанымен бірдей емес.');
          }
          // Keep a date written only in the answers column.
          items = key.map((k) => ({ text: k.text, date: k.date || given.find((g) => same(g.text, k.text))?.date || '' }));
        } else items = key;
      }
      if (new Set(items.map((x) => textKey(x.text))).size < items.length) return bad('answers', 'Элементтер қайталанады.');
      q.data = { items };
    } else if (type === 'open') {
      const strict = norm(cell(r, 'strict'));
      const answers = cells.filter(Boolean).length ? cells.filter(Boolean) : splitList(correct);
      q.data = { answers: answers.map((a) => a.slice(0, 200)), ignore_case: !strict.includes('регистр'), ignore_spaces: !strict.includes('бос') };
    } else if (type === 'context') {
      q.points = 0;
      q.data = { body: cell(r, 'body').slice(0, 20000) };
      q.children = [];
      const label = cell(r, 'id');
      if (!label) return bad('id', 'Контекст жолында «ID» толтырылуы керек (мысалы, К1): сұрақтар осы белгіге сілтейді.');
      if (contexts.has(norm(label))) return bad('id', `«${label}» контекст белгісі қайталанады.`);
      contexts.set(norm(label), q);
    }
    const problems = questionProblems(type === 'context' ? { ...q, children: [{}] } : q);
    if (problems.length) return bad(problemColumn(problems[0]), `${problems.join('; ').replace(/^./, (c) => c.toUpperCase())}.`);

    const parent = cell(r, 'context');
    if (parent && type !== 'context') pendingChildren.push({ q, parent, rowNo });
    else top.push(q);
  });

  for (const { q, parent, rowNo } of pendingChildren) {
    const ctx = contexts.get(norm(parent));
    if (!ctx) {
      errors.push({ row: rowNo, column: columnName('context'), message: `«${parent}» деген контекст файлда табылмады.` });
      continue;
    }
    if (ctx.children.length >= 40) {
      errors.push({ row: rowNo, column: columnName('context'), message: 'Бір контекстке ең көбі 40 сұрақ.' });
      continue;
    }
    ctx.children.push(q);
  }
  const questions = top.filter((q) => {
    if (q.type === 'context' && !q.children.length) {
      errors.push({ row: q.row, column: columnName('id'), message: 'Контекстке бірде-бір дұрыс сұрақ байланыспаған: контекст сұрақтарының «Контекст» бағанына осы белгіні жазыңыз.' });
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
