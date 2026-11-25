import { HORN } from './art.js';

// The art of the welcome page (/welcome) only: the living ram-horn ornament (қошқар мүйіз)
// and the quiet historical backdrop of the black card. Inline SVG and CSS animation only:
// no images, video or libraries, so the page loads as fast as before. Motion is in qadam.css
// (.welcome …) and stops for prefers-reduced-motion.

// One ram-horn pair split in two, each half from the stem up to its curl, so the light runs
// along both horns at once, as one would draw the ornament by hand.
const HORN_RIGHT = 'M20 24V15C20 7 28 3 34 6C39 9 38 16 33 16C30 16 29.5 12.5 32 12';
const HORN_LEFT = 'M20 24V15C20 7 12 3 6 6C1 9 2 16 7 16C10 16 10.5 12.5 8 12';

const halves = (cls) =>
  [HORN_LEFT, HORN_RIGHT].map((d) => `<path class="${cls}" d="${d}" pathLength="100"/>`).join('');

/** The logo ornament: drawn in, a red light runs along its lines, then a soft glow breathes. */
export const welcomeMark = () => `
  <div class="wl-mark" aria-hidden="true">
    <span class="wl-halo"></span>
    <span class="wl-rule wl-rule-l"><i></i></span>
    <svg class="wl-horn" viewBox="-2 -2 44 30" fill="none" stroke-linecap="round" stroke-linejoin="round" focusable="false">
      ${halves('wl-horn-ghost')}
      ${halves('wl-horn-line')}
      ${halves('wl-horn-light')}
    </svg>
    <span class="wl-rule wl-rule-r"><i></i></span>
  </div>`;

// A four-horn rosette (төрт мүйіз): the same horn turned four times around a centre.
const rosette = (cls) => `
  <svg class="${cls}" viewBox="-50 -50 100 100" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" focusable="false">
    ${[0, 90, 180, 270].map((a) => `<g transform="rotate(${a})"><path d="${HORN}" transform="translate(-20 -46)" stroke-width="1.6"/></g>`).join('')}
    ${[45, 135, 225, 315].map((a) => `<g transform="rotate(${a})"><path d="${HORN}" transform="translate(-10 -34) scale(.5)" stroke-width="2.4"/></g>`).join('')}
    <circle r="15" stroke-width="1.2"/>
    <path d="M0-9 9 0 0 9-9 0Z" stroke-width="1.2"/>
    <circle r="48" stroke-width=".8" stroke-dasharray="1.5 4"/>
  </svg>`;

// Kazakhstan drawn as an old map would show it: a loose outline with the Caspian and the Aral,
// a caravan route of the Great Silk Road and its old towns (Отырар, Түркістан, Тараз).
const MAP = `
  <svg class="wl-map" viewBox="0 0 200 112" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" focusable="false">
    <path class="wl-map-land" pathLength="100" d="M9 47C13 41 17 35 24 29C30 23 35 21 44 22C50 17 57 14 66 18C73 15 80 13 88 19C96 18 102 15 110 17C118 22 126 21 136 22C143 25 150 27 158 29C165 33 170 38 177 41C184 43 190 48 194 55C196 62 191 69 188 75C184 82 179 86 171 92C163 95 157 92 149 97C141 99 133 95 124 99C115 103 106 104 98 100C90 96 84 89 76 85C70 82 66 79 61 81C56 86 51 92 42 97C35 98 29 94 27 88C24 84 21 82 17 81C12 76 10 70 13 64C14 58 10 53 9 47Z"/>
    <path class="wl-map-water" d="M8 50C5 58 6 70 9 80M61 63C66 60 71 62 70 68C69 73 63 74 61 70" stroke-dasharray="2 3"/>
    <path class="wl-map-route" pathLength="100" d="M30 90C48 84 60 92 76 94C92 96 104 90 118 93C132 96 146 90 160 88" stroke-dasharray="1.2 1.6"/>
    <g class="wl-map-towns"><circle cx="92" cy="95" r="1.8"/><circle cx="104" cy="91" r="1.8"/><circle cx="132" cy="94" r="1.8"/></g>
  </svg>`;

// Tamgas of the steppe and Old Turkic runes, drawn as lines (no font needed on any phone).
const SIGNS = [
  '<path d="M7 4v16M7 10l10-6M7 16l10-6"/>',
  '<circle cx="12" cy="12" r="7"/><path d="M12 5v14M5 12h14"/>',
  '<path d="M5 4l7 8-7 8M19 4l-7 8 7 8"/>',
  '<path d="M12 3v18M6 8l6-5 6 5"/>',
  '<path d="M4 20 12 4l8 16M8 13h8"/>',
  '<path d="M6 4v16M6 12h8a4 4 0 0 0 0-8H6"/>',
  '<path d="M12 4a8 8 0 1 0 0 16M12 4v16"/>',
  '<path d="M5 5h14M12 5v14M7 19h10"/>',
];
const SIGN_SPOTS = [
  [7, 18, 0], [86, 14, 2.5], [14, 62, 5], [90, 58, 1.2],
  [78, 86, 3.8], [5, 88, 6.4], [62, 30, 7.6], [30, 40, 9],
];

// Lines of an old manuscript: strokes of writing, not words.
const SCRIPT = `
  <svg class="wl-script" viewBox="0 0 120 60" fill="none" stroke="currentColor" stroke-linecap="round" focusable="false">
    ${[8, 20, 32, 44].map((y, i) => `<path pathLength="100" style="--i:${i}" d="M${4 + i * 3} ${y}c6-4 9 4 15 0s9-5 13 0 8 3 12-1 9-3 13 1 7 2 12-2 8 3 14 0 9-2 ${18 - i * 4}-1"/>`).join('')}
  </svg>`;

// Sparks of red and gold rising slowly through the dark.
const SPARKS = Array.from({ length: 16 }, (_, i) => {
  const x = (i * 37 + 11) % 100;
  const delay = ((i * 1.7) % 9).toFixed(1);
  const dur = (9 + ((i * 5) % 7)).toFixed(1);
  const size = 2 + (i % 3);
  return `<i class="${i % 3 === 0 ? 'is-gold' : ''}" style="--x:${x}%;--d:-${delay}s;--t:${dur}s;--s:${size}px"></i>`;
}).join('');

/** Everything behind the text of the black card. */
export const welcomeBackdrop = () => `
  <div class="wl-bg" aria-hidden="true">
    <span class="wl-glow"></span>
    ${MAP}
    ${rosette('wl-rosette')}
    ${SCRIPT}
    <div class="wl-signs">${SIGN_SPOTS.map(([x, y, d], i) => `<svg viewBox="0 0 24 24" style="--x:${x}%;--y:${y}%;--d:${d}s" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" focusable="false">${SIGNS[i % SIGNS.length]}</svg>`).join('')}</div>
    <div class="wl-sparks">${SPARKS}</div>
  </div>
  <span class="wl-edge" aria-hidden="true"><i></i></span>`;

// ─── The register page (/register): the mausoleum drawn in red light ─────────────
// The same picture as periodEmblem(2) (Қожа Ахмет Ясауи кесенесі), line for line, in the
// order a hand would draw it: the ground, then the portal, walls and doors, then the
// towers and the dome. Then a slow red light walks along the contours; nothing restarts.

const STAGES = [
  // 1. the ground line
  [['M8 142h184', 2]],
  // 2. walls, portal, doors, the inscription bands
  [
    ['M34 142V40h86v102', 3],
    ['M28 40h98', 2.4],
    ['M120 142V90h52v52', 2.4],
    ['M58 142V86c0-18 9-30 19-36 10 6 19 18 19 36v56', 2.6],
    ['M68 142V96c0-10 4-17 9-21 5 4 9 11 9 21v46', 1.8, 0.7],
    ['M44 54h66M44 62h66', 1.4, 0.6],
  ],
  // 3. the towers of the portal, the dome and its ribs
  [
    ['M28 40V30M126 40V30', 2.4],
    ['M118 90c4-30 18-46 28-46s24 16 28 46', 3],
    ['M146 44v-10M134 90c2-16 6-30 12-38M158 90c-2-16-6-30-12-38', 1.6, 0.7],
  ],
];

/** The living mausoleum for the left panel of the register page. */
export const livingMausoleum = () => {
  let i = 0;
  const lines = STAGES.map((stage, s) =>
    stage
      .map(([d, w, o = 1]) => {
        const n = i++;
        return `<path class="lm-line" d="${d}" pathLength="100" stroke-width="${w}" style="--s:${s};--k:${n};--o:${o}"/>`;
      })
      .join(''),
  ).join('');
  i = 0;
  const lights = STAGES.flat()
    .map(([d, w]) => `<path class="lm-light" d="${d}" pathLength="100" stroke-width="${w}" style="--k:${i++}"/>`)
    .join('');
  return `
    <div class="lm-stage" aria-hidden="true">
      <span class="lm-dawn"></span>
      <span class="lm-dome-glow"></span>
      <span class="lm-rays"></span>
      <svg class="emblem lm" viewBox="0 0 200 160" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" focusable="false">
        ${lines}
        <g class="lm-lights">${lights}</g>
      </svg>
    </div>`;
};

/** The faint history behind the mausoleum: the old map, an ornament, writing, sparks. */
export const registerBackdrop = () => `
  <div class="wl-bg lm-bg" aria-hidden="true">
    ${MAP}
    ${rosette('wl-rosette')}
    ${SCRIPT}
    <div class="wl-sparks">${SPARKS}</div>
  </div>`;
