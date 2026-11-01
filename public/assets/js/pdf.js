// pdf.js, served from /assets/vendor/pdfjs (copied from the pdfjs-dist package), loaded only when needed.

const BASE = '/assets/vendor/pdfjs/';
let lib = null;

export async function pdfjs() {
  if (!lib) {
    lib = await import(`${BASE}pdf.min.mjs`);
    lib.GlobalWorkerOptions.workerSrc = `${BASE}pdf.worker.min.mjs`;
  }
  return lib;
}

export const DOC_OPTIONS = {
  cMapUrl: `${BASE}cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${BASE}standard_fonts/`,
  wasmUrl: `${BASE}wasm/`,
  iccUrl: `${BASE}iccs/`,
  enableXfa: false,
};

/**
 * Fonts a PDF uses without carrying them inside the file. pdf.js can draw a page exactly only
 * with the fonts the PDF contains; a font that is only named is replaced by the device's font of
 * that name or a similar one, so the letters may look different from the original. Checks up to
 * `maxPages` pages spread over the book. Returns { missing: [font names], checked: pages }.
 */
export async function fontReport(doc, maxPages = 24) {
  const { OPS } = await pdfjs();
  const total = doc.numPages;
  const step = Math.max(1, total / maxPages);
  const pages = [...new Set(Array.from({ length: Math.min(total, maxPages) }, (_, i) => Math.min(total, 1 + Math.floor(i * step))))];
  const missing = new Set();
  for (const n of pages) {
    const page = await doc.getPage(n);
    const ops = await page.getOperatorList();
    for (let i = 0; i < ops.fnArray.length; i += 1) {
      if (ops.fnArray[i] !== OPS.setFont) continue;
      const fontId = ops.argsArray[i][0];
      if (!page.commonObjs.has(fontId)) continue;
      const font = page.commonObjs.get(fontId);
      if (font?.missingFile && !font.isType3Font) missing.add(String(font.name || fontId).replace(/^[A-Z]{6}\+/, ''));
    }
    page.cleanup();
  }
  return { missing: [...missing].sort(), checked: pages.length };
}

/** Opens a local PDF file (organizer upload check): its page count and font report, or throws. */
export async function inspectPdf(file) {
  const { getDocument } = await pdfjs();
  const task = getDocument({ ...DOC_OPTIONS, data: new Uint8Array(await file.arrayBuffer()) });
  try {
    const doc = await task.promise;
    const fonts = await fontReport(doc).catch(() => null);
    return { pages: doc.numPages, fonts };
  } finally {
    task.destroy();
  }
}

/** Opens a local PDF file: resolves with its page count, or throws. */
export async function countPages(file) {
  return (await inspectPdf(file)).pages;
}

/**
 * Opens a book PDF that the server keeps in chunks: only the chunks of the pages being shown
 * are downloaded (browsers cache them, the URL names the file).
 */
export async function openChunked(url, { size, chunk_size: chunkSize }, onProgress = () => {}) {
  const { getDocument, PDFDataRangeTransport } = await pdfjs();
  const cache = new Map();
  let loaded = 0;
  const fetchChunk = (i) => {
    if (!cache.has(i)) {
      const p = fetch(`${url}/${i}`, { credentials: 'same-origin' }).then(async (res) => {
        if (!res.ok) throw new Error('Кітап бөлігі жүктелмеді.');
        const buf = new Uint8Array(await res.arrayBuffer());
        loaded += buf.length;
        onProgress(loaded, size);
        return buf;
      });
      p.catch(() => cache.delete(i));
      cache.set(i, p);
    }
    return cache.get(i);
  };
  const range = async (begin, end) => {
    const first = Math.floor(begin / chunkSize);
    const last = Math.floor((end - 1) / chunkSize);
    const parts = await Promise.all(Array.from({ length: last - first + 1 }, (_, k) => fetchChunk(first + k)));
    const out = new Uint8Array(end - begin);
    let at = 0;
    parts.forEach((part, k) => {
      const start = (first + k) * chunkSize;
      const from = Math.max(begin, start) - start;
      const to = Math.min(end, start + part.length) - start;
      out.set(part.subarray(from, to), at);
      at += to - from;
    });
    return out;
  };
  const initial = await fetchChunk(0);
  class Transport extends PDFDataRangeTransport {
    requestDataRange(begin, end) {
      // One retry for a dropped connection; the page then waits for the next request.
      range(begin, end)
        .catch(() => new Promise((r) => setTimeout(r, 1500)).then(() => range(begin, end)))
        .then((data) => this.onDataRange(begin, data))
        .catch(() => onProgress(-1, size));
    }
  }
  const transport = new Transport(size, initial);
  const task = getDocument({ ...DOC_OPTIONS, range: transport, rangeChunkSize: 65536, disableAutoFetch: true, disableStream: true, length: size });
  return { task, doc: await task.promise };
}
