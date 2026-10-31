// School grades and textbook publishers (the same lists as server/catalog.js).
import { esc } from './util.js';

export const SUBJECT = 'Қазақстан тарихы';
export const GRADES = [6, 7, 8, 9, 10, 11];
export const PUBLISHERS = ['Атамұра', 'Мектеп'];

export const gradeLabel = (g) => (g ? `${g}-сынып` : '');

/** «Қазақстан тарихы · 6-сынып · Атамұра», or '' when neither grade nor publisher is set. */
export const tagLine = (x, subject = SUBJECT) =>
  x?.grade || x?.publisher ? [subject, gradeLabel(x.grade), x.publisher].filter(Boolean).join(' · ') : '';

/** Small badges for a card: grade and publisher. */
export const tagBadges = (x) =>
  x?.grade || x?.publisher
    ? `<span class="tag-badges">${x.grade ? `<span class="tag">${esc(gradeLabel(x.grade))}</span>` : ''}${x.publisher ? `<span class="tag tag-pub">${esc(x.publisher)}</span>` : ''}</span>`
    : '';
