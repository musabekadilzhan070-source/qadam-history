// School grades and textbook publishers a test or a book can be tagged with.
// The same lists are in public/assets/js/catalog.js for the pages.

export const SUBJECT = 'Қазақстан тарихы';
export const GRADES = [6, 7, 8, 9, 10, 11];
export const PUBLISHERS = ['Атамұра', 'Мектеп'];

/** A grade from 6 to 11, or null when not chosen. Anything else is an error text. */
export function gradeOf(value) {
  if (value === null || value === undefined || value === '') return { value: null };
  const n = Number(value);
  return GRADES.includes(n) ? { value: n } : { error: 'Сыныпты тізімнен таңдаңыз (6–11-сынып).' };
}

/** «Атамұра», «Мектеп», or '' when not chosen. */
export function publisherOf(value) {
  const s = String(value ?? '').trim();
  if (!s) return { value: '' };
  const found = PUBLISHERS.find((p) => p.toLowerCase() === s.toLowerCase());
  return found ? { value: found } : { error: 'Баспаны тізімнен таңдаңыз: Атамұра немесе Мектеп.' };
}
