const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const pad2 = (n) => String(n).padStart(2, '0');

export const initials = (name) =>
  String(name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

export const MONTHS = ['қаңтар', 'ақпан', 'наурыз', 'сәуір', 'мамыр', 'маусым', 'шілде', 'тамыз', 'қыркүйек', 'қазан', 'қараша', 'желтоқсан'];

/** SQLite UTC "YYYY-MM-DD HH:MM:SS" → "21 қазан 2026, 19:40" in local time. */
export function formatDate(value) {
  const d = new Date(String(value).replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export const formatDuration = (sec) => {
  const s = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(s / 60)}:${pad2(s % 60)}`;
};

export const scoreBadge = (percent) => {
  if (percent === null || percent === undefined) return '';
  const cls = percent >= 80 ? 'badge-ok' : percent >= 50 ? 'badge-mid' : 'badge-bad';
  return `<span class="badge ${cls}">${percent}%</span>`;
};

/** Lesson text: "## " headings, "- " bullets, blank-line paragraphs. Everything is escaped. */
export function renderProse(text) {
  const out = [];
  let list = null;
  const flush = () => {
    if (list) out.push(`<ul>${list.join('')}</ul>`);
    list = null;
  };
  for (const block of String(text).split(/\n{2,}/)) {
    for (const raw of block.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('## ')) {
        flush();
        out.push(`<h2>${esc(line.slice(3))}</h2>`);
      } else if (line.startsWith('- ')) {
        (list ||= []).push(`<li>${esc(line.slice(2))}</li>`);
      } else {
        flush();
        out.push(`<p>${esc(line)}</p>`);
      }
    }
    flush();
  }
  return out.join('');
}
