// server/index.mjs — asana-progression on CapRover: serves the built app (dist/), passkey
// sign-in, sync of records and files into the data volume, and unlisted share links.
//
//   node server/index.mjs        (PORT, DATA_DIR, DIST_DIR, ORIGIN, SETUP_TOKEN)
//
// The video analysis stays on the phone; the server only stores what the app sends.
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, createReadStream } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { backupDb, openDb } from './db.mjs';
import { Auth } from './auth.mjs';
import { HttpError, MIME, readJson, sendJson, splitUrl } from './http.mjs';
import { listFiles, pull, push, putFile, sendFile, status } from './sync.mjs';
import { createShare, deleteShare, findShare, hasPreview, listShares, previewKey, shareView, sharedAsset } from './share.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

export function config(env = process.env) {
  const origin = (env.ORIGIN || 'https://asana.jannikarndt.de').replace(/\/$/, '');
  return {
    port: Number(env.PORT || 80),
    dataDir: env.DATA_DIR || join(ROOT, '.data'),
    distDir: env.DIST_DIR || join(ROOT, 'dist'),
    origin,
    rpId: env.RP_ID || new URL(origin).hostname,
    setupToken: env.SETUP_TOKEN || '',
  };
}

function versionOf(distDir) {
  try {
    return JSON.parse(readFileSync(join(distDir, 'version.json'), 'utf8'));
  } catch {
    return { build: 'dev', version: 'dev', builtAt: null };
  }
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function createApp(cfg = config()) {
  mkdirSync(cfg.dataDir, { recursive: true });
  const filesDir = join(cfg.dataDir, 'files');
  const backupsDir = join(cfg.dataDir, 'backups');
  const db = openDb(join(cfg.dataDir, 'asana.sqlite'));
  const auth = new Auth(db, cfg);
  const startedAt = new Date().toISOString();
  const version = versionOf(cfg.distDir);
  const distRoot = resolve(cfg.distDir);

  /** Signed in (cookie) or 401. Throws 403 for a request from another site. */
  function need(req) {
    if (auth.who(req) !== 'session') throw new HttpError(401, 'Sign in first');
    // Cookie requests must come from the app itself (SameSite=Lax plus this: no cross-site writes).
    const o = req.headers.origin;
    if (o && o !== cfg.origin) throw new HttpError(403, 'Wrong origin');
  }

  async function serveStatic(req, res, path) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    let rel;
    try {
      rel = decodeURIComponent(path === '/' ? '/index.html' : path);
    } catch {
      throw new HttpError(400, 'Bad path');
    }
    const file = resolve(distRoot, `.${rel}`);
    if (!file.startsWith(distRoot + sep)) throw new HttpError(404, 'Not found');
    let st;
    try {
      st = statSync(file);
    } catch {
      throw new HttpError(404, 'Not found');
    }
    if (!st.isFile()) throw new HttpError(404, 'Not found');
    const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    const immutable = rel.startsWith('/assets/');
    const headers = {
      'content-type': MIME[extname(file)] || 'application/octet-stream',
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      etag,
    };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      return res.end();
    }
    res.writeHead(200, { ...headers, 'content-length': st.size });
    if (req.method === 'HEAD') return res.end();
    await pipeline(createReadStream(file), res);
  }

  function sharePage(req, res, token) {
    const share = findShare(db, token);
    const view = share ? shareView(db, share) : null;
    let html;
    try {
      html = readFileSync(join(cfg.distDir, 'share.html'), 'utf8');
    } catch {
      throw new HttpError(500, 'The share page is not built');
    }
    const title = view ? view.title : 'Link not available';
    const first = view?.items.find((i) => i.thumb || i.still);
    // The app uploads a cropped picture; until then the uncropped thumbnail.
    const img = view && hasPreview(db, token)
      ? `${cfg.origin}/api/public/${token}/preview.jpg`
      : first
        ? `${cfg.origin}/api/public/${token}/file/${(first.thumb ?? first.still).id}`
        : null;
    const og = [
      `<meta property="og:title" content="${escapeHtml(title)}">`,
      `<meta property="og:type" content="website">`,
      img ? `<meta property="og:image" content="${escapeHtml(img)}">` : '',
      `<meta name="robots" content="noindex">`,
    ].join('');
    html = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`).replace('<!--OG-->', og);
    const buf = Buffer.from(html);
    res.writeHead(view ? 200 : 404, { 'content-type': MIME['.html'], 'content-length': buf.length, 'cache-control': 'no-cache', 'referrer-policy': 'no-referrer' });
    res.end(req.method === 'HEAD' ? undefined : buf);
  }

  async function route(req, res) {
    const { path, query } = splitUrl(req.url);
    const m = req.method;

    if (path === '/version' && (m === 'GET' || m === 'HEAD')) {
      return sendJson(req, res, 200, { ...version, startedAt, node: process.versions.node });
    }

    if (path === '/api/auth/state' && m === 'GET') {
      return sendJson(req, res, 200, { app: 'asana-progression', signedIn: auth.who(req) === 'session', hasPasskey: auth.hasCredentials(), build: version.build });
    }
    if (path === '/api/auth/register/options' && m === 'POST') {
      return sendJson(req, res, 200, await auth.registrationOptions(req, await readJson(req)));
    }
    if (path === '/api/auth/register/verify' && m === 'POST') {
      const body = await readJson(req);
      const wasSignedIn = auth.who(req) === 'session';
      await auth.registrationVerify(req, body);
      const headers = wasSignedIn ? {} : { 'set-cookie': auth.sessionCookie(auth.signIn('passkey created')) };
      return sendJson(req, res, 200, { ok: true }, headers);
    }
    if (path === '/api/auth/login/options' && m === 'POST') {
      return sendJson(req, res, 200, await auth.authenticationOptions());
    }
    if (path === '/api/auth/login/verify' && m === 'POST') {
      await auth.authenticationVerify(await readJson(req));
      return sendJson(req, res, 200, { ok: true }, { 'set-cookie': auth.sessionCookie(auth.signIn('passkey')) });
    }
    if (path === '/api/auth/logout' && m === 'POST') {
      auth.signOut(req);
      return sendJson(req, res, 200, { ok: true }, { 'set-cookie': auth.clearCookie() });
    }
    if (path === '/api/auth/passkeys' && m === 'GET') {
      need(req);
      return sendJson(req, res, 200, { passkeys: auth.passkeys() });
    }

    if (path === '/api/sync/status' && m === 'GET') {
      need(req);
      return sendJson(req, res, 200, status(db));
    }
    if (path === '/api/sync/push' && m === 'POST') {
      need(req);
      const body = await readJson(req, 64 * 1024 * 1024);
      return sendJson(req, res, 200, { rev: push(db, body.ops) });
    }
    if (path === '/api/sync/pull' && m === 'GET') {
      need(req);
      const since = Math.max(0, Number(query.get('since')) || 0);
      const limit = Math.min(5000, Math.max(1, Number(query.get('limit')) || 2000));
      return sendJson(req, res, 200, pull(db, since, limit));
    }
    if (path === '/api/files' && m === 'GET') {
      need(req);
      return sendJson(req, res, 200, { files: listFiles(db, query.get('prefix') || '') });
    }
    if (path.startsWith('/api/files/')) {
      const key = path.slice('/api/files/'.length);
      if (m === 'PUT') {
        need(req);
        const bytes = await putFile(db, filesDir, key, req);
        return sendJson(req, res, 200, { key, bytes });
      }
      if (m === 'GET' || m === 'HEAD') {
        need(req);
        return sendFile(req, res, filesDir, key);
      }
    }

    if (path === '/api/shares' && m === 'GET') {
      need(req);
      return sendJson(req, res, 200, { shares: listShares(db) });
    }
    if (path === '/api/shares' && m === 'POST') {
      need(req);
      const body = await readJson(req);
      const s = createShare(db, body.kind, body.id);
      return sendJson(req, res, 200, { ...s, url: `${cfg.origin}/s/${s.token}` });
    }
    const prev = /^\/api\/shares\/([\w-]+)\/preview$/.exec(path);
    if (prev && m === 'PUT') {
      need(req);
      if (!findShare(db, prev[1])) throw new HttpError(404, 'No such link');
      if (!String(req.headers['content-type'] || '').startsWith('image/jpeg')) throw new HttpError(415, 'Send a JPEG');
      if (Number(req.headers['content-length']) > 8 * 1024 * 1024) throw new HttpError(413, 'Preview too large');
      const bytes = await putFile(db, filesDir, previewKey(prev[1]), req);
      return sendJson(req, res, 200, { bytes });
    }
    if (path.startsWith('/api/shares/') && m === 'DELETE') {
      need(req);
      const token = path.slice('/api/shares/'.length);
      deleteShare(db, token);
      if (/^[\w-]{10,64}$/.test(token)) rmSync(join(filesDir, previewKey(token)), { force: true });
      return sendJson(req, res, 200, { ok: true });
    }

    const pubPreview = /^\/api\/public\/([\w-]+)\/preview\.jpg$/.exec(path);
    if (pubPreview && (m === 'GET' || m === 'HEAD')) {
      if (!findShare(db, pubPreview[1]) || !hasPreview(db, pubPreview[1])) throw new HttpError(404, 'No preview');
      return sendFile(req, res, filesDir, previewKey(pubPreview[1]), { cache: 'public, max-age=300' });
    }
    const pub = /^\/api\/public\/([\w-]+)(?:\/file\/([\w-]+))?$/.exec(path);
    if (pub && (m === 'GET' || m === 'HEAD')) {
      const share = findShare(db, pub[1]);
      if (!share) throw new HttpError(404, 'This link was removed');
      if (!pub[2]) {
        const view = shareView(db, share);
        if (!view) throw new HttpError(404, 'This link was removed');
        const items = view.items.map((i) => ({
          ...i,
          still: i.still && { ...i.still, url: `/api/public/${share.token}/file/${i.still.id}` },
          thumb: i.thumb && { ...i.thumb, url: `/api/public/${share.token}/file/${i.thumb.id}` },
        }));
        return sendJson(req, res, 200, { ...view, items });
      }
      const asset = sharedAsset(db, share, pub[2]);
      if (!asset) throw new HttpError(404, 'Not part of this link');
      return sendFile(req, res, filesDir, asset.storageKey, { cache: 'public, max-age=3600' });
    }
    const sp = /^\/s\/([\w-]+)$/.exec(path);
    if (sp && (m === 'GET' || m === 'HEAD')) return sharePage(req, res, sp[1]);

    if (path.startsWith('/api/')) throw new HttpError(404, 'No such endpoint');
    return serveStatic(req, res, path);
  }

  async function handler(req, res) {
    const t = Date.now();
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'same-origin');
    res.setHeader('x-frame-options', 'DENY');
    try {
      await route(req, res);
    } catch (e) {
      // The client went away mid-download (a closed tab, a cancelled image): nothing to report.
      if (e?.code === 'ERR_STREAM_PREMATURE_CLOSE') return void res.destroy();
      const status = e instanceof HttpError ? e.status : 500;
      if (status >= 500) console.error(`${req.method} ${req.url}:`, e);
      if (!res.headersSent) sendJson(req, res, status, { error: status >= 500 ? 'Server error' : e.message });
      else res.destroy();
    } finally {
      if (req.url?.startsWith('/api/') && !req.url.startsWith('/api/files/')) {
        console.log(`${req.method} ${splitUrl(req.url).path} ${res.statusCode} ${Date.now() - t} ms`);
      }
    }
  }

  const timers = [];
  function startBackups() {
    try {
      backupDb(db, backupsDir, 'start', 5);
    } catch (e) {
      console.error('start backup failed:', e);
    }
    timers.push(
      setInterval(() => {
        try {
          backupDb(db, backupsDir, 'daily', 14);
          auth.pruneTokens();
        } catch (e) {
          console.error('daily backup failed:', e);
        }
      }, 24 * 3600_000).unref(),
    );
  }

  return {
    handler,
    db,
    auth,
    startBackups,
    close() {
      for (const t of timers) clearInterval(t);
      db.close();
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cfg = config();
  if (!existsSync(join(cfg.distDir, 'index.html'))) console.warn(`warning: ${cfg.distDir}/index.html is missing (npm run build)`);
  const app = createApp(cfg);
  app.startBackups();
  const server = createServer(app.handler);
  server.requestTimeout = 0; // large uploads on slow links
  server.headersTimeout = 60_000;
  server.listen(cfg.port, () => console.log(`asana-progression ${versionOf(cfg.distDir).build} on :${cfg.port} for ${cfg.origin}`));
  const stop = (sig) => {
    console.log(`${sig}: closing`);
    server.close(() => {
      app.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}
