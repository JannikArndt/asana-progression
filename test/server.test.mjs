// test/server.test.mjs — the server end to end over HTTP, with a software passkey (ES256,
// attestation "none"): setup token, sign-in, push/pull, files, share links.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createApp } from '../server/index.mjs';

const ORIGIN = 'https://asana.test';
let dir, app, server, base;

// ---- a minimal CBOR encoder (maps, ints, byte and text strings) -----------------------------
function head(major, n) {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 256) return Buffer.from([(major << 5) | 24, n]);
  const b = Buffer.alloc(3);
  b[0] = (major << 5) | 25;
  b.writeUInt16BE(n, 1);
  return b;
}
function cbor(v) {
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === 'string') return Buffer.concat([head(3, Buffer.byteLength(v)), Buffer.from(v)]);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error('cbor: unsupported');
}

class SoftPasskey {
  constructor() {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.key = privateKey;
    const jwk = publicKey.export({ format: 'jwk' });
    this.cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
    this.id = randomBytes(16);
    this.count = 0;
  }
  rpHash() {
    return createHash('sha256').update(new URL(ORIGIN).hostname).digest();
  }
  client(type, challenge) {
    return Buffer.from(JSON.stringify({ type, challenge, origin: ORIGIN, crossOrigin: false }));
  }
  register(options) {
    const authData = Buffer.concat([this.rpHash(), Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), Buffer.from([0, 16]), this.id, this.cose]);
    const att = cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
    const id = this.id.toString('base64url');
    return {
      id,
      rawId: id,
      type: 'public-key',
      clientExtensionResults: {},
      response: { clientDataJSON: this.client('webauthn.create', options.challenge).toString('base64url'), attestationObject: att.toString('base64url'), transports: ['internal'] },
    };
  }
  login(options) {
    const count = Buffer.alloc(4);
    count.writeUInt32BE(++this.count);
    const authData = Buffer.concat([this.rpHash(), Buffer.from([0x05]), count]);
    const cd = this.client('webauthn.get', options.challenge);
    const sig = sign('sha256', Buffer.concat([authData, createHash('sha256').update(cd).digest()]), this.key);
    const id = this.id.toString('base64url');
    return {
      id,
      rawId: id,
      type: 'public-key',
      clientExtensionResults: {},
      response: { clientDataJSON: cd.toString('base64url'), authenticatorData: authData.toString('base64url'), signature: sig.toString('base64url') },
    };
  }
}

async function call(path, { method = 'GET', body, cookie, headers = {}, raw } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { origin: ORIGIN, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, headers: res.headers, json: type.includes('json') ? await res.json() : null, res };
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'asana-server-'));
  const dist = join(dir, 'dist');
  mkdirSync(dist);
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>app</title>');
  writeFileSync(join(dist, 'share.html'), '<!doctype html><title>x</title><!--OG-->');
  writeFileSync(join(dist, 'version.json'), JSON.stringify({ build: 'abc123abc123', version: 't', builtAt: 'now' }));
  app = createApp({ port: 0, dataDir: join(dir, 'data'), distDir: dist, origin: ORIGIN, rpId: 'asana.test', setupToken: 'let-me-in' });
  server = createServer(app.handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  app.close();
  rmSync(dir, { recursive: true, force: true });
});

const pk = new SoftPasskey();
let cookie = '';

test('/version and static files', async () => {
  const v = await call('/version');
  assert.equal(v.json.build, 'abc123abc123');
  const index = await call('/');
  assert.equal(index.status, 200);
  assert.equal((await call('/../package.json')).status, 404);
  assert.equal((await call('/api/nope')).status, 404);
});

test('the first passkey needs the setup token', async () => {
  assert.deepEqual((await call('/api/auth/state')).json, { app: 'asana-progression', signedIn: false, hasPasskey: false, build: 'abc123abc123' });
  assert.equal((await call('/api/auth/register/options', { method: 'POST', body: { setupToken: 'wrong' } })).status, 403);
  const opts = await call('/api/auth/register/options', { method: 'POST', body: { setupToken: 'let-me-in' } });
  assert.equal(opts.status, 200);
  const done = await call('/api/auth/register/verify', { method: 'POST', body: { response: pk.register(opts.json), name: 'test' } });
  assert.equal(done.status, 200, JSON.stringify(done.json));
  cookie = done.headers.get('set-cookie').split(';')[0];
  assert.equal((await call('/api/auth/state', { cookie })).json.signedIn, true);
  // With a passkey on the server the token no longer helps.
  assert.equal((await call('/api/auth/register/options', { method: 'POST', body: { setupToken: 'let-me-in' } })).status, 401);
});

test('sign in with the passkey; a replayed challenge fails', async () => {
  const opts = await call('/api/auth/login/options', { method: 'POST', body: {} });
  const response = pk.login(opts.json);
  const ok = await call('/api/auth/login/verify', { method: 'POST', body: { response } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.match(ok.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
  assert.equal((await call('/api/auth/login/verify', { method: 'POST', body: { response } })).status, 401);
});

test('push and pull records by revision, gzip bodies, deletes as tombstones', async () => {
  assert.equal((await call('/api/sync/pull')).status, 401);
  const ops = [
    { store: 'asanas', key: 'navasana', body: { id: 'navasana', name: 'Navasana', sided: false } },
    { store: 'sessions', key: 'ses_1', body: { id: 'ses_1', date: '2026-11-01T07:00:00+01:00', note: 'private', videoIds: ['vid_1'], location: { name: 'Home', lat: 1, lon: 2 } } },
    { store: 'holds', key: 'h1', body: { id: 'h1', sessionId: 'ses_1', videoId: 'vid_1', asanaId: 'navasana', side: null, startS: 10, endS: 30, bestS: 20, clipStartS: 0, clipEndS: 0, crop: { auto: { x: 0.1, y: 0.1, w: 0.5, h: 0.8 } } } },
    { store: 'holds', key: 'h2', body: { id: 'h2', sessionId: 'ses_1', videoId: 'vid_1', asanaId: 'navasana', side: null, startS: 40, endS: 60, bestS: 50, clipStartS: 0, clipEndS: 0, crop: {} } },
    { store: 'assets', key: 'a1', body: { id: 'a1', holdId: 'h1', kind: 'still', mime: 'image/jpeg', width: 100, height: 80, bytes: 3, storageKey: 'assets/a1.jpg' } },
    { store: 'settings', key: 'clipQuality', body: { key: 'clipQuality', value: '720p' } },
  ];
  const pushed = await call('/api/sync/push', { method: 'POST', cookie, raw: gzipSync(JSON.stringify({ ops })), headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' } });
  assert.equal(pushed.status, 200, JSON.stringify(pushed.json));
  assert.equal(pushed.json.rev, 6);
  assert.equal((await call('/api/sync/push', { method: 'POST', cookie, body: { ops: [{ store: 'holds', key: 'x', body: { id: 'y' } }] } })).status, 400);
  assert.equal((await call('/api/sync/push', { method: 'POST', cookie, body: { ops: [{ store: 'jobs', key: 'x', body: { videoId: 'x' } }] } })).status, 400);
  await call('/api/sync/push', { method: 'POST', cookie, body: { ops: [{ store: 'settings', key: 'clipQuality', deleted: true }] } });

  const all = await call('/api/sync/pull?since=0', { cookie });
  assert.equal(all.json.records.length, 6);
  assert.equal(all.json.rev, 7);
  assert.deepEqual(all.json.records.at(-1), { store: 'settings', key: 'clipQuality', rev: 7, deleted: true });
  const later = await call('/api/sync/pull?since=4&limit=1', { cookie });
  assert.equal(later.json.records.length, 1);
  assert.equal(later.json.more, true);
  // A cookie request from another site is refused.
  assert.equal((await call('/api/sync/pull', { cookie, headers: { origin: 'https://evil.test' } })).status, 403);
});

test('files: upload, list, download; keys are checked', async () => {
  const put = await call('/api/files/assets/a1.jpg', { method: 'PUT', cookie, raw: Buffer.from([1, 2, 3]), headers: { 'content-type': 'image/jpeg' } });
  assert.equal(put.status, 200, JSON.stringify(put.json));
  const gz = gzipSync(Buffer.alloc(1000));
  await call('/api/files/samples/vid_1.bin.gz', { method: 'PUT', cookie, raw: gz, headers: { 'x-raw-bytes': '1000' } });
  assert.equal((await call('/api/files/assets/x.exe', { method: 'PUT', cookie, raw: Buffer.from([1]) })).status, 400);
  const list = await call('/api/files?prefix=samples/', { cookie });
  assert.deepEqual(list.json.files, [{ key: 'samples/vid_1.bin.gz', bytes: gz.length, rawBytes: 1000 }]);
  const get = await call('/api/files/assets/a1.jpg', { cookie });
  assert.deepEqual([...new Uint8Array(await get.res.arrayBuffer())], [1, 2, 3]);
  assert.equal((await call('/api/files/assets/a1.jpg')).status, 401);
});

test('no cross-origin access: no CORS headers, no bearer tokens', async () => {
  const pre = await fetch(`${base}/api/sync/push`, { method: 'OPTIONS', headers: { origin: 'https://other.test', 'access-control-request-method': 'POST' } });
  assert.equal(pre.headers.get('access-control-allow-origin'), null);
  assert.equal((await call('/api/sync/status', { headers: { authorization: 'Bearer AAAAA-AAAAA-AAAAA-AAAAA' } })).status, 401);
  assert.equal((await call('/api/sync/push', { method: 'POST', cookie, headers: { origin: 'https://other.test' }, body: { ops: [] } })).status, 403);
  const st = await call('/api/sync/status', { cookie });
  assert.equal(st.json.records.holds, 2);
});

test('share links show photos without notes or places, and can be revoked', async () => {
  const s = await call('/api/shares', { method: 'POST', cookie, body: { kind: 'session', id: 'ses_1' } });
  assert.equal(s.status, 200);
  assert.equal((await call('/api/shares', { method: 'POST', cookie, body: { kind: 'session', id: 'ses_1' } })).json.token, s.json.token, 'one link per session');
  const view = await call(`/api/public/${s.json.token}`);
  assert.equal(view.status, 200);
  const text = JSON.stringify(view.json);
  assert.doesNotMatch(text, /private|Home|lat/);
  assert.equal(view.json.items.length, 1, 'only holds with a picture');
  assert.equal(view.json.items[0].rep, 1);
  assert.equal(view.json.items[0].reps, 2);
  const file = await call(view.json.items[0].still.url);
  assert.equal(file.status, 200);
  assert.equal((await call(`/api/public/${s.json.token}/file/zzz`)).status, 404);
  const page = await call(`/s/${s.json.token}`);
  assert.match(await page.res.text(), /og:image" content="[^"]*\/file\//, 'the thumbnail until the app sends a cropped preview');
  assert.equal((await call(`/api/shares/${s.json.token}/preview`, { method: 'PUT', cookie, raw: Buffer.from([1]), headers: { 'content-type': 'text/plain' } })).status, 415);
  const put = await call(`/api/shares/${s.json.token}/preview`, { method: 'PUT', cookie, raw: Buffer.from([0xff, 0xd8, 0xff]), headers: { 'content-type': 'image/jpeg' } });
  assert.equal(put.status, 200);
  assert.match(await (await call(`/s/${s.json.token}`)).res.text(), /og:image" content="https:\/\/asana\.test\/api\/public\/[\w-]+\/preview\.jpg"/);
  const preview = await call(`/api/public/${s.json.token}/preview.jpg`);
  assert.equal(preview.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual([...new Uint8Array(await preview.res.arrayBuffer())], [0xff, 0xd8, 0xff]);
  assert.equal((await call(`/api/shares/${s.json.token}/preview`, { method: 'PUT', raw: Buffer.from([1]), headers: { 'content-type': 'image/jpeg' } })).status, 401);
  await call(`/api/shares/${s.json.token}`, { method: 'DELETE', cookie });
  assert.equal((await call(`/api/public/${s.json.token}`)).status, 404);
  assert.equal((await call(`/api/public/${s.json.token}/preview.jpg`)).status, 404);
});

test('sign out ends the session', async () => {
  await call('/api/auth/logout', { method: 'POST', cookie, body: {} });
  assert.equal((await call('/api/auth/state', { cookie })).json.signedIn, false);
});
