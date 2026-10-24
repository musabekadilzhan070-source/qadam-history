import { EMBLEMS } from '../public/assets/js/emblems.js';

// Emblems for the topics that came with the site. A topic without its own icon gets one of these,
// or a stable pick from the library by its slug, so every topic shows an emblem.
const BY_SLUG = {
  'tas-zhane-kola-dauirleri': 'a-petroglyph-deer',
  'saktar-uysinder-kanlylar': 's-golden-helmet',
  'turik-kaganaty': 't-wolf-standard',
  'kazak-handygynyn-kuryluy': 'k-banners',
  'zhongar-shapkynshylygy': 'd-anyrakay',
  'resei-otarlauy-koterilister': 'up-kenesary',
  'alash-kozgalysy': 'al-crescent',
  'kenestik-dauir': 'sv-factory',
  'zheltoksan-zhane-poligon': 'i-zheltoksan',
  'tauelsiz-kazakstan': 'i-baiterek',
};

export function defaultTopicEmblem(slug) {
  let name = BY_SLUG[slug];
  if (!name) {
    let h = 0;
    for (const ch of String(slug)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    name = EMBLEMS[h % EMBLEMS.length].id;
  }
  return { kind: 'emblem', name };
}
