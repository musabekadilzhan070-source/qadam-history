// Uploaded files live in the database (files.data BLOB), so they persist on Vercel + Turso
// with no extra storage service. Vercel caps a request body at 4.5 MB; limits stay under it.

export const KINDS = {
  image: { label: 'Сурет', limit: '3 МБ', max: 3 * 1024 * 1024, types: ['image/jpeg', 'image/png', 'image/webp'] },
  pdf: { label: 'PDF', limit: '4 МБ', max: 4 * 1024 * 1024, types: ['application/pdf'] },
  icon: { label: 'Белгіше', limit: '300 КБ', max: 300 * 1024, types: ['image/png', 'image/webp', 'image/svg+xml'] },
};

export const UPLOAD_LIMIT = 4 * 1024 * 1024;

/** The real type from the file's first bytes; the browser-sent type is not trusted. */
export function sniff(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length >= 5 && buf.toString('latin1', 0, 5) === '%PDF-') return 'application/pdf';
  const head = buf.toString('utf8', 0, Math.min(buf.length, 512)).trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'image/svg+xml';
  return null;
}

// SVG icons are shown with <img>, which never runs scripts, and are served with a sandbox CSP;
// anything script-like is refused anyway.
const UNSAFE_SVG = /<script|<foreignobject|\bon[a-z]+\s*=|javascript:|<iframe|<embed|<object/i;

/** Returns { mime } or { error } for an upload of the given kind. */
export function checkUpload(kind, buf) {
  const spec = KINDS[kind];
  if (!spec) return { error: 'Файл түрі белгісіз.' };
  if (!buf?.length) return { error: 'Файл бос.' };
  if (buf.length > spec.max) {
    return { error: `${spec.label} көлемі ${spec.limit} аспауы керек.` };
  }
  const mime = sniff(buf);
  if (!mime || !spec.types.includes(mime)) {
    const allowed = { image: 'JPG, PNG немесе WEBP', pdf: 'PDF', icon: 'PNG, WEBP немесе SVG' }[kind];
    return { error: `Бұл форматқа рұқсат жоқ. ${allowed} файлын таңдаңыз.` };
  }
  if (mime === 'image/svg+xml' && UNSAFE_SVG.test(buf.toString('utf8'))) return { error: 'SVG файлында рұқсат етілмеген код бар.' };
  return { mime };
}
