// School grades and the textbook a test or a book is based on.
// The same lists are in public/assets/js/catalog.js for the pages.

export const SUBJECT = 'Қазақстан тарихы';
export const GRADES = [5, 6, 7, 8, 9, 10, 11];
/** A topic belongs to one of these grade and publisher pairs (6–11-сынып × Атамұра, Мектеп). */
export const TOPIC_GRADES = [6, 7, 8, 9, 10, 11];
export const TOPIC_PUBLISHERS = ['Атамұра', 'Мектеп'];

/** Suggested publishers; any other name can be typed. */
export const PUBLISHERS = ['Атамұра', 'Мектеп', 'Алматыкітап'];

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** A grade from 5 to 11, or null when not chosen. Anything else is an error text. */
export function gradeOf(value) {
  if (value === null || value === undefined || value === '') return { value: null };
  const n = Number(value);
  return GRADES.includes(n) ? { value: n } : { error: 'Сыныпты тізімнен таңдаңыз (5–11-сынып).' };
}

/** A publisher: a suggested one (spelled as in the list) or any other name. */
export function publisherOf(value) {
  const s = clean(value);
  if (!s) return { value: '' };
  if (s.length > 80) return { error: 'Баспа атауы тым ұзын (ең көбі 80 таңба).' };
  return { value: PUBLISHERS.find((p) => p.toLowerCase() === s.toLowerCase()) || s };
}

const text = (value, max, label) => {
  const s = clean(value);
  return s.length > max ? { error: `«${label}» тым ұзын (ең көбі ${max} таңба).` } : { value: s };
};

/** The textbook a test is based on: every field is optional. */
export function textbookOf(body) {
  const year = String(body?.book_year ?? '').trim();
  const thisYear = new Date().getFullYear();
  if (year && !(/^\d{4}$/.test(year) && Number(year) >= 1950 && Number(year) <= thisYear + 1)) {
    return { error: `Оқулықтың шыққан жылын 4 цифрмен жазыңыз (1950–${thisYear + 1}).` };
  }
  const out = { book_year: year ? Number(year) : null };
  for (const [key, max, label] of [
    ['subject', 120, 'Пән'],
    ['book_authors', 300, 'Оқулық авторлары'],
    ['book_pages', 300, 'Пайдаланылған беттер немесе тақырыптар'],
  ]) {
    const r = text(body?.[key], max, label);
    if (r.error) return r;
    out[key] = r.value;
  }
  return { value: out };
}
