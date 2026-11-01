import { MONTHS } from './util.js';
import { HORN } from './art.js';
import { gradeLabel, SUBJECT } from './catalog.js';

// Report cards drawn on a canvas (not a screenshot of the page), so the saved picture holds only
// the report. Every layout runs twice: once to measure the height, once to paint.

const TZ = 'Asia/Almaty';
const WEEKDAYS = ['жексенбі', 'дүйсенбі', 'сейсенбі', 'сәрсенбі', 'бейсенбі', 'жұма', 'сенбі'];
export const C = {
  ink: '#131315',
  black: '#0b0b0c',
  graphite: '#242428',
  red: '#b3161f',
  redLine: '#c7262c',
  bordo: '#6e1018',
  bordoDeep: '#3d0a10',
  canvas: '#edebe7',
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
const W = 1080;
const PAD = 56;
const INNER = W - PAD * 2;

export const dayTitle = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}, ${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}`;
};
const almatyParts = (date) => {
  const o = {};
  for (const p of new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date)) o[p.type] = p.value;
  return o;
};
export const almatyTime = (iso) => {
  const o = almatyParts(new Date(iso));
  return `${o.hour}:${o.minute}`;
};
/** A database UTC time as «31 қазан 2026, 20:13» in Almaty. */
export const dbDateTime = (s) => {
  const o = almatyParts(new Date(String(s).replace(' ', 'T') + 'Z'));
  return `${Number(o.day)} ${MONTHS[Number(o.month) - 1]} ${o.year}, ${o.hour}:${o.minute}`;
};
const dbShort = (s) => {
  const o = almatyParts(new Date(String(s).replace(' ', 'T') + 'Z'));
  return `${Number(o.day)}.${o.month}`;
};

/** "1 сағ 5 мин", "12 мин", "1 минуттан аз". */
export function minutes(sec) {
  const m = Math.round((sec || 0) / 60);
  if (sec > 0 && m < 1) return '1 минуттан аз';
  if (m < 60) return `${m} мин`;
  return `${Math.floor(m / 60)} сағ ${m % 60} мин`;
}
/** "4 мин 05 с" for a test duration. */
const testTime = (sec) => {
  if (sec == null) return '—';
  const s = Math.max(0, Math.round(sec));
  return s < 60 ? `${s} с` : `${Math.floor(s / 60)} мин ${String(s % 60).padStart(2, '0')} с`;
};
const scoreColors = (p) => (p >= 80 ? [C.ok, C.okBg] : p >= 50 ? [C.mid, C.midBg] : [C.bad, C.badBg]);
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');
const tagLine = (x) => [x.subject || SUBJECT, gradeLabel(x.grade), x.publisher].filter(Boolean).join(' | ');

// Older Safari (before 16) has no roundRect.
function roundPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) return ctx.roundRect(x, y, w, h, r);
  const rr = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Drawing helpers; in measure mode nothing is painted but every height is still returned. */
function painter(ctx) {
  const g = {
    draw: true,
    font(weight, size) {
      ctx.font = `${weight} ${size}px ${FONT}`;
    },
    width(str, weight, size) {
      g.font(weight, size);
      return ctx.measureText(str).width;
    },
    // Wraps text to a width; a very long word is broken by letters, nothing is cut off.
    lines(str, width) {
      const out = [];
      let line = '';
      for (const word of String(str ?? '').split(/\s+/).filter(Boolean)) {
        const tryLine = line ? `${line} ${word}` : word;
        if (ctx.measureText(tryLine).width <= width) {
          line = tryLine;
          continue;
        }
        if (line) out.push(line);
        if (ctx.measureText(word).width <= width) {
          line = word;
          continue;
        }
        let part = '';
        for (const ch of word) {
          if (part && ctx.measureText(part + ch).width > width) {
            out.push(part);
            part = ch;
          } else part += ch;
        }
        line = part;
      }
      if (line) out.push(line);
      return out.length ? out : [''];
    },
    text(str, x, y, { weight = 500, size = 24, color = C.text, width = INNER, lh = 1.35, align = 'left', max = 0 } = {}) {
      g.font(weight, size);
      let lines = g.lines(str, width);
      if (max && lines.length > max) {
        lines = lines.slice(0, max);
        let l = lines[max - 1];
        while (l && ctx.measureText(`${l}…`).width > width) l = l.slice(0, -1);
        lines[max - 1] = `${l.trimEnd()}…`;
      }
      if (g.draw) {
        ctx.fillStyle = color;
        ctx.textBaseline = 'top';
        ctx.textAlign = align;
        const ax = align === 'right' ? x + width : align === 'center' ? x + width / 2 : x;
        lines.forEach((l, i) => ctx.fillText(l, ax, y + i * size * lh));
        ctx.textAlign = 'left';
      }
      return lines.length * size * lh;
    },
    rect(x, y, w, h, color, r = 0) {
      if (!g.draw) return;
      ctx.fillStyle = color;
      roundPath(ctx, x, y, w, h, r);
      ctx.fill();
    },
    stroke(x, y, w, h, color, r = 0, lw = 2) {
      if (!g.draw) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      roundPath(ctx, x + lw / 2, y + lw / 2, w - lw, h - lw, r);
      ctx.stroke();
    },
    line(points, color, lw = 3, dash = []) {
      if (!g.draw) return;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.setLineDash(dash);
      ctx.beginPath();
      points.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.stroke();
      ctx.restore();
    },
    dot(x, y, r, fill, ring = null) {
      if (!g.draw) return;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      if (ring) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = ring;
        ctx.stroke();
      }
    },
    ring(cx, cy, r, lw, share, color, track) {
      if (!g.draw) return;
      ctx.save();
      ctx.lineWidth = lw;
      ctx.lineCap = 'round';
      ctx.strokeStyle = track;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      if (share > 0) {
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, share));
        ctx.stroke();
      }
      ctx.restore();
    },
    horn(x, y, scale, color, lw = 2.4) {
      if (!g.draw) return;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke(new Path2D(HORN));
      ctx.restore();
    },
    /** Runs fn(measure) and returns its height without painting. */
    measure(fn) {
      const was = g.draw;
      g.draw = false;
      const h = fn();
      g.draw = was;
      return h;
    },
    /** A white card around fn(top): measured first, then painted under the content. */
    card(y, fn, { pad = 30, color = C.white, border = true, accent = null } = {}) {
      const h = g.measure(() => fn(y + pad)) + pad * 2;
      g.rect(PAD, y, INNER, h, color, 20);
      if (border) g.stroke(PAD, y, INNER, h, C.line, 20, 2);
      if (accent) g.rect(PAD, y + 20, 7, h - 40, accent, 4);
      fn(y + pad);
      return h;
    },
    pill(label, x, y, [fg, bg], { size = 22, weight = 900, right = false } = {}) {
      const w = g.width(label, weight, size) + size * 1.2;
      const h = size * 1.75;
      const left = right ? x - w : x;
      g.rect(left, y, w, h, bg, h / 2);
      g.text(label, left + size * 0.6, y + (h - size * 1.2) / 2, { weight, size, color: fg, width: w, lh: 1.2 });
      return { w, h };
    },
    section(title, y, sub = '') {
      g.rect(PAD, y + 8, 30, 5, C.redLine, 3);
      let h = g.text(title.toUpperCase(), PAD + 44, y, { weight: 900, size: 22, color: C.text, width: INNER - 44 });
      if (sub) h += 4 + g.text(sub, PAD + 44, y + h + 4, { weight: 500, size: 19, color: C.muted, width: INNER - 44 });
      return h + 18;
    },
  };
  return g;
}

/** Black header with the QADAM mark: returns its height. */
function header(g, title, lines) {
  const body = (top) => {
    let h = 0;
    g.rect(PAD, top, 60, 60, C.red, 14);
    g.horn(PAD + 7, top + 13, 1.15, C.white, 2.4);
    g.text('QADAM', PAD + 78, top + 2, { weight: 900, size: 32, color: C.white, width: 300 });
    g.text('ҚАЗАҚСТАН ТАРИХЫ', PAD + 78, top + 38, { weight: 700, size: 15, color: C.onDark2, width: 400 });
    g.text(title, PAD, top + 18, { weight: 800, size: 16, color: C.onDark2, width: INNER, align: 'right' });
    h += 60 + 44;
    for (const l of lines) {
      if (!l.text) continue;
      h += g.text(l.text, PAD, top + h, { weight: l.weight, size: l.size, color: l.color, lh: l.lh || 1.25 }) + (l.gap ?? 10);
    }
    return h;
  };
  const top = 50;
  const h = top + g.measure(() => body(top)) + 66;
  g.rect(0, 0, W, h, C.black);
  g.rect(0, h - 6, W, 6, C.red);
  for (let x = -6; x < W; x += 58) g.horn(x, h - 40, 1.25, C.bordoDeep, 2);
  body(top);
  return h;
}

function footer(g, y, note) {
  g.rect(PAD, y, INNER, 2, C.line);
  let h = 22;
  h += g.text(note, PAD, y + h, { weight: 500, size: 18, color: C.muted });
  return h + 50;
}

// ─── Report for one test ──────────────────────────────────────────
function testLayout(g, r) {
  const { first, last, change, attempts, test } = r;
  const book = [test.book_authors ? `Авторлары: ${test.book_authors}` : '', test.book_year ? `${test.book_year} ж.` : '', test.book_pages ? `Беттер: ${test.book_pages}` : '']
    .filter(Boolean)
    .join(' · ');
  let y = header(g, 'КУРАТОРҒА ЕСЕП', [
    { text: r.student, weight: 900, size: 44, color: C.white, gap: 14, lh: 1.15 },
    { text: test.title, weight: 800, size: 30, color: C.white, gap: 8 },
    { text: tagLine(test), weight: 700, size: 22, color: '#f0b5b8', gap: 6 },
    { text: book, weight: 500, size: 19, color: C.onDark2, gap: 6 },
    { text: `Соңғы тапсырған уақыты: ${dbDateTime(last.created_at)}`, weight: 600, size: 20, color: C.onDark2, gap: 0 },
  ]);
  y += 40;

  // Main result: ring + four figures.
  y += g.section('Негізгі нәтиже', y, attempts.length > 1 ? `Соңғы (${attempts.length}-) тапсыру бойынша` : 'Бірінші тапсыру бойынша');
  y += g.card(y, (top) => {
    const [fg] = scoreColors(last.percent);
    const cx = PAD + 30 + 110;
    const cy = top + 110;
    g.ring(cx, cy, 92, 26, last.percent / 100, fg, C.canvas);
    g.text(`${last.percent}%`, cx - 90, cy - 30, { weight: 900, size: 46, color: C.text, width: 180, align: 'center', lh: 1.1 });
    g.text('НӘТИЖЕ', cx - 90, cy + 24, { weight: 800, size: 15, color: C.muted, width: 180, align: 'center' });
    const left = PAD + 30 + 250;
    const tw = (INNER - 30 - 250 - 30 - 16) / 2;
    const tiles = [
      ['Дұрыс', String(last.correct), C.ok],
      ['Қате', String(last.wrong), C.bad],
      ['Барлық сұрақ', String(last.total), C.text],
      ['Уақыт', testTime(last.duration_sec), C.text],
    ];
    tiles.forEach(([label, value, color], i) => {
      const x = left + (i % 2) * (tw + 16);
      const ty = top + Math.floor(i / 2) * 112;
      g.rect(x, ty, tw, 96, C.paper, 14);
      g.text(value, x + 20, ty + 14, { weight: 900, size: value.length > 6 ? 28 : 36, color, width: tw - 40, lh: 1.1 });
      g.text(label.toUpperCase(), x + 20, ty + 62, { weight: 800, size: 14, color: C.muted, width: tw - 40 });
    });
    let h = 220;
    if (last.max_score) h += g.text(`Ұпай: ${Math.round(last.score * 100) / 100} / ${last.max_score}`, PAD + 30, top + h + 6, { weight: 700, size: 20, color: C.text2 }) + 6;
    return h;
  });
  y += 40;

  // First vs last.
  y += g.section('Нәтиженің өзгерісі', y, attempts.length > 1 ? 'Алғашқы және соңғы тапсыру' : 'Тест бір рет тапсырылды: алғашқы және соңғы нәтиже бірдей');
  y += g.card(y, (top) => {
    const cw = (INNER - 60 - 20) / 2;
    const box = (x, label, a, accent) => {
      g.rect(x, top, cw, 150, C.paper, 16);
      g.rect(x, top, cw, 6, accent, 3);
      g.text(label.toUpperCase(), x + 22, top + 22, { weight: 800, size: 15, color: C.muted, width: cw - 44 });
      g.text(`${a.correct}/${a.total}`, x + 22, top + 48, { weight: 900, size: 40, color: C.text, width: cw - 44, lh: 1.1 });
      g.text(`${a.percent}% · ${dbDateTime(a.created_at)}`, x + 22, top + 102, { weight: 600, size: 18, color: C.text2, width: cw - 44 });
    };
    box(PAD + 30, 'Алғашқы нәтиже', first, C.line);
    box(PAD + 30 + cw + 20, 'Соңғы нәтиже', last, scoreColors(last.percent)[0]);
    let h = 170;
    // Bars on one scale.
    const barX = PAD + 30 + 150;
    const barW = INNER - 60 - 150 - 90;
    [['Алғашқы', first.percent, '#b9b8b4'], ['Соңғы', last.percent, scoreColors(last.percent)[0]]].forEach(([label, p, color], i) => {
      const by = top + h + i * 52;
      g.text(label, PAD + 30, by + 4, { weight: 700, size: 19, color: C.text2, width: 140 });
      g.rect(barX, by + 4, barW, 26, C.canvas, 13);
      if (p > 0) g.rect(barX, by + 4, Math.max(26, (barW * p) / 100), 26, color, 13);
      g.text(`${p}%`, barX + barW + 14, by + 3, { weight: 900, size: 22, color: C.text, width: 80 });
    });
    h += 110;
    const pp = change.percent_points;
    const colors = pp > 0 ? [C.ok, C.okBg] : pp < 0 ? [C.text2, C.canvas] : [C.text2, C.canvas];
    const pill = g.pill(`${signed(pp)} пайыздық тармақ`, PAD + 30, top + h + 4, colors, { size: 22 });
    g.text(`Дұрыс жауаптар: ${signed(change.correct)} сұрақ`, PAD + 30 + pill.w + 18, top + h + 10, { weight: 700, size: 21, color: C.text2, width: INNER - 60 - pill.w - 18 });
    return h + pill.h + 6;
  });
  y += 40;

  // Achievement.
  y += g.section('Оқу жетістігі', y);
  const pp = change.percent_points;
  const verdict =
    attempts.length === 1
      ? `Тест бір рет тапсырылды: ${last.percent}%. Қайта тапсырса, өзгерісі осы жерде көрінеді.`
      : pp > 0
        ? `Нәтиже ${first.percent}%-дан ${last.percent}%-ға өсті (${signed(pp)} п.т.). Қайта тапсырғанда ${Math.max(0, change.correct)} сұраққа артық дұрыс жауап берілді.`
        : pp < 0
          ? `Соңғы нәтиже алғашқысынан ${Math.abs(pp)} п.т. төмен (${first.percent}% → ${last.percent}%). Қате жауап берілген сұрақтарды қайталау ұсынылады.`
          : `Нәтиже өзгермеді: ${last.percent}%. Қате сұрақтармен жұмыс істеу ұсынылады.`;
  const points = [
    attempts.length > 1 ? [pp > 0 ? '▲' : pp < 0 ? '▼' : '●', `Нәтиже: ${first.percent}% → ${last.percent}% (${signed(pp)} п.т.)`, pp > 0 ? C.ok : C.text2] : null,
    attempts.length > 1 ? ['●', `Дұрыс жауаптар саны: ${first.correct} → ${last.correct} (${signed(change.correct)})`, C.text2] : null,
    attempts.length > 1 ? ['●', `Қате жауаптар саны: ${first.wrong} → ${last.wrong} (${signed(change.wrong)})`, change.wrong < 0 ? C.ok : C.text2] : null,
    ['●', `Ең жоғары нәтиже: ${r.best_percent}% · орташа: ${r.average_percent}%`, C.text2],
  ].filter(Boolean);
  y += g.card(
    y,
    (top) => {
      let h = g.text(verdict, PAD + 40, top, { weight: 700, size: 23, color: C.text, width: INNER - 70 }) + 14;
      for (const [mark, line, color] of points) {
        g.text(mark, PAD + 40, top + h + 1, { weight: 900, size: 18, color, width: 30 });
        h += g.text(line, PAD + 72, top + h, { weight: 600, size: 21, color: C.text2, width: INNER - 102 }) + 8;
      }
      return h;
    },
    { accent: pp > 0 && attempts.length > 1 ? C.ok : C.line },
  );
  y += 40;

  // History: chart + list.
  y += g.section('Тапсыру тарихы', y, `${attempts.length} рет тапсырылды`);
  y += g.card(y, (top) => {
    let h = 0;
    if (attempts.length > 1) {
      const shown = attempts.slice(-15);
      const cx0 = PAD + 30 + 56;
      const cw = INNER - 60 - 56 - 20;
      const ch = 220;
      for (const v of [0, 50, 100]) {
        const gy = top + 10 + ch - (ch * v) / 100;
        g.line([[cx0, gy], [cx0 + cw, gy]], C.line, 2, v === 50 ? [6, 8] : []);
        g.text(`${v}%`, PAD + 30, gy - 11, { weight: 700, size: 16, color: C.muted, width: 50 });
      }
      const step = shown.length > 1 ? cw / (shown.length - 1) : 0;
      const pts = shown.map((a, i) => [cx0 + i * step, top + 10 + ch - (ch * a.percent) / 100]);
      g.line(pts, C.red, 4);
      pts.forEach(([px, py], i) => {
        g.dot(px, py, 8, C.white, C.red);
        const label = `${shown[i].percent}%`;
        const lw = g.width(label, 800, 16);
        g.text(label, Math.min(Math.max(px - lw / 2, cx0 - 20), cx0 + cw - lw + 10), py - 32 < top ? py + 14 : py - 32, { weight: 800, size: 16, color: C.text, width: lw + 4 });
        if (shown.length <= 10 || i % 2 === 0 || i === shown.length - 1) {
          const n = attempts.length - shown.length + i + 1;
          const tl = `${n}-рет`;
          g.text(tl, px - 40, top + ch + 24, { weight: 700, size: 15, color: C.muted, width: 80, align: 'center' });
        }
      });
      h += ch + 60;
    }
    const rows = attempts.slice(-10);
    if (attempts.length > rows.length) h += g.text(`Соңғы ${rows.length} тапсыру көрсетілген.`, PAD + 30, top + h, { weight: 500, size: 18, color: C.muted }) + 6;
    rows.forEach((a, i) => {
      const n = attempts.length - rows.length + i + 1;
      const ry = top + h;
      if (i) g.rect(PAD + 30, ry - 1, INNER - 60, 1, C.line);
      g.text(`${n}-тапсыру`, PAD + 30, ry + 14, { weight: 800, size: 20, color: C.text, width: 150 });
      g.text(`${dbDateTime(a.created_at)} · ${a.correct}/${a.total} · ${testTime(a.duration_sec)}`, PAD + 190, ry + 15, { weight: 500, size: 19, color: C.text2, width: INNER - 60 - 160 - 120 });
      g.pill(`${a.percent}%`, PAD + INNER - 30, ry + 8, scoreColors(a.percent), { size: 18, right: true });
      h += 56;
    });
    return h;
  });
  y += 40;

  // More: reworks and what to repeat.
  y += g.section('Қосымша ақпарат', y);
  y += g.card(y, (top) => {
    let h = 0;
    const rw = r.reworks;
    const facts = [
      `Қайта тапсыру саны: ${Math.max(0, attempts.length - 1)}`,
      rw.count ? `Қатемен жұмыс: ${rw.count} рет, ${rw.fixed}/${rw.total} қате түзетілді` : 'Қате сұрақтармен жұмыс орындалмады',
    ];
    for (const f of facts) h += g.text(`• ${f}`, PAD + 30, top + h, { weight: 600, size: 21, color: C.text2, width: INNER - 60 }) + 6;
    h += 14;
    if (r.attention.length) {
      h += g.text('Қайталау керек сұрақтар (соңғы тапсырудағы қателер):', PAD + 30, top + h, { weight: 800, size: 21, color: C.text, width: INNER - 60 }) + 10;
      r.attention.forEach((q, i) => {
        g.text(`${i + 1}.`, PAD + 30, top + h, { weight: 800, size: 19, color: C.red, width: 40 });
        h += g.text(q.text, PAD + 70, top + h, { weight: 500, size: 19, color: C.text2, width: INNER - 100, max: 2 }) + 8;
      });
    } else {
      h += g.text('Соңғы тапсыруда қате жауап жоқ. Жарайсың!', PAD + 30, top + h, { weight: 800, size: 21, color: C.ok, width: INNER - 60 });
    }
    return h;
  });
  y += 36;
  y += footer(g, y, `Есеп жасалды: ${dayTitle(almatyDay(r.generated_at))}, ${almatyTime(r.generated_at)} (Алматы уақыты). Тек аяқталған тапсырулар есептеледі. QADAM.`);
  return Math.ceil(y);
}

const almatyDay = (iso) => {
  const o = almatyParts(new Date(iso));
  return `${o.year}-${o.month}-${o.day}`;
};

// ─── Report for one day ───────────────────────────────────────────
const pagesText = (pages) => {
  const out = [];
  for (let i = 0; i < pages.length; i += 1) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j += 1;
    out.push(i === j ? `${pages[i]}` : `${pages[i]}–${pages[j]}`);
    i = j;
  }
  return out.join(', ');
};

function dayLayout(g, r) {
  const a = r.activity;
  let y = header(g, 'КҮНДЕЛІКТІ ЕСЕП', [
    { text: r.student, weight: 900, size: 44, color: C.white, gap: 14, lh: 1.15 },
    { text: dayTitle(r.day), weight: 700, size: 24, color: C.onDark2, gap: 0 },
  ]);
  y += 40;
  const tiles = [
    ['Белсенді уақыт', minutes(a.active_sec)],
    ['Тест', String(a.tests_done)],
    ['Қатемен жұмыс', String(a.reworks_done)],
    ['Кітап', a.pages_read ? `${a.books_opened} · ${a.pages_read} бет` : String(a.books_opened)],
  ];
  const tw = (INNER - 16) / 2;
  tiles.forEach(([label, value], i) => {
    const x = PAD + (i % 2) * (tw + 16);
    const ty = y + Math.floor(i / 2) * 128;
    g.rect(x, ty, tw, 112, i === 0 ? C.ink : C.white, 18);
    if (i) g.stroke(x, ty, tw, 112, C.line, 18, 2);
    g.text(value, x + 24, ty + 20, { weight: 900, size: 36, color: i === 0 ? C.white : C.text, width: tw - 48, lh: 1.1 });
    g.text(label.toUpperCase(), x + 24, ty + 72, { weight: 800, size: 15, color: i === 0 ? C.onDark2 : C.muted, width: tw - 48 });
  });
  y += 128 * 2 + 4;
  const parts = [a.test_sec ? `тест ${minutes(a.test_sec)}` : '', a.reading_sec ? `кітап оқу ${minutes(a.reading_sec)}` : ''].filter(Boolean);
  if (parts.length) y += g.text(`Оның ішінде: ${parts.join(' · ')}`, PAD, y, { weight: 600, size: 20, color: C.text2 });
  y += 36;

  const list = (title, items, empty, row) => {
    y += g.section(title, y);
    if (!items.length) {
      y += g.card(y, (top) => g.text(empty, PAD + 30, top, { weight: 600, size: 21, color: C.text2, width: INNER - 60 }), { pad: 24 }) + 34;
      return;
    }
    for (const it of items) y += g.card(y, (top) => row(it, top), { pad: 24, accent: C.red }) + 14;
    y += 22;
  };
  list('Тапсырылған тесттер', r.tests, 'Бүгін тест тапсырылмады.', (t, top) => {
    const p = g.pill(`${t.last.percent}%`, PAD + INNER - 28, top - 2, scoreColors(t.last.percent), { right: true });
    let h = g.text(t.title, PAD + 36, top, { weight: 800, size: 25, width: INNER - 80 - p.w });
    const meta = [t.title !== t.topic_title ? t.topic_title : '', gradeLabel(t.grade), t.publisher].filter(Boolean).join(' | ');
    if (meta) h += 4 + g.text(meta, PAD + 36, top + h + 4, { weight: 600, size: 18, color: C.muted, width: INNER - 70 });
    h += 10 + g.text(`${t.last.correct} дұрыс · ${t.last.wrong} қате · ${t.last.total} сұрақ`, PAD + 36, top + h + 10, { weight: 700, size: 20, color: C.text2, width: INNER - 70 });
    h += 4 + g.text(t.times > 1 ? `Бүгін ${t.times} рет: ${t.attempts.map((x) => `${x.percent}%`).join(' → ')}` : 'Бүгін 1 рет тапсырылды', PAD + 36, top + h + 4, { weight: 600, size: 18, color: C.muted, width: INNER - 70 });
    return h + 4;
  });
  list('Қате сұрақтармен жұмыс', r.reworks, 'Қате сұрақтармен жұмыс орындалмады.', (t, top) => {
    const fixed = t.attempts.reduce((s, x) => s + x.correct, 0);
    const total = t.attempts.reduce((s, x) => s + x.total, 0);
    const pct = total ? Math.round((fixed / total) * 100) : 0;
    const p = g.pill(`${pct}%`, PAD + INNER - 28, top - 2, scoreColors(pct), { right: true });
    let h = g.text(t.title, PAD + 36, top, { weight: 800, size: 25, width: INNER - 80 - p.w });
    h += 10 + g.text(`${t.times} рет · ${fixed}/${total} қате түзетілді`, PAD + 36, top + h + 10, { weight: 700, size: 20, color: C.text2, width: INNER - 70 });
    return h + 4;
  });
  list('Оқылған кітаптар', r.books, 'Бүгін кітап ашылмады.', (b, top) => {
    let h = g.text(b.title, PAD + 36, top, { weight: 800, size: 25, width: INNER - 70 });
    const meta = [b.subject, gradeLabel(b.grade), b.publisher].filter(Boolean).join(' | ');
    if (meta) h += 4 + g.text(meta, PAD + 36, top + h + 4, { weight: 600, size: 18, color: C.muted, width: INNER - 70 });
    // Opening a book is not reading it: pages are named only when time was spent on them.
    const line = b.pages_read
      ? `${b.pages_read} бет оқылды (${pagesText(b.pages)}) · ${minutes(b.reading_sec)}`
      : b.reading_sec
        ? `Кітап ашылды · ${minutes(b.reading_sec)} · толық оқылған бет жоқ`
        : 'Кітап ашылды · оқу уақыты есептелмеді';
    h += 10 + g.text(line, PAD + 36, top + h + 10, { weight: 700, size: 20, color: C.text2, width: INNER - 70 });
    return h + 4;
  });
  y += footer(
    g,
    y,
    `Есеп жасалды: ${dayTitle(r.day)}, ${almatyTime(r.generated_at)} (Алматы уақыты). Белсенді уақыт сайт ашық тұрып, оқушы әрекет еткенде ғана есептеледі; бет 30 секундтан көп оқылса ғана «оқылды» деп саналады.`,
  );
  return Math.ceil(y);
}

// ─── Overview: everything at a glance ─────────────────────────────
const BOOK_STATUS = {
  not_started: ['Оқылмаған', [C.text2, C.canvas]],
  reading: ['Оқылып жатыр', [C.mid, C.midBg]],
  finished: ['Аяқталды', [C.ok, C.okBg]],
};
const shortDay = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  return `${d}.${String(m).padStart(2, '0')}`;
};
const WEEK_SHORT = ['Жс', 'Дс', 'Сс', 'Ср', 'Бс', 'Жм', 'Сн'];

function overviewLayout(g, r) {
  const s = r.summary;
  let y = header(g, 'КУРАТОРҒА ЕСЕП', [
    { text: r.student, weight: 900, size: 44, color: C.white, gap: 14, lh: 1.15 },
    { text: 'QADAM платформасындағы оқу белсенділігі', weight: 700, size: 24, color: C.white, gap: 8 },
    { text: r.last_activity_at ? `Соңғы белсенділік: ${dbDateTime(r.last_activity_at.slice(0, 19).replace('T', ' '))}` : 'Белсенділік әлі тіркелмеген', weight: 600, size: 20, color: C.onDark2, gap: 0 },
  ]);
  y += 40;

  // Key figures: six cards.
  y += g.section('Негізгі көрсеткіштер', y);
  const tiles = [
    ['Тапсырған тест', String(s.attempts), s.tests_done ? `${s.tests_done} түрлі тест` : '', C.ink],
    ['Аяқталған', String(s.finished), '', C.white],
    ['Аяқталмаған', String(s.unfinished), s.unfinished ? 'басталып, жіберілмеген' : '', C.white],
    ['Орташа нәтиже', s.average_percent === null ? '—' : `${s.average_percent}%`, 'аяқталған тесттер', C.white],
    ['Оқыған кітап', `${s.books_finished}`, s.books_opened ? `${s.books_opened} кітап ашылған` : 'кітап ашылмаған', C.white],
    ['Сайттағы уақыт', minutes(s.total_sec), 'барлығы', C.white],
  ];
  const tw = (INNER - 2 * 16) / 3;
  tiles.forEach(([label, value, sub, bg], i) => {
    const x = PAD + (i % 3) * (tw + 16);
    const ty = y + Math.floor(i / 3) * 150;
    const dark = bg === C.ink;
    g.rect(x, ty, tw, 134, bg, 18);
    if (!dark) g.stroke(x, ty, tw, 134, C.line, 18, 2);
    const color = label === 'Орташа нәтиже' && s.average_percent !== null ? scoreColors(s.average_percent)[0] : dark ? C.white : C.text;
    g.text(value, x + 22, ty + 18, { weight: 900, size: value.length > 8 ? 26 : 38, color, width: tw - 44, lh: 1.1 });
    g.text(label.toUpperCase(), x + 22, ty + 70, { weight: 800, size: 14, color: dark ? C.onDark2 : C.muted, width: tw - 44 });
    if (sub) g.text(sub, x + 22, ty + 94, { weight: 600, size: 15, color: dark ? C.onDark2 : C.muted, width: tw - 44, max: 1 });
  });
  y += 150 * 2 + 24;

  // Time on the site: today, this week, all; and the last 7 days.
  y += g.section('Сайтта өткізген уақыт', y, 'Тек бет ашық тұрып, оқушы әрекет еткен уақыт');
  y += g.card(y, (top) => {
    const cw = (INNER - 60 - 2 * 16) / 3;
    [['Бүгін', s.today_sec], ['Осы аптада', s.week_sec], ['Жалпы', s.total_sec]].forEach(([label, sec], i) => {
      const x = PAD + 30 + i * (cw + 16);
      g.rect(x, top, cw, 100, C.paper, 14);
      g.text(minutes(sec), x + 18, top + 16, { weight: 900, size: 28, color: C.text, width: cw - 36, lh: 1.1 });
      g.text(label.toUpperCase(), x + 18, top + 62, { weight: 800, size: 14, color: C.muted, width: cw - 36 });
    });
    let h = 124;
    const max = Math.max(60, ...r.week.map((d) => d.sec));
    const ch = 150;
    const bw = (INNER - 60) / 7;
    r.week.forEach((d, i) => {
      const x = PAD + 30 + i * bw;
      const bh = d.sec ? Math.max(6, (ch * d.sec) / max) : 0;
      g.rect(x + bw * 0.22, top + h + ch - bh, bw * 0.56, bh, d.day === r.today ? C.red : '#c9c5bd', 8);
      if (!d.sec) g.rect(x + bw * 0.22, top + h + ch - 3, bw * 0.56, 3, C.line, 2);
      if (d.sec) g.text(minutes(d.sec).replace(' мин', 'м').replace(' сағ ', 'с '), x, top + h + ch - bh - 26, { weight: 800, size: 15, color: C.text, width: bw, align: 'center' });
      const [yy, mm, dd] = d.day.split('-').map(Number);
      const wd = WEEK_SHORT[new Date(Date.UTC(yy, mm - 1, dd)).getUTCDay()];
      g.text(`${wd} ${shortDay(d.day)}`, x, top + h + ch + 10, { weight: 700, size: 14, color: d.day === r.today ? C.text : C.muted, width: bw, align: 'center' });
    });
    h += ch + 40;
    const parts = [s.test_sec ? `тест тапсыру ${minutes(s.test_sec)}` : '', s.reading_sec ? `кітап оқу ${minutes(s.reading_sec)}` : ''].filter(Boolean);
    if (parts.length) h += g.text(`Жалпы уақыттың ішінде: ${parts.join(' · ')}`, PAD + 30, top + h, { weight: 600, size: 18, color: C.text2, width: INNER - 60 });
    return h;
  });
  y += 40;

  // Tests: trend and history.
  const done = r.history.filter((h) => h.status === 'finished');
  y += g.section('Тапсырылған тесттер', y, r.history.length ? `${s.finished} аяқталған · ${s.unfinished} аяқталмаған` : '');
  y += g.card(y, (top) => {
    if (!r.history.length) return g.text('Әзірге тест тапсырылмаған.', PAD + 30, top, { weight: 600, size: 21, color: C.text2, width: INNER - 60 });
    let h = 0;
    if (done.length > 1) {
      const shown = done.slice(0, 15).reverse();
      const cx0 = PAD + 30 + 56;
      const cw = INNER - 60 - 56 - 20;
      const ch = 160;
      for (const v of [0, 50, 100]) {
        const gy = top + 10 + ch - (ch * v) / 100;
        g.line([[cx0, gy], [cx0 + cw, gy]], C.line, 2, v === 50 ? [6, 8] : []);
        g.text(`${v}%`, PAD + 30, gy - 11, { weight: 700, size: 16, color: C.muted, width: 50 });
      }
      const step = shown.length > 1 ? cw / (shown.length - 1) : 0;
      const pts = shown.map((a, i) => [cx0 + i * step, top + 10 + ch - (ch * a.percent) / 100]);
      g.line(pts, C.red, 4);
      pts.forEach(([px, py]) => g.dot(px, py, 7, C.white, C.red));
      h += ch + 30;
      h += g.text(`Соңғы ${shown.length} аяқталған тесттің нәтижесі (ескіден жаңаға)`, PAD + 30, top + h, { weight: 500, size: 17, color: C.muted }) + 14;
    }
    const rows = r.history.slice(0, 15);
    rows.forEach((t, i) => {
      const ry = top + h;
      if (i) g.rect(PAD + 30, ry - 1, INNER - 60, 1, C.line);
      const pill = t.status === 'finished' ? [`${t.percent}%`, scoreColors(t.percent)] : ['Аяқталмады', [C.text2, C.canvas]];
      const pw = g.width(pill[0], 900, 17) + 17 * 1.2;
      g.pill(pill[0], PAD + INNER - 30, ry + 12, pill[1], { size: 17, right: true });
      let rh = 12 + g.text(t.title, PAD + 30, ry + 12, { weight: 800, size: 20, color: C.text, width: INNER - 60 - pw - 20, max: 2 });
      const meta =
        t.status === 'finished'
          ? `${dbDateTime(t.at)} · ${Math.round(t.score * 100) / 100}/${t.max_score} ұпай · ${testTime(t.duration_sec)} · аяқталды`
          : `${dbDateTime(t.at)} · басталды, бірақ жіберілмеді`;
      rh += 4 + g.text(meta, PAD + 30, ry + rh + 4, { weight: 500, size: 17, color: C.text2, width: INNER - 60 - pw - 20 });
      h += Math.max(rh, 40) + 14;
    });
    if (r.history.length > rows.length) h += g.text(`Барлығы ${r.history.length} жазба, соңғы ${rows.length} көрсетілген.`, PAD + 30, top + h + 4, { weight: 500, size: 17, color: C.muted }) + 8;
    return h;
  });
  y += 40;

  // Books with their reading status.
  y += g.section('Кітаптар', y, 'Кітапты ашу оны оқып шықты дегенді білдірмейді: бет 30 секундтан көп оқылса ғана есептеледі');
  if (!r.books.length) {
    y += g.card(y, (top) => g.text('Әзірге кітап жарияланбаған.', PAD + 30, top, { weight: 600, size: 21, color: C.text2, width: INNER - 60 }), { pad: 24 }) + 14;
  }
  for (const b of r.books) {
    y +=
      g.card(
        y,
        (top) => {
          const [label, colors] = BOOK_STATUS[b.status];
          const pw = g.width(label, 900, 18) + 18 * 1.2;
          g.pill(label, PAD + INNER - 28, top - 2, colors, { size: 18, right: true });
          let h = g.text(b.title, PAD + 36, top, { weight: 800, size: 23, width: INNER - 90 - pw, max: 2 });
          const meta = [gradeLabel(b.grade), b.publisher].filter(Boolean).join(' | ');
          if (meta) h += 4 + g.text(meta, PAD + 36, top + h + 4, { weight: 600, size: 17, color: C.muted, width: INNER - 70 });
          if (b.page_count) {
            const by = top + h + 16;
            const bw = INNER - 70 - 200;
            g.rect(PAD + 36, by, bw, 16, C.canvas, 8);
            if (b.pages_read) g.rect(PAD + 36, by, Math.max(16, (bw * b.progress) / 100), 16, colors[0] === C.text2 ? '#b9b8b4' : colors[0], 8);
            g.text(`${b.pages_read}/${b.page_count} бет · ${b.progress}%`, PAD + 36 + bw + 14, by - 5, { weight: 800, size: 17, color: C.text, width: 190 });
            h += 16 + 16;
          }
          const facts =
            b.status === 'not_started'
              ? 'Әлі ашылмаған'
              : [b.started_at ? `Бастаған: ${dbDateTime(b.started_at)}` : '', b.last_opened_at ? `Соңғы ашқан: ${dbDateTime(b.last_opened_at)}` : '', `Оқу уақыты: ${minutes(b.reading_sec)}`]
                  .filter(Boolean)
                  .join(' · ');
          h += 10 + g.text(facts, PAD + 36, top + h + 10, { weight: 600, size: 17, color: C.text2, width: INNER - 70 });
          return h + 2;
        },
        { pad: 22, accent: BOOK_STATUS[b.status][1][0] === C.text2 ? C.line : BOOK_STATUS[b.status][1][0] },
      ) + 12;
  }
  y += 28;
  y += footer(
    g,
    y,
    `Есеп жасалды: ${dayTitle(almatyDay(r.generated_at))}, ${almatyTime(r.generated_at)} (Алматы уақыты). Уақыт 15 секундтық аралықпен, бет ашық тұрып оқушы әрекет еткенде ғана есептеледі; ұзақ әрекетсіздік, екі вкладка және бірнеше құрылғы уақытты екі есе санамайды. Кітап беттерінің 90%-ы оқылғанда «Аяқталды» деп саналады.`,
  );
  return Math.ceil(y);
}

/** Renders a report ('test' or 'day') to a canvas at 2× for sharp text. */
export async function drawReport(kind, r) {
  // Kazakh letters come from the site's own Montserrat files; wait for every weight used.
  const sample = 'ҚқӘәҒғҮүҰұІіӨөҺһҢң QADAM 0123%';
  await Promise.all([500, 600, 700, 800, 900].map((w) => document.fonts.load(`${w} 24px Montserrat`, sample).catch(() => null)));
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const layout = kind === 'test' ? testLayout : kind === 'overview' ? overviewLayout : dayLayout;
  canvas.width = W * 2;
  canvas.height = 10;
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  const g = painter(ctx);
  g.draw = false;
  const height = layout(g, r);
  // 2× for sharp text, but a long report stays within what phones allow for one canvas (~16 Mpx).
  const scale = Math.min(2, Math.sqrt(16_000_000 / (W * height)));
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(height * scale);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, W, height);
  g.draw = true;
  layout(g, r);
  return canvas;
}

/** A one-page PDF holding the report picture (JPEG), page width A4. */
export async function pdfFromCanvas(canvas) {
  const jpeg = new Uint8Array(await (await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.92))).arrayBuffer());
  const pw = 595.28;
  const ph = Math.round(((pw * canvas.height) / canvas.width) * 100) / 100;
  const enc = new TextEncoder();
  const parts = [];
  const offsets = [];
  let length = 0;
  const push = (chunk) => {
    const bytes = typeof chunk === 'string' ? enc.encode(chunk) : chunk;
    parts.push(bytes);
    length += bytes.length;
  };
  const obj = (n, body, stream = null) => {
    offsets[n] = length;
    push(`${n} 0 obj\n${body}\n`);
    if (stream) {
      push('stream\n');
      push(stream);
      push('\nendstream\n');
    }
    push('endobj\n');
  };
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  obj(4, `<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`, jpeg);
  const content = enc.encode(`q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`);
  obj(5, `<< /Length ${content.length} >>`, content);
  const xref = length;
  push(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}
