// server/http.mjs — small helpers around node:http (no framework).
import { gunzipSync, gzipSync } from 'node:zlib';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Reads the request body (gunzipped when sent with Content-Encoding: gzip), at most `limit` bytes. */
export async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, 'Request body too large');
    chunks.push(c);
  }
  let buf = Buffer.concat(chunks);
  const enc = String(req.headers['content-encoding'] || '').toLowerCase();
  if (enc === 'gzip') {
    try {
      buf = gunzipSync(buf, { maxOutputLength: limit * 4 });
    } catch {
      throw new HttpError(400, 'Invalid gzip body');
    }
  } else if (enc && enc !== 'identity') throw new HttpError(415, `Unsupported content encoding ${enc}`);
  return buf;
}

export async function readJson(req, limit = 1024 * 1024) {
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

/** Sends a JSON body (pass a string to send pre-serialized JSON); gzipped when large and accepted. */
export function sendJson(req, res, status, body, headers = {}) {
  let buf = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const h = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers };
  if (buf.length > 2048 && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) {
    buf = gzipSync(buf, { level: 6 });
    h['content-encoding'] = 'gzip';
    h.vary = 'Accept-Encoding';
  }
  h['content-length'] = buf.length;
  res.writeHead(status, h);
  res.end(req.method === 'HEAD' ? undefined : buf);
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Path and query of a request URL without trusting the Host header. */
export function splitUrl(url) {
  const [path, query = ''] = String(url || '/').split('?', 2);
  return { path: path.replace(/\/{2,}/g, '/'), query: new URLSearchParams(query) };
}

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.task': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
  '.gz': 'application/gzip',
  '.bin': 'application/octet-stream',
};
