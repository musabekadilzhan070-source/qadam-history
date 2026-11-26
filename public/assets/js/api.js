export class ApiError extends Error {
  constructor(message, status, data = {}) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function request(method, url, body) {
  const headers = { Accept: 'application/json' };
  if (method !== 'GET') headers['X-Qadam'] = '1';
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  } catch {
    throw new ApiError('Сервермен байланыс жоқ. Интернетті тексеріп, қайталаңыз.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || 'Қате шықты.', res.status, data);
  return data;
}

// Pages already opened (or about to be: see prefetch) answer from memory for a short while, so moving
// between sections does not wait on the server each time. Anything the student changes clears it.
// Requests that start something (a test, a quiz, a link, a rework) or report the session are never kept.
const FRESH_MS = 45_000;
const NEVER = /^\/api\/(me$|auth\/|tests\/\d+|quizzes\/\d+$|link\/|results\/\d+\/rework|feedback)/;
const cache = new Map();
let seen = null;

function cachedGet(url) {
  seen?.add(url);
  return load(url);
}

function load(url) {
  if (NEVER.test(url.split('?')[0])) return request('GET', url);
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.promise.then(copy);
  const promise = request('GET', url);
  cache.set(url, { at: Date.now(), promise });
  promise.catch(() => cache.get(url)?.promise === promise && cache.delete(url));
  return promise.then(copy);
}
// Views may change what they get (sorting, answers): each one gets its own copy.
const copy = (data) => structuredClone(data);

async function write(method, url, body, { keepCache = false } = {}) {
  if (keepCache) return request(method, url, body);
  cache.clear();
  try {
    return await request(method, url, body);
  } finally {
    cache.clear();
  }
}

export const api = {
  get: cachedGet,
  post: (url, body = {}, opts) => write('POST', url, body, opts),
  patch: (url, body = {}, opts) => write('PATCH', url, body, opts),
  /** Forgets every kept answer (sign-out, or a page's «refresh»). */
  forget: () => cache.clear(),
  /** Runs fn and returns the GET urls it asked for (the router learns what each page needs). */
  async track(fn) {
    const mine = new Set();
    seen = mine;
    try {
      return { result: await fn(), urls: mine };
    } finally {
      if (seen === mine) seen = null;
    }
  },
  /** Starts the given GETs now so the next page finds them ready; errors stay quiet. */
  prefetch(urls) {
    for (const url of urls) if (!NEVER.test(url.split('?')[0])) load(url).catch(() => {});
  },
};
