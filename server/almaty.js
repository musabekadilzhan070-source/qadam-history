// Calendar days in the Asia/Almaty time zone. A student's day starts at midnight in Almaty,
// whatever the server's own time zone is. Database times (created_at) are UTC 'YYYY-MM-DD HH:MM:SS'.

export const TIME_ZONE = 'Asia/Almaty';

const parts = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function fields(ms) {
  const o = {};
  for (const p of parts.formatToParts(new Date(ms))) o[p.type] = p.value;
  return o;
}

/** 'YYYY-MM-DD' of the given moment in Almaty. */
export function dayOf(ms = Date.now()) {
  const f = fields(ms);
  return `${f.year}-${f.month}-${f.day}`;
}

/** Seconds since Almaty midnight. */
export function secondOfDay(ms = Date.now()) {
  const f = fields(ms);
  return Number(f.hour) * 3600 + Number(f.minute) * 60 + Number(f.second);
}

/** Offset of Almaty from UTC at a moment, in milliseconds. */
function offsetAt(ms) {
  const f = fields(ms);
  const asUtc = Date.UTC(Number(f.year), Number(f.month) - 1, Number(f.day), Number(f.hour), Number(f.minute), Number(f.second));
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** The UTC range [from, to) of an Almaty day, as database time strings. */
export function utcRangeOf(day) {
  const [y, m, d] = day.split('-').map(Number);
  const startGuess = Date.UTC(y, m - 1, d);
  const start = startGuess - offsetAt(startGuess);
  const endGuess = Date.UTC(y, m - 1, d + 1);
  const end = endGuess - offsetAt(endGuess);
  const sql = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
  return [sql(start), sql(end)];
}

export const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
