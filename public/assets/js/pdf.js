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

/** Opens a local PDF file (organizer upload check): resolves with its page count, or throws. */
export async function countPages(file) {
  const { getDocument } = await pdfjs();
  const task = getDocument({ ...DOC_OPTIONS, data: new Uint8Array(await file.arrayBuffer()) });
  try {
    const doc = await task.promise;
    return doc.numPages;
  } finally {
    task.destroy();
  }
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
