import { api } from './api.js';
import { esc } from './util.js';
import { icon, periodEmblem } from './art.js';
import { emblemSvg } from './emblems.js';

// Texts the organizer can change. The defaults are the site's original wording, so an
// untouched site looks exactly as before. The cabinet builds its form from this list.
export const TEXT_FIELDS = [
  { group: 'Басты баннер', fields: [
    ['banner_kicker', 'Баннердің үстіңгі жазуы', 'QADAM · Қазақстан тарихы'],
    ['banner_line1', 'Тақырыптың 1-жолы', 'Өткенді таны.'],
    ['banner_line2', 'Тақырыптың 2-жолы', 'Тарихты түсін.'],
    ['banner_line3', 'Тақырыптың 3-жолы (қызыл)', 'Болашаққа қадам бас.'],
    ['banner_text', 'Баннер сипаттамасы', 'Қазақстан тарихын жүйелі меңгеріп, біліміңді тақырыптық тесттер арқылы шыңда.', 'long'],
    ['banner_button', 'Баннер батырмасы', 'Оқуды бастау'],
  ] },
  { group: 'Басты беттің бөлімдері', fields: [
    ['periods_eyebrow', 'Кезеңдер бөлімінің үстіңгі жазуы', 'Төрт кезең'],
    ['periods_title', 'Кезеңдер бөлімінің атауы', 'Тарихи кезеңдер'],
    ['periods_more', '«Барлық кезеңдер» сілтемесі', 'Барлық кезеңдер'],
    ['period_button', 'Кезең картасының батырмасы', 'Тақырыптарды көру'],
    ['how_eyebrow', 'Оқу жолы бөлімінің үстіңгі жазуы', 'Оқу жолы'],
    ['how_title', 'Оқу жолы бөлімінің атауы', 'Қалай оқимыз'],
    ['step1_title', '1-қадам атауы', 'Кезеңді таңда'],
    ['step1_text', '1-қадам мәтіні', 'Ежелгі заманнан бүгінге дейінгі төрт кезеңнің бірін аш.', 'long'],
    ['step2_title', '2-қадам атауы', 'Тақырыпты оқы'],
    ['step2_text', '2-қадам мәтіні', 'Тақырыптың қысқаша түсіндірмесі және есте сақтайтын даталар.', 'long'],
    ['step3_title', '3-қадам атауы', 'Тест тапсыр'],
    ['step3_text', '3-қадам мәтіні', 'Жауаптарыңды тексеріп, қателерді түсініктемесімен бірге қара.', 'long'],
  ] },
  { group: 'Мәзір атаулары', fields: [
    ['nav_home', 'Басты бет', 'Басты бет'],
    ['nav_periods', 'Тарихи кезеңдер', 'Тарихи кезеңдер'],
    ['nav_tests', 'Тесттер', 'Тесттер'],
    ['nav_results', 'Менің нәтижелерім', 'Менің нәтижелерім'],
    ['nav_feedback', 'Ұсыныстар', 'Ұсыныстар'],
    ['nav_profile', 'Профиль', 'Профиль'],
  ] },
  { group: 'Бөлім беттері', fields: [
    ['periods_page_text', '«Тарихи кезеңдер» бетінің сипаттамасы', 'Кезеңді таңдап, оның тақырыптарын ретімен оқып, әр тақырып бойынша тест тапсыр.', 'long'],
    ['tests_page_text', '«Тесттер» бетінің сипаттамасы', 'Әр тақырыптың өз тесті бар. Кезеңді таңдап, тестті бастаңыз. Нәтиже мен қателердің түсініктемесі тест соңында көрсетіледі.', 'long'],
    ['footer', 'Сайттың төменгі жазуы', 'QADAM · Қазақстан тарихын оқуға және тест тапсыруға арналған білім платформасы', 'long'],
  ] },
];

const DEFAULTS = Object.fromEntries(TEXT_FIELDS.flatMap((g) => g.fields.map(([key, , value]) => [key, value])));

// Icon slots the organizer can override: the menu icons and the four period emblems.
export const ICON_SLOTS = [
  ['nav.home', 'Мәзір: Басты бет', 'home'],
  ['nav.periods', 'Мәзір: Тарихи кезеңдер', 'periods'],
  ['nav.tests', 'Мәзір: Тесттер', 'tests'],
  ['nav.results', 'Мәзір: Менің нәтижелерім', 'results'],
  ['nav.feedback', 'Мәзір: Ұсыныстар', 'feedback'],
  ['nav.profile', 'Мәзір: Профиль', 'profile'],
  ['period.1', '1-кезең эмблемасы', 'emblem-1'],
  ['period.2', '2-кезең эмблемасы', 'emblem-2'],
  ['period.3', '3-кезең эмблемасы', 'emblem-3'],
  ['period.4', '4-кезең эмблемасы', 'emblem-4'],
];

export const fileUrl = (id) => `/api/files/${encodeURIComponent(id)}`;

/** Renders an icon setting ({kind:'builtin'|'emblem'|'file', name|id, size}) or the given fallback. */
export function renderIcon(setting, fallback, cls = 'icon') {
  const value = setting || (fallback ? { kind: 'builtin', name: fallback } : null);
  if (!value) return '';
  const size = value.size ? ` style="width:${Number(value.size)}px;height:${Number(value.size)}px"` : '';
  if (value.kind === 'file') return `<img class="${cls} icon-file" src="${fileUrl(value.id)}" alt=""${size} />`;
  if (value.kind === 'emblem') return emblemSvg(value.name, `${cls} emblem-icon`, size ? size.slice(8, -1) : '');
  const emblem = /^emblem-(\d)$/.exec(value.name || '');
  if (emblem) {
    const out = periodEmblem(Number(emblem[1]), cls === 'icon' ? 'icon' : cls);
    return size ? out.replace('<svg ', `<svg${size} `) : out;
  }
  const out = icon(value.name, cls);
  return size ? out.replace('<svg ', `<svg${size} `) : out;
}

export const site = {
  texts: {},
  icons: {},
  async load() {
    try {
      const data = await api.get('/api/site');
      site.texts = data.texts || {};
      site.icons = data.icons || {};
    } catch {
      site.texts = {};
      site.icons = {};
    }
  },
  /** The organizer's text for a key (escaped), or the original wording. */
  t(key) {
    return esc(site.texts[key] || DEFAULTS[key] || '');
  },
  navIcon(key, fallback) {
    return renderIcon(site.icons[`nav.${key}`], fallback);
  },
  /** Period emblem; an override keeps the emblem's place and size on the card. */
  emblem(number, cls = 'emblem') {
    const own = site.icons[`period.${number}`];
    if (!own) return periodEmblem(number, cls);
    return renderIcon({ ...own, size: null }, null, cls);
  },
};
