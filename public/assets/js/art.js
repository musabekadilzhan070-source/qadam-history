// Line-art graphics: ornament, icons, period emblems and the banner composition.
// Everything is inline SVG drawn with currentColor, so CSS sets the palette.

const svg = (viewBox, body, cls = '') =>
  `<svg class="${cls}" viewBox="${viewBox}" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

// Қошқар мүйіз: one ram-horn pair, the base unit of the ornament band.
const HORN = 'M20 24V15C20 7 28 3 34 6C39 9 38 16 33 16C30 16 29.5 12.5 32 12M20 15C20 7 12 3 6 6C1 9 2 16 7 16C10 16 10.5 12.5 8 12';

export const ornamentMark = (cls = '') => svg('0 0 40 26', `<path d="${HORN}" stroke-width="2.6"/>`, cls);

export const ornamentBand = (cls = '') =>
  `<svg class="${cls}" aria-hidden="true" focusable="false" width="100%" height="26">
    <defs><pattern id="horn-band" width="48" height="26" patternUnits="userSpaceOnUse">
      <path d="${HORN}" transform="translate(4 0)" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    </pattern></defs>
    <rect width="100%" height="26" fill="url(#horn-band)"/>
  </svg>`;

// Navigation icons (24×24, 1.8 stroke).
const ICONS = {
  home: '<path d="M4 11 12 4l8 7"/><path d="M6 10v10h12V10"/><path d="M10 20v-6h4v6"/>',
  periods: '<path d="M4 20h16"/><path d="M6 20V9M10 20V9M14 20V9M18 20V9"/><path d="M3 9h18L12 3z"/>',
  tests: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="m8.5 11 1.5 1.5L13 9.5"/><path d="M8.5 16.5h7"/>',
  materials: '<path d="M4 5.5C6.5 4.5 9.5 4.5 12 6c2.5-1.5 5.5-1.5 8-.5V19c-2.5-1-5.5-1-8 .5-2.5-1.5-5.5-1.5-8-.5z"/><path d="M12 6v13.5"/>',
  results: '<path d="M4 20h16"/><path d="M7 20v-6M12 20V8M17 20v-9"/>',
  profile: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1.3-3.6 4.2-5.4 7.5-5.4s6.2 1.8 7.5 5.4"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 2.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  cross: '<path d="M6 6l12 12M18 6 6 18"/>',
  logout: '<path d="M14 4h5v16h-5"/><path d="M10 8l-4 4 4 4M6 12h10"/>',
  book: '<path d="M6 4h11a1 1 0 0 1 1 1v15H7a2 2 0 0 1-2-2V5a1 1 0 0 1 1-1z"/><path d="M5 18a2 2 0 0 1 2-2h11"/>',
};

export const icon = (name, cls = 'icon') =>
  `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;

// Period emblems (200×160). 1: kurgan under the sun, 2: Khoja Ahmed Yasawi mausoleum,
// 3: a sealed manuscript, 4: Bayterek tower.
const EMBLEMS = {
  1: `
    <path d="M8 142h184" stroke-width="2"/>
    <path d="M22 142c22-34 50-50 78-50s56 16 78 50" stroke-width="3"/>
    <path d="M50 142c14-20 31-29 50-29s36 9 50 29" stroke-width="2" opacity=".7"/>
    <circle cx="100" cy="48" r="17" stroke-width="3"/>
    <circle cx="100" cy="48" r="7" stroke-width="2"/>
    <path d="M100 18v-8M100 86v-8M70 48h-8M138 48h-8M79 27l-6-6M127 75l-6-6M121 27l6-6M73 75l6-6" stroke-width="2.4"/>
    <path d="M26 128l6-10 6 10M162 128l6-10 6 10" stroke-width="2" opacity=".7"/>`,
  2: `
    <path d="M8 142h184" stroke-width="2"/>
    <path d="M34 142V40h86v102" stroke-width="3"/>
    <path d="M28 40h98" stroke-width="2.4"/>
    <path d="M58 142V86c0-18 9-30 19-36 10 6 19 18 19 36v56" stroke-width="2.6"/>
    <path d="M68 142V96c0-10 4-17 9-21 5 4 9 11 9 21v46" stroke-width="1.8" opacity=".7"/>
    <path d="M28 40V30M126 40V30" stroke-width="2.4"/>
    <path d="M120 142V90h52v52" stroke-width="2.4"/>
    <path d="M118 90c4-30 18-46 28-46s24 16 28 46" stroke-width="3"/>
    <path d="M146 44v-10M134 90c2-16 6-30 12-38M158 90c-2-16-6-30-12-38" stroke-width="1.6" opacity=".7"/>
    <path d="M44 54h66M44 62h66" stroke-width="1.4" opacity=".6"/>`,
  3: `
    <path d="M52 22h96v116H52z" stroke-width="3"/>
    <path d="M44 22c0-6 4-10 8-10h96c4 0 8 4 8 10s-4 10-8 10M44 22c0 6 4 10 8 10" stroke-width="2.4"/>
    <path d="M44 138c0 6 4 10 8 10h96c4 0 8-4 8-10" stroke-width="2.4"/>
    <path d="M66 50h68M66 62h68M66 74h52M66 86h68M66 98h40" stroke-width="2" opacity=".75"/>
    <circle cx="122" cy="116" r="15" stroke-width="3"/>
    <path d="M122 106l3 6.5 7 .8-5.2 4.8 1.4 7-6.2-3.5-6.2 3.5 1.4-7-5.2-4.8 7-.8z" stroke-width="1.6"/>
    <path d="M168 18 128 70M168 18c6 10 2 22-10 30" stroke-width="2.2"/>`,
  4: `
    <path d="M8 146h184" stroke-width="2"/>
    <path d="M92 146c2-30 4-58 4-86M108 146c-2-30-4-58-4-86" stroke-width="3"/>
    <path d="M96 60c-6-6-16-10-26-10M104 60c6-6 16-10 26-10M96 66c-10-2-22 0-30 6M104 66c10-2 22 0 30 6" stroke-width="2.2"/>
    <path d="M70 50c4-18 16-30 30-30s26 12 30 30" stroke-width="2.2" opacity=".75"/>
    <circle cx="100" cy="40" r="16" stroke-width="3"/>
    <path d="M18 146v-18h12v18M36 146v-30h14v30M150 146v-24h12v24M168 146v-36h14v36" stroke-width="1.8" opacity=".7"/>`,
};

export const periodEmblem = (n, cls = 'emblem') => svg('0 0 200 160', EMBLEMS[n] || EMBLEMS[1], cls);

export const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];

// Banner: fragment of a map of the Kazakh Khanate's Syr Darya towns with the Yasawi mausoleum.
export const bannerArt = () => `
<svg class="banner-art" viewBox="0 0 640 380" aria-hidden="true" focusable="false" fill="none" stroke-linecap="round" stroke-linejoin="round">
  <g class="map-grid" stroke-width="1">
    <path d="M40 60c180-30 400-30 600 0M20 140c200-28 420-28 620 0M0 220c210-26 430-26 640 0M0 300c210-24 430-24 640 0"/>
    <path d="M120 0c-20 120-20 260 0 380M260 0c-12 120-12 260 0 380M400 0c-4 120-4 260 0 380M540 0c8 120 8 260 0 380"/>
  </g>
  <path class="map-river" d="M10 340c60-10 90-40 130-70s90-30 130-62 70-74 120-96 120-20 170-58" stroke-width="2.2" stroke-dasharray="1 7"/>
  <g class="map-towns">
    <circle cx="140" cy="270" r="4"/><circle cx="268" cy="210" r="4"/><circle cx="352" cy="140" r="4"/><circle cx="458" cy="104" r="4"/>
  </g>
  <g class="map-labels">
    <text x="150" y="292">ОТЫРАР</text><text x="226" y="236">ТҮРКІСТАН</text><text x="364" y="166">САУРАН</text><text x="430" y="92">СЫҒАНАҚ</text>
  </g>
  <g class="banner-rosette" stroke-width="1.4">
    <circle cx="470" cy="190" r="150"/><circle cx="470" cy="190" r="118" stroke-dasharray="2 6"/>
  </g>
  <g class="banner-monument" stroke-width="2.4">
    <path class="fill" d="M352 380V196h120v184zM472 380V266h112v114zM470 266c8-62 38-96 58-96s50 34 58 96z"/>
    <path d="M344 196h136M352 196v-18M472 196v-18M352 380V196h120v184"/>
    <path d="M384 380V284c0-30 14-50 28-60 14 10 28 30 28 60v96" />
    <path d="M396 380v-84c0-18 7-30 16-36 9 6 16 18 16 36v84" opacity=".55"/>
    <path d="M472 380V266h112v114M470 266c8-62 38-96 58-96s50 34 58 96M528 170v-18M500 266c3-34 13-62 28-80M556 266c-3-34-13-62-28-80" />
    <path d="M366 214h92M366 226h92" opacity=".5" stroke-width="1.4"/>
  </g>
  <g class="banner-lines">
    <path d="M592 380 640 296" stroke-width="5"/><path d="M570 380 640 258" stroke-width="1.4"/>
  </g>
</svg>`;
