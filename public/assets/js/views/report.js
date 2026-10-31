import { api } from '../api.js';
import { esc, MONTHS } from '../util.js';
import { icon, HORN } from '../art.js';
import { pageHead } from '../components.js';
import { gradeLabel } from '../catalog.js';

// «Кураторға есеп беру»: today's work (Asia/Almaty day) drawn as a report card on a canvas and
// saved as a PNG, or shared from a phone. The data is always fetched fresh from the server.

const TZ = 'Asia/Almaty';
const WEEKDAYS = ['жексенбі', 'дүйсенбі', 'сейсенбі', 'сәрсенбі', 'бейсенбі', 'жұма', 'сенбі'];
const C = {
  ink: '#131315',
  black: '#0b0b0c',
  red: '#b3161f',
  redLine: '#c7262c',
  paper: '#f7f6f3',
  white: '#ffffff',
  line: '#dcd9d3',
  text: '#17171a',
  text2: '#4a4a50',
  muted: '#74747c',
  onDark: '#f3f2ef',
  onDark2: '#b9b8b4',
  ok: '#1f7a4d',
  okBg: '#e5f2ea',
  mid: '#85520c',
  midBg: '#f6ecd9',
  bad: '#a4141c',
  badBg: '#f8e4e4',
};
const FONT = 'Montserrat, "Segoe UI", Roboto, Arial, sans-serif';

export const dayTitle = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${d} ${MONTHS[m - 1]} ${y}, ${weekday}`;
};

/** "1 сағ 5 мин", "12 мин", "1 минуттан аз". */
export function minutes(sec) {
  const m = Math.round((sec || 0) / 60);
  if (sec > 0 && m < 1) return '1 минуттан аз';
  if (m < 60) return `${m} мин`;
  return `${Math.floor(m / 60)} сағ ${m % 60} мин`;
}

const almatyTime = (iso) =>
  new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const dbTime = (s) => almatyTime(String(s).replace(' ', 'T') + 'Z');
const tags = (x) => [x.subject, gradeLabel(x.grade), x.publisher].filter(Boolean).join(' · ');
const scoreColors = (p) => (p >= 80 ? [C.ok, C.okBg] : p >= 50 ? [C.mid, C.midBg] : [C.bad, C.badBg]);
const pagesText = (pages) => {
  // 3, 4, 5, 9 → "3–5, 9"
  const out = [];
  for (let i = 0; i < pages.length; i += 1) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j += 1;
    out.push(i === j ? `${pages[i]}` : `${pages[i]}–${pages[j]}`);
    i = j;
  }
  return out.join(', ');
};

// Older Safari (before 16) has no roundRect.
function roundRect(ctx, x, y, w, h, r) {
  if (ctx.roundRect) return ctx.roundRect(x, y, w, h, r);
  const rr = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Draws the report. With draw = false only measures; returns the height. */
function layout(ctx, r, W, draw) {
  const PAD = 56;
  const inner = W - PAD * 2;
  let y = 0;
  const font = (weight, size) => {
    ctx.font = `${weight} ${size}px ${FONT}`;
  };
  // Wraps text to a width; very long words are broken by letters.
  const wrap = (text, width) => {
    const lines = [];
    let line = '';
    for (const word of String(text).split(/\s+/).filter(Boolean)) {
      const tryLine = line ? `${line} ${word}` : word;
      if (ctx.measureText(tryLine).width <= width) {
        line = tryLine;
        continue;
      }
      if (line) lines.push(line);
      if (ctx.measureText(word).width <= width) {
        line = word;
        continue;
      }
      let part = '';
      for (const ch of word) {
        if (ctx.measureText(part + ch).width > width && part) {
          lines.push(part);
          part = ch;
        } else part += ch;
      }
      line = part;
    }
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  };
  const text = (str, x, top, { weight = 500, size = 26, color = C.text, width = inner, lh = 1.35, align = 'left' } = {}) => {
    font(weight, size);
    const lines = wrap(str, width);
    if (draw) {
      ctx.fillStyle = color;
      ctx.textAlign = align;
      ctx.textBaseline = 'top';
      lines.forEach((l, i) => ctx.fillText(l, align === 'right' ? x + width : x, top + i * size * lh));
      ctx.textAlign = 'left';
    }
    return lines.length * size * lh;
  };
  const rect = (x, top, w, h, color, radius = 0) => {
    if (!draw) return;
    ctx.fillStyle = color;
    ctx.beginPath();
    roundRect(ctx, x, top, w, h, radius);
    ctx.fill();
  };
  const horn = (x, top, scale, color, width = 2.6) => {
    if (!draw) return;
    ctx.save();
    ctx.translate(x, top);
    ctx.scale(scale, scale);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(new Path2D(HORN));
    ctx.restore();
  };

  // ── Header ──
  const headTop = y;
  let hy = 52;
  const headInner = () => {
    let h = 0;
    rect(PAD, headTop + hy, 64, 64, C.red, 14);
    horn(PAD + 8, headTop + hy + 14, 1.2, C.white, 2.4);
    text('QADAM', PAD + 84, headTop + hy + 2, { weight: 900, size: 34, color: C.white, width: inner - 84 });
    text('ҚАЗАҚСТАН ТАРИХЫ', PAD + 84, headTop + hy + 40, { weight: 700, size: 16, color: C.onDark2, width: inner - 84 });
    h += 64 + 40;
    rect(PAD, headTop + hy + h, 46, 5, C.redLine, 3);
    h += 26;
    h += text('КУРАТОРҒА КҮНДЕЛІКТІ ЕСЕП', PAD, headTop + hy + h, { weight: 900, size: 40, color: C.white, lh: 1.15 });
    h += 18;
    h += text(r.student, PAD, headTop + hy + h, { weight: 800, size: 30, color: C.white });
    h += 6;
    h += text(dayTitle(r.day), PAD, headTop + hy + h, { weight: 600, size: 24, color: C.onDark2 });
    return h;
  };
  // Measure the header first, then paint its background under it.
  const wasDraw = draw;
  draw = false;
  const headH = hy + headInner() + 70;
  draw = wasDraw;
  rect(0, headTop, W, headH, C.black);
  if (draw) for (let x = -6; x < W; x += 58) horn(x, headTop + headH - 34, 1.25, '#3d0a10', 2);
  headInner();
  y = headH + 36;

  // ── Summary tiles ──
  const a = r.activity;
  const tiles = [
    ['Белсенді уақыт', minutes(a.active_sec)],
    ['Тест', String(a.tests_done)],
    ['Қатемен жұмыс', String(a.reworks_done)],
    ['Кітап', a.pages_read ? `${a.books_opened} · ${a.pages_read} бет` : String(a.books_opened)],
  ];
  const gap = 16;
  const tw = (inner - gap) / 2;
  const th = 118;
  tiles.forEach(([label, value], i) => {
    const x = PAD + (i % 2) * (tw + gap);
    const top = y + Math.floor(i / 2) * (th + gap);
    rect(x, top, tw, th, i === 0 ? C.ink : C.white, 18);
    if (draw && i !== 0) {
      ctx.strokeStyle = C.line;
      ctx.lineWidth = 2;
      ctx.beginPath();
      roundRect(ctx, x + 1, top + 1, tw - 2, th - 2, 18);
      ctx.stroke();
    }
    text(value, x + 24, top + 22, { weight: 900, size: 38, color: i === 0 ? C.white : C.text, width: tw - 48, lh: 1.1 });
    text(label.toUpperCase(), x + 24, top + 76, { weight: 800, size: 16, color: i === 0 ? C.onDark2 : C.muted, width: tw - 48 });
  });
  y += th * 2 + gap + 22;
  if (a.active_sec) {
    const parts = [a.test_sec ? `тест ${minutes(a.test_sec)}` : '', a.reading_sec ? `кітап оқу ${minutes(a.reading_sec)}` : ''].filter(Boolean);
    if (parts.length) y += text(`Оның ішінде: ${parts.join(' · ')}`, PAD, y, { weight: 600, size: 21, color: C.text2 });
  }
  y += 28;

  // ── Sections ──
  const section = (title, items, empty, drawItem) => {
    text(title.toUpperCase(), PAD, y, { weight: 900, size: 22, color: C.red });
    y += 40;
    if (!items.length) {
      const was = draw;
      draw = false;
      const h = text(empty, PAD + 28, y + 24, { weight: 600, size: 23, color: C.text2, width: inner - 56 }) + 48;
      draw = was;
      rect(PAD, y, inner, h, C.white, 16);
      text(empty, PAD + 28, y + 24, { weight: 600, size: 23, color: C.text2, width: inner - 56 });
      y += h + 30;
      return;
    }
    for (const item of items) {
      const was = draw;
      draw = false;
      const h = drawItem(item, y + 24) + 48;
      draw = was;
      rect(PAD, y, inner, h, C.white, 16);
      rect(PAD, y, 8, h, C.red, 4);
      drawItem(item, y + 24);
      y += h + 16;
    }
    y += 18;
  };
  const badge = (percent, top) => {
    font(900, 26);
    const label = `${percent}%`;
    const bw = ctx.measureText(label).width + 32;
    const [fg, bg] = scoreColors(percent);
    rect(PAD + inner - 28 - bw, top - 4, bw, 44, bg, 22);
    text(label, PAD + inner - 28 - bw + 16, top + 4, { weight: 900, size: 26, color: fg, width: bw });
    return bw;
  };
  const bodyX = PAD + 32;
  const bodyW = inner - 60;

  section('Тапсырылған тесттер', r.tests, 'Бүгін тест тапсырылмады.', (t, top) => {
    let h = 0;
    font(900, 26);
    const bw = ctx.measureText(`${t.last.percent}%`).width + 32;
    if (draw) badge(t.last.percent, top);
    h += text(t.title, bodyX, top, { weight: 800, size: 27, width: bodyW - bw - 20 });
    const meta = [t.title !== t.topic_title ? t.topic_title : '', gradeLabel(t.grade), t.publisher].filter(Boolean).join(' · ');
    if (meta) h += 4 + text(meta, bodyX, top + h + 4, { weight: 600, size: 20, color: C.muted, width: bodyW });
    h += 12;
    const last = t.last;
    h += text(
      `${last.correct} дұрыс · ${last.wrong} қате · ${last.total} сұрақ${last.max_score ? ` · ${Math.round(last.score * 100) / 100}/${last.max_score} ұпай` : ''}`,
      bodyX, top + h, { weight: 700, size: 22, color: C.text2, width: bodyW },
    );
    h += 6;
    const times = t.times > 1 ? `Бүгін ${t.times} рет тапсырылды: ${t.attempts.map((x) => `${x.percent}%`).join(', ')} · ең жақсысы ${t.best_percent}%` : 'Бүгін 1 рет тапсырылды';
    h += text(times, bodyX, top + h, { weight: 600, size: 20, color: C.muted, width: bodyW });
    return h;
  });

  section('Қате сұрақтармен жұмыс', r.reworks, 'Қате сұрақтармен жұмыс орындалмады.', (t, top) => {
    let h = 0;
    const fixed = t.attempts.reduce((s, x) => s + x.correct, 0);
    const total = t.attempts.reduce((s, x) => s + x.total, 0);
    const pct = total ? Math.round((fixed / total) * 100) : 0;
    font(900, 26);
    const bw = ctx.measureText(`${pct}%`).width + 32;
    if (draw) badge(pct, top);
    h += text(t.title, bodyX, top, { weight: 800, size: 27, width: bodyW - bw - 20 });
    const meta = [gradeLabel(t.grade), t.publisher].filter(Boolean).join(' · ');
    if (meta) h += 4 + text(meta, bodyX, top + h + 4, { weight: 600, size: 20, color: C.muted, width: bodyW });
    h += 12;
    h += text(`${t.times} рет орындалды · ${fixed}/${total} қате түзетілді`, bodyX, top + h, { weight: 700, size: 22, color: C.text2, width: bodyW });
    h += 6;
    h += text(t.attempts.map((x, i) => `${i + 1}-рет: ${x.correct}/${x.total}`).join(' · '), bodyX, top + h, { weight: 600, size: 20, color: C.muted, width: bodyW });
    return h;
  });

  section('Оқылған кітаптар', r.books, 'Бүгін кітап ашылмады.', (b, top) => {
    let h = 0;
    h += text(b.title, bodyX, top, { weight: 800, size: 27, width: bodyW });
    const meta = tags(b);
    if (meta) h += 4 + text(meta, bodyX, top + h + 4, { weight: 600, size: 20, color: C.muted, width: bodyW });
    h += 12;
    // Opening a book is not reading it: pages are named only when time was spent on them.
    const line = b.pages_read
      ? `${b.pages_read} бет оқылды (${pagesText(b.pages)}) · оқу уақыты ${minutes(b.reading_sec)}`
      : b.reading_sec
        ? `Кітап ашылды · оқу уақыты ${minutes(b.reading_sec)} · толық оқылған бет жоқ`
        : 'Кітап ашылды · оқу уақыты есептелмеді';
    h += text(line, bodyX, top + h, { weight: 700, size: 22, color: C.text2, width: bodyW });
    return h;
  });

  // ── Footer ──
  rect(PAD, y, inner, 2, C.line);
  y += 24;
  y += text(`Есеп жасалды: ${dayTitle(r.day)}, ${almatyTime(r.generated_at)} (Алматы уақыты)`, PAD, y, { weight: 600, size: 19, color: C.muted });
  y += 6;
  y += text('Белсенді уақыт сайт ашық тұрып, оқушы әрекет еткенде ғана есептеледі. Бет 30 секундтан көп оқылса ғана «оқылды» деп саналады.', PAD, y, { weight: 500, size: 18, color: C.muted });
  y += 50;
  return Math.ceil(y);
}

/** Renders the report to a canvas (2× for sharp text). */
export async function drawReport(r) {
  // Kazakh letters come from the site's own Montserrat files; wait for every weight we use.
  const sample = 'ҚқӘәҒғҮүҰұІіӨөҺһҢң QADAM 0123';
  await Promise.all([500, 600, 700, 800, 900].map((w) => document.fonts.load(`${w} 24px Montserrat`, sample).catch(() => null)));
  const W = 1080;
  const scale = 2;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = W * scale;
  canvas.height = 10;
  ctx.scale(scale, scale);
  const height = layout(ctx, r, W, false);
  canvas.height = height * scale;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, W, height);
  layout(ctx, r, W, true);
  return canvas;
}

const toBlob = (canvas) => new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Сурет жасалмады.'))), 'image/png'));

export async function reportView(el, _params, app, alive) {
  el.innerHTML = `
    ${pageHead({ eyebrow: 'Күнделікті есеп', title: 'Кураторға есеп беру', text: 'Бүгінгі жұмысыңыз бір суретте: тесттер, қатемен жұмыс, кітаптар және белсенді уақыт. Суретті сақтап, кураторға жіберіңіз.' })}
    <div class="report-actions panel">
      <button type="button" class="btn" data-act="download" disabled>PNG жүктеу</button>
      <button type="button" class="btn btn-dark" data-act="share" hidden disabled>Бөлісу</button>
      <button type="button" class="btn btn-ghost btn-sm" data-act="refresh" disabled>Жаңарту</button>
      <p class="report-note" data-note role="status">Есеп дайындалуда…</p>
    </div>
    <div class="report-preview" data-preview></div>`;
  const note = (t) => (el.querySelector('[data-note]').textContent = t);
  let blob = null;
  let fileName = '';

  async function build() {
    el.querySelectorAll('[data-act]').forEach((b) => (b.disabled = true));
    note('Есеп дайындалуда…');
    // Fresh data every time: after midnight in Almaty this is already the new day.
    const r = await api.get('/api/report/daily');
    if (!alive()) return;
    const canvas = await drawReport(r);
    blob = await toBlob(canvas);
    if (!alive()) return;
    fileName = `qadam-esep-${r.day}.png`;
    const img = new Image();
    img.alt = `${r.student}: ${dayTitle(r.day)} күнгі есеп`;
    img.src = canvas.toDataURL('image/png');
    el.querySelector('[data-preview]').replaceChildren(img);
    const file = new File([blob], fileName, { type: 'image/png' });
    const canShare = Boolean(navigator.canShare && navigator.share && navigator.canShare({ files: [file] }));
    el.querySelector('[data-act="share"]').hidden = !canShare;
    el.querySelectorAll('[data-act]').forEach((b) => (b.disabled = false));
    note(`${dayTitle(r.day)} · ${Math.round(blob.size / 1024)} КБ · жасалған уақыты ${almatyTime(r.generated_at)}`);
  }

  el.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'refresh') return build().catch((err) => note(err.message));
    if (!blob) return;
    if (act === 'download') {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } else if (act === 'share') {
      try {
        await navigator.share({ files: [new File([blob], fileName, { type: 'image/png' })], title: 'QADAM: кураторға есеп' });
      } catch (err) {
        if (err?.name !== 'AbortError') note('Бөлісу мүмкін болмады. «PNG жүктеу» батырмасын қолданыңыз.');
      }
    }
  });
  await build().catch((err) => note(err.message || 'Есеп жасалмады.'));
}
