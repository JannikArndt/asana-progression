// server/sync.mjs — records (push / pull by revision) and files (assets, analysis frames).
import { createReadStream, createWriteStream, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { tx } from './db.mjs';
import { HttpError, MIME } from './http.mjs';

/** Stores the app syncs and the field that is each record's key. */
export const STORES = {
  asanas: 'id',
  templates: 'id',
  sessions: 'id',
  videos: 'id',
  analyses: 'videoId',
  holds: 'id',
  assets: 'id',
  settings: 'key',
};

const KEY = /^[\w.:-]{1,200}$/;
export const FILE_KEY = /^(assets\/[A-Za-z0-9_-]{1,100}\.(jpg|png|webp|mp4|mov|bin)|samples\/[A-Za-z0-9_-]{1,100}\.bin\.gz|previews\/[\w-]{10,64}\.jpg)$/;
export const MAX_FILE_BYTES = 1024 * 1024 * 1024;

/**
 * Applies pushed operations in one transaction; every op gets the next revision.
 * ops: [{ store, key, body } | { store, key, deleted: true }]
 */
export function push(db, ops) {
  if (!Array.isArray(ops)) throw new HttpError(400, 'ops must be an array');
  for (const op of ops) {
    const field = STORES[op?.store];
    if (!field) throw new HttpError(400, `Unknown store ${String(op?.store)}`);
    if (typeof op.key !== 'string' || !KEY.test(op.key)) throw new HttpError(400, `Invalid key in ${op.store}`);
    if (op.deleted) continue;
    if (!op.body || typeof op.body !== 'object' || op.body[field] !== op.key) throw new HttpError(400, `${op.store}/${op.key}: body does not match its key`);
  }
  const at = new Date().toISOString();
  return tx(db, () => {
    let rev = db.prepare('SELECT COALESCE(MAX(rev), 0) AS r FROM records').get().r;
    const up = db.prepare(
      `INSERT INTO records (store, key, rev, deleted, body, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (store, key) DO UPDATE SET rev = excluded.rev, deleted = excluded.deleted, body = excluded.body, updated_at = excluded.updated_at`,
    );
    for (const op of ops) {
      rev++;
      up.run(op.store, op.key, rev, op.deleted ? 1 : 0, op.deleted ? null : JSON.stringify(op.body), at);
    }
    return rev;
  });
}

/**
 * Records changed after `since`, oldest first, up to `limit` records or about `maxBytes`.
 * Returns pre-serialized JSON: { records: [...], rev, more }.
 */
export function pull(db, since, limit = 2000, maxBytes = 8 * 1024 * 1024) {
  const rows = db.prepare('SELECT store, key, rev, deleted, body FROM records WHERE rev > ? ORDER BY rev LIMIT ?').all(since, limit + 1);
  const parts = [];
  let bytes = 0;
  let last = since;
  let more = rows.length > limit;
  for (const r of rows.slice(0, limit)) {
    if (parts.length && bytes + (r.body?.length ?? 0) > maxBytes) {
      more = true;
      break;
    }
    const head = `{"store":${JSON.stringify(r.store)},"key":${JSON.stringify(r.key)},"rev":${r.rev}`;
    parts.push(r.deleted ? `${head},"deleted":true}` : `${head},"body":${r.body}}`);
    bytes += r.body?.length ?? 0;
    last = r.rev;
  }
  const latest = db.prepare('SELECT COALESCE(MAX(rev), 0) AS r FROM records').get().r;
  return `{"records":[${parts.join(',')}],"rev":${last},"latest":${latest},"more":${more}}`;
}

export function status(db) {
  const counts = db.prepare('SELECT store, COUNT(*) AS n FROM records WHERE deleted = 0 GROUP BY store').all();
  const files = db.prepare("SELECT substr(key, 1, instr(key, '/') - 1) AS kind, COUNT(*) AS n, SUM(bytes) AS bytes FROM files GROUP BY kind").all();
  return {
    rev: db.prepare('SELECT COALESCE(MAX(rev), 0) AS r FROM records').get().r,
    records: Object.fromEntries(counts.map((c) => [c.store, c.n])),
    files: Object.fromEntries(files.map((f) => [f.kind, { count: f.n, bytes: f.bytes }])),
  };
}

// ---- files --------------------------------------------------------------------------------

export function listFiles(db, prefix) {
  return db
    .prepare('SELECT key, bytes, raw_bytes AS rawBytes FROM files WHERE key LIKE ? ORDER BY key')
    .all(`${String(prefix || '').replace(/[%_]/g, '')}%`);
}

function checkKey(key) {
  if (!FILE_KEY.test(key)) throw new HttpError(400, 'Invalid file key');
}

/** Streams the request body into the file (temp file, then rename). */
export async function putFile(db, root, key, req) {
  checkKey(key);
  const declared = Number(req.headers['content-length']);
  if (declared > MAX_FILE_BYTES) throw new HttpError(413, 'File too large');
  const raw = req.headers['x-raw-bytes'] === undefined ? null : Number(req.headers['x-raw-bytes']);
  if (raw !== null && !(Number.isSafeInteger(raw) && raw >= 0)) throw new HttpError(400, 'Invalid x-raw-bytes');
  const path = join(root, key);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${randomBytes(6).toString('hex')}`;
  let size = 0;
  const limit = new Transform({
    transform(chunk, _enc, cb) {
      size += chunk.length;
      cb(size > MAX_FILE_BYTES ? new HttpError(413, 'File too large') : null, chunk);
    },
  });
  try {
    await pipeline(req, limit, createWriteStream(tmp, { flags: 'wx' }));
    if (Number.isFinite(declared) && declared !== size) throw new HttpError(400, `Incomplete upload (${size} of ${declared} bytes)`);
    renameSync(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  db.prepare(
    `INSERT INTO files (key, bytes, raw_bytes, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET bytes = excluded.bytes, raw_bytes = excluded.raw_bytes, updated_at = excluded.updated_at`,
  ).run(key, size, raw, new Date().toISOString());
  return size;
}

/** Sends a stored file; asset files never change under their key, so they are cached for good. */
export async function sendFile(req, res, root, key, { cache } = {}) {
  checkKey(key);
  const path = join(root, key);
  let st;
  try {
    st = statSync(path);
  } catch {
    throw new HttpError(404, 'No such file');
  }
  res.writeHead(200, {
    'content-type': MIME[extname(key)] || 'application/octet-stream',
    'content-length': st.size,
    'cache-control': cache ?? (key.startsWith('assets/') ? 'private, max-age=31536000, immutable' : 'no-cache'),
  });
  if (req.method === 'HEAD') return res.end();
  await pipeline(createReadStream(path), res);
}
