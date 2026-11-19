import type { Analysis, Asset } from '../model';
import { isDeviceSetting, sampleFileName, type AssetStore, type BatchOp, type MetadataStore, type OutboxEntry, type SyncedStore } from '../storage';
import { gzip } from './api';
import type { FileOptions, LocalSizes, PulledRecord, PushOp, RemoteFile, SyncApi, SyncProgress } from './types';

export const RECORD_STORES = ['asanas', 'templates', 'sessions', 'videos', 'analyses', 'holds', 'assets'] as const;

/** Server key of a video's analysis frames. */
export const samplesKey = (videoId: string) => `samples/${videoId}.bin.gz`;

/** Pushes are cut into requests of about this much JSON. */
const CHUNK_BYTES = 2 * 1024 * 1024;
const PARALLEL_UPLOADS = 3;

type Progress = (p: SyncProgress) => void;

function wanted(a: Asset, opts: FileOptions): boolean {
  return a.kind !== 'clip' || opts.clips;
}

/** Rough JSON size of a record (typed arrays as base64). */
function sizeOf(value: unknown): number {
  let extra = 0;
  const s = JSON.stringify(value, (_k, v: unknown) => {
    if (ArrayBuffer.isView(v)) {
      extra += Math.ceil((v.byteLength * 4) / 3) + 30;
      return 0;
    }
    return v;
  });
  return (s?.length ?? 0) + extra;
}

async function readRecord(db: MetadataStore, store: SyncedStore, key: string): Promise<unknown> {
  if (store === 'settings') {
    const value = await db.settings.get(key);
    return value === undefined ? undefined : { key, value };
  }
  return db[store].get(key);
}

/** Every synced record on this device, as push operations. */
async function allOps(db: MetadataStore): Promise<PushOp[]> {
  const ops: PushOp[] = [];
  for (const store of RECORD_STORES) {
    for (const r of (await db[store].all()) as unknown as Array<Record<string, unknown>>) {
      const key = String(store === 'analyses' ? r.videoId : r.id);
      ops.push({ store, key, body: r });
    }
  }
  for (const e of await db.settings.entries()) if (!isDeviceSetting(e.key)) ops.push({ store: 'settings', key: e.key, body: e });
  return ops;
}

/** Sends ops in requests of about CHUNK_BYTES; calls `after` with each sent chunk. */
async function pushChunked(api: SyncApi, ops: PushOp[], onProgress?: Progress, after?: (sent: PushOp[]) => Promise<void>): Promise<number> {
  const sizes = ops.map((o) => ('body' in o ? sizeOf(o.body) : 50));
  const bytesTotal = sizes.reduce((a, b) => a + b, 0);
  let rev = 0;
  let bytesDone = 0;
  let i = 0;
  onProgress?.({ phase: 'records', done: 0, total: ops.length, bytesDone, bytesTotal });
  while (i < ops.length) {
    let j = i;
    let bytes = 0;
    while (j < ops.length && (j === i || bytes + sizes[j]! <= CHUNK_BYTES)) bytes += sizes[j++]!;
    const chunk = ops.slice(i, j);
    rev = await api.push(chunk);
    await after?.(chunk);
    bytesDone += bytes;
    i = j;
    onProgress?.({ phase: 'records', done: i, total: ops.length, bytesDone, bytesTotal });
  }
  return rev;
}

interface Upload {
  key: string;
  bytes: number;
  load: () => Promise<{ data: Blob; rawBytes?: number } | null>;
}

/** Uploads in parallel; a file that vanished locally in the meantime is skipped. */
async function runUploads(api: SyncApi, uploads: Upload[], onProgress?: Progress): Promise<number> {
  const bytesTotal = uploads.reduce((a, u) => a + u.bytes, 0);
  let done = 0;
  let bytesDone = 0;
  let sent = 0;
  let next = 0;
  onProgress?.({ phase: 'files', done, total: uploads.length, bytesDone, bytesTotal });
  const worker = async () => {
    while (next < uploads.length) {
      const u = uploads[next++]!;
      const file = await u.load();
      if (file) {
        await api.putFile(u.key, file.data, file.rawBytes);
        sent++;
      }
      done++;
      bytesDone += u.bytes;
      onProgress?.({ phase: 'files', done, total: uploads.length, bytesDone, bytesTotal });
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL_UPLOADS, uploads.length) }, worker));
  return sent;
}

function assetUpload(files: AssetStore, a: Asset): Upload {
  return {
    key: a.storageKey,
    bytes: a.bytes,
    load: async () => {
      const data = await files.get(a.storageKey);
      return data ? { data } : null;
    },
  };
}

async function samplesUpload(files: AssetStore, videoId: string, have: RemoteFile | undefined): Promise<Upload | null> {
  const raw = await files.get(sampleFileName(videoId));
  if (!raw || raw.size === 0 || have?.rawBytes === raw.size) return null;
  return {
    key: samplesKey(videoId),
    // Frames compress to roughly half; the estimate only drives the progress bar.
    bytes: Math.round(raw.size / 2),
    load: async () => {
      const data = (await gzip(raw)) ?? null;
      return data ? { data, rawBytes: raw.size } : null;
    },
  };
}

async function remoteIndex(api: SyncApi): Promise<Map<string, RemoteFile>> {
  return new Map((await api.listFiles('')).map((f) => [f.key, f]));
}

/**
 * Uploads every file the server is missing (assets by key: they never change; frames when their
 * size differs). Returns the number of files sent.
 */
export async function uploadMissingFiles(db: MetadataStore, files: AssetStore, api: SyncApi, opts: FileOptions, onProgress?: Progress): Promise<number> {
  const remote = await remoteIndex(api);
  const uploads: Upload[] = [];
  for (const a of await db.assets.all()) if (wanted(a, opts) && !remote.has(a.storageKey)) uploads.push(assetUpload(files, a));
  if (opts.frames) {
    for (const an of await db.analyses.all()) {
      const u = await samplesUpload(files, an.videoId, remote.get(samplesKey(an.videoId)));
      if (u) uploads.push(u);
    }
  }
  return runUploads(api, uploads, onProgress);
}

/**
 * Everything on this device to the server: missing files first, then every record (the server
 * keeps the newest write per record). Used by the old app's "Move" and a device's first sync.
 */
export async function uploadAll(db: MetadataStore, files: AssetStore, api: SyncApi, opts: FileOptions, onProgress?: Progress): Promise<{ files: number; records: number }> {
  const pending = await db.outbox.list();
  const sentFiles = await uploadMissingFiles(db, files, api, opts, onProgress);
  const ops = await allOps(db);
  await pushChunked(api, ops, onProgress);
  // What was pending before the upload is on the server now (later writes stay pending).
  await db.outbox.ack(pending);
  return { files: sentFiles, records: ops.length };
}

/** Pushes the outbox: the records' files first, then the records; acknowledges per request. */
export async function pushChanges(db: MetadataStore, files: AssetStore, api: SyncApi, opts: FileOptions, onProgress?: Progress): Promise<number> {
  const entries = await db.outbox.list();
  if (!entries.length) return 0;
  const byId = new Map(entries.map((e) => [e.id, e]));
  const ops: PushOp[] = [];
  const assets: Asset[] = [];
  const analyses: string[] = [];
  for (const e of entries) {
    const body = await readRecord(db, e.store, e.key);
    if (body === undefined) ops.push({ store: e.store, key: e.key, deleted: true });
    else {
      ops.push({ store: e.store, key: e.key, body });
      if (e.store === 'assets' && wanted(body as Asset, opts)) assets.push(body as Asset);
      if (e.store === 'analyses' && opts.frames) analyses.push(e.key);
    }
  }
  if (assets.length || analyses.length) {
    const remote = await remoteIndex(api);
    const uploads = assets.filter((a) => !remote.has(a.storageKey)).map((a) => assetUpload(files, a));
    for (const v of analyses) {
      const u = await samplesUpload(files, v, remote.get(samplesKey(v)));
      if (u) uploads.push(u);
    }
    await runUploads(api, uploads, onProgress);
  }
  await pushChunked(api, ops, onProgress, (sent) => db.outbox.ack(sent.map((o) => byId.get(`${o.store}/${o.key}`)!) as OutboxEntry[]));
  return ops.length;
}

export interface PullResult {
  records: number;
  /** Stores that changed (to refresh the screens). */
  stores: Set<SyncedStore>;
  /** Analyses written by the pull (open reviews take them in). */
  analyses: Analysis[];
}

/**
 * Takes in what changed on the server since the last pull (`sync.rev`). Records with a local
 * change still waiting in the outbox are skipped: they go to the server next and win there.
 */
export async function pullChanges(
  db: MetadataStore,
  files: AssetStore,
  api: SyncApi,
  onProgress?: Progress,
  opts: { serverWins?: boolean } = {},
): Promise<PullResult> {
  let since = (await db.settings.get<number>('sync.rev')) ?? 0;
  const result: PullResult = { records: 0, stores: new Set(), analyses: [] };
  for (;;) {
    const page = await api.pull(since);
    // serverWins (a device's first pull): local changes made before it are dropped where the
    // server has the record.
    const pending = opts.serverWins ? new Set<string>() : await db.outbox.pendingIds();
    const overwritten = opts.serverWins ? new Map((await db.outbox.list()).map((e) => [e.id, e])) : null;
    const ops: BatchOp[] = [];
    const goneFiles: string[] = [];
    for (const r of page.records as PulledRecord[]) {
      if (pending.has(`${r.store}/${r.key}`)) continue;
      if (r.store === 'settings' && isDeviceSetting(r.key)) continue;
      if (r.deleted) {
        if (r.store === 'assets') {
          const local = await db.assets.get(r.key);
          if (local) goneFiles.push(local.storageKey);
        }
        ops.push({ store: r.store, delete: r.key });
      } else {
        ops.push({ store: r.store, put: r.body });
        if (r.store === 'analyses') result.analyses.push(r.body as Analysis);
      }
      result.stores.add(r.store);
    }
    await db.batch(ops, { track: false });
    if (overwritten) await db.outbox.ack((page.records as PulledRecord[]).flatMap((r) => overwritten.get(`${r.store}/${r.key}`) ?? []));
    for (const k of goneFiles) await files.delete(k).catch(() => {});
    result.records += ops.length;
    since = page.rev;
    await db.settings.set('sync.rev', since);
    onProgress?.({ phase: 'pull', done: since, total: page.latest, bytesDone: 0, bytesTotal: 0 });
    if (!page.more) break;
  }
  return result;
}

/** Sizes of what an upload would send, for the choices (clips, frames) before it starts. */
export async function localSizes(db: MetadataStore, files: AssetStore): Promise<LocalSizes> {
  const sizes: LocalSizes = { records: 0, images: { count: 0, bytes: 0 }, clips: { count: 0, bytes: 0 }, frames: { count: 0, bytes: 0 } };
  for (const a of await db.assets.all()) {
    const s = a.kind === 'clip' ? sizes.clips : sizes.images;
    s.count++;
    s.bytes += a.bytes;
  }
  for (const an of await db.analyses.all()) {
    const f = await files.get(sampleFileName(an.videoId));
    if (f?.size) {
      sizes.frames.count++;
      sizes.frames.bytes += f.size;
    }
  }
  for (const store of RECORD_STORES) sizes.records += (await db[store].all()).length;
  return sizes;
}
