// School grades and the textbook a test or a book is based on (the same lists as server/catalog.js).
import { esc } from './util.js';

export const SUBJECT = 'Қазақстан тарихы';
export const GRADES = [5, 6, 7, 8, 9, 10, 11];
export const PUBLISHERS = ['Атамұра', 'Мектеп', 'Алматыкітап'];

export const gradeLabel = (g) => (g ? `${g}-сынып` : '');

const hasBook = (x) => Boolean(x?.grade || x?.publisher || x?.subject || x?.book_year || x?.book_authors || x?.book_pages);

/** «Қазақстан тарихы | 7-сынып | Атамұра», or '' when the test has no textbook information. */
export const tagLine = (x, subject = SUBJECT) =>
  x?.grade || x?.publisher || x?.subject ? [x.subject || subject, gradeLabel(x.grade), x.publisher].filter(Boolean).join(' | ') : '';

/** Full textbook information as label/value rows (only the filled ones). */
export const bookRows = (x) =>
  hasBook(x)
    ? [
        ['Пән', x.subject || SUBJECT],
        ['Сынып', gradeLabel(x.grade)],
        ['Баспа', x.publisher],
        ['Шыққан жылы', x.book_year ? String(x.book_year) : ''],
        ['Авторлары', x.book_authors],
        ['Пайдаланылған беттер / тақырыптар', x.book_pages],
      ].filter(([, v]) => v)
    : [];

/** A compact block with the textbook a test is based on, for the test page. */
export const bookBox = (x) => {
  const rows = bookRows(x);
  return rows.length
    ? `<details class="book-box"><summary><span class="book-box-label">Оқулық</span> ${esc(tagLine(x))}</summary>
        <dl>${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></details>`
    : '';
};
