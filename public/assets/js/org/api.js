import { ApiError } from '../api.js';

// Cabinet requests: JSON both ways, the CSRF header on every write, raw bodies for uploads.
let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => {
  onUnauthorized = fn;
};

async function request(method, url, body, { raw = false, headers = {} } = {}) {
  const h = { Accept: 'application/json', ...headers };
  if (method !== 'GET') h['X-Qadam'] = '1';
  if (body !== undefined && !raw) h['Content-Type'] = 'application/json';
  if (raw) h['Content-Type'] = 'application/octet-stream';
  let res;
  try {
    res = await fetch(url, { method, headers: h, body: raw ? body : body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  } catch {
    throw new ApiError('Сервермен байланыс жоқ. Интернетті тексеріп, қайталаңыз.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.endsWith('/login')) onUnauthorized();
  if (!res.ok) {
    const err = new ApiError(data.error || (res.status === 413 ? 'Файл тым үлкен.' : 'Қате шықты.'), res.status);
    err.data = data;
    throw err;
  }
  return data;
}

const BASE = '/api/org';
export const org = {
  get: (path) => request('GET', BASE + path),
  post: (path, body = {}) => request('POST', BASE + path, body),
  put: (path, body = {}) => request('PUT', BASE + path, body),
  del: (path) => request('DELETE', BASE + path),
  /** Sends a File as the raw request body; the server checks its real type and size. */
  upload: (path, file, method = null) => request(method || (path.includes('/content') ? 'PUT' : 'POST'), BASE + path, file, { raw: true, headers: { 'X-File-Name': encodeURIComponent(file.name || '') } }),
};
