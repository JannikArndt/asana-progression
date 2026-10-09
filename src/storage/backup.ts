/**
 * Backup export/import: one STORE-only ZIP with `backup.json` (every metadata record except
 * processing jobs, plus the settings that are not device-specific) and the asset files under their
 * storage keys; optionally the analysis frame files (`samples-<videoId>.bin`).
 *
 * Import merges by key: records that are new are added, records that differ are replaced by the
 * backup's version. Files are written before records, so an interrupted import leaves at most
 * unreferenced files (removed by Settings → "Remove leftovers"), never records without files; the
 * records are written in one transaction.
 */
import type { Analysis, Asana, Asset, Hold, SequenceTemplate, Session, Video } from '../model/types';
import { sampleFileName } from './samples';
import type { AssetStore, BatchOp, MetadataStore } from './types';
import { crc32Blob, createZip, readZip, type ZipEntry } from './zip';

export const BACKUP_FORMAT = 'asana-progression-backup';
export const BACKUP_VERSION = 1;
export const BACKUP_JSON = 'backup.json';

export const RECORD_STORES = ['asanas', 'templates', 'sessions', 'videos', 'analyses', 'holds', 'assets'] as const;
export type RecordStore = (typeof RECORD_STORES)[number];

export interface BackupRecords {
  asanas: Asana[];
  templates: SequenceTemplate[];
  sessions: Session[];
  videos: Video[];
  analyses: Analysis[];
  holds: Hold[];
  assets: Asset[];
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: string;
  appVersion?: string;
  counts: Record<RecordStore | 'settings', number>;
  includesSamples: boolean;
  files: Array<{ path: string; bytes: number }>;
  /** Asset files referenced by a record but missing on the device that exported. */
  missingFiles: string[];
}

interface BackupJson {
  manifest: BackupManifest;
  records: BackupRecords;
  settings: Array<{ key: string; value: unknown }>;
}

/** Settings that describe the device or the local seed state; never exported or imported. */
export function isDeviceSetting(key: string): boolean {
  return key === 'persistRequested' || key === 'persistGranted' || key === 'catalogVersion' || key.startsWith('diag.') || key.startsWith('backup.');
}

function keyOf(store: RecordStore, record: unknown): string {
  const r = record as { id?: unknown; videoId?: unknown };
  const k = store === 'analyses' ? r.videoId : r.id;
  if (typeof k !== 'string' || !k) throw new Error(`Backup record in "${store}" has no key`);
  return k;
}

// ---- JSON with typed arrays ----------------------------------------------------------------

const TYPED = {
  Float32Array,
  Float64Array,
  Int8Array,
  Int16Array,
  Int32Array,
  Uint8Array,
  Uint16Array,
  Uint32Array,
} as const;
type TypedName = keyof typeof TYPED;

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Typed arrays (Analysis.m/C) become `{$typed, b64}` (little-endian bytes, keeps NaN). */
function replacer(_key: string, value: unknown): unknown {
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    const name = value.constructor.name;
    if (!(name in TYPED)) throw new Error(`Cannot back up ${name}`);
    return { $typed: name, b64: toBase64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) };
  }
  return value;
}

function reviver(_key: string, value: unknown): unknown {
  const v = value as { $typed?: unknown; b64?: unknown } | null;
  if (v && typeof v === 'object' && typeof v.$typed === 'string' && typeof v.b64 === 'string') {
    const Ctor = TYPED[v.$typed as TypedName];
    if (!Ctor) throw new Error(`Unknown typed array ${v.$typed}`);
    const bytes = fromBase64(v.b64);
    return new Ctor(bytes.buffer, 0, bytes.byteLength / Ctor.BYTES_PER_ELEMENT);
  }
  return value;
}

/** Key-order independent JSON for comparing records. */
function canonical(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(o)
          .filter((k) => o[k] !== undefined)
          .sort()
          .map((k) => [k, sort(o[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(sort(JSON.parse(JSON.stringify(value, replacer))));
}

// ---- export ----------------------------------------------------------------------------------

export interface ExportOptions {
  includeSamples: boolean;
  appVersion?: string;
  now?: Date;
  /** Bytes read so far of the total (the CRC pass over all files). */
  onProgress?: (done: number, total: number) => void;
}

export interface ExportResult {
  blob: Blob;
  manifest: BackupManifest;
}

/** Bytes of the analysis frame files that `includeSamples` would add. */
export async function sampleBytes(db: MetadataStore, files: AssetStore): Promise<number> {
  let total = 0;
  for (const a of await db.analyses.all()) total += (await files.get(sampleFileName(a.videoId)))?.size ?? 0;
  return total;
}

export async function exportBackup(db: MetadataStore, files: AssetStore, opts: ExportOptions): Promise<ExportResult> {
  const now = opts.now ?? new Date();
  const records: BackupRecords = {
    asanas: await db.asanas.all(),
    templates: await db.templates.all(),
    sessions: await db.sessions.all(),
    videos: await db.videos.all(),
    analyses: await db.analyses.all(),
    holds: await db.holds.all(),
    assets: await db.assets.all(),
  };
  const settings = (await db.settings.entries()).filter((e) => !isDeviceSetting(e.key));

  const zipFiles: Array<{ name: string; data: Blob }> = [];
  const missingFiles: string[] = [];
  for (const a of records.assets) {
    const blob = await files.get(a.storageKey);
    if (blob) zipFiles.push({ name: a.storageKey, data: blob });
    else missingFiles.push(a.storageKey);
  }
  if (opts.includeSamples) {
    for (const a of records.analyses) {
      const key = sampleFileName(a.videoId);
      const blob = await files.get(key);
      if (blob) zipFiles.push({ name: key, data: blob });
    }
  }

  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: now.toISOString(),
    ...(opts.appVersion ? { appVersion: opts.appVersion } : {}),
    counts: { ...(Object.fromEntries(RECORD_STORES.map((s) => [s, records[s].length])) as Record<RecordStore, number>), settings: settings.length },
    includesSamples: opts.includeSamples,
    files: zipFiles.map((f) => ({ path: f.name, bytes: f.data.size })),
    missingFiles,
  };
  const json: BackupJson = { manifest, records, settings };
  const jsonBlob = new Blob([JSON.stringify(json, replacer)], { type: 'application/json' });
  const blob = await createZip([{ name: BACKUP_JSON, data: jsonBlob, modified: now }, ...zipFiles.map((f) => ({ ...f, modified: now }))], {
    onProgress: opts.onProgress,
  });
  return { blob, manifest };
}

// ---- import ----------------------------------------------------------------------------------

export interface BackupContents {
  manifest: BackupManifest;
  records: BackupRecords;
  settings: Array<{ key: string; value: unknown }>;
  entries: Map<string, ZipEntry>;
}

export class BackupError extends Error {
  override name = 'BackupError';
}

/** Reads and validates a backup archive (only `backup.json` is read; files stay lazy). */
export async function readBackup(zip: Blob): Promise<BackupContents> {
  let entries: ZipEntry[];
  try {
    entries = await readZip(zip);
  } catch (e) {
    throw new BackupError(`Not a backup file: ${(e as Error).message}`);
  }
  const map = new Map(entries.map((e) => [e.name, e]));
  const jsonEntry = map.get(BACKUP_JSON);
  if (!jsonEntry) throw new BackupError(`Not a backup file: ${BACKUP_JSON} is missing`);
  const blob = await jsonEntry.data();
  if ((await crc32Blob(blob)) !== jsonEntry.crc32) throw new BackupError(`${BACKUP_JSON} is damaged (checksum mismatch)`);
  let json: BackupJson;
  try {
    json = JSON.parse(await blob.text(), reviver) as BackupJson;
  } catch (e) {
    throw new BackupError(`${BACKUP_JSON} is not valid: ${(e as Error).message}`);
  }
  const m = json?.manifest;
  if (m?.format !== BACKUP_FORMAT) throw new BackupError('Not a backup of this app');
  if (!(m.version >= 1 && m.version <= BACKUP_VERSION)) throw new BackupError(`Backup version ${m.version} needs a newer version of the app`);
  for (const s of RECORD_STORES) {
    if (!Array.isArray(json.records?.[s])) throw new BackupError(`${BACKUP_JSON}: "${s}" is missing`);
    for (const r of json.records[s]) keyOf(s, r);
  }
  const settings = Array.isArray(json.settings) ? json.settings.filter((e) => typeof e?.key === 'string' && !isDeviceSetting(e.key)) : [];
  return { manifest: m, records: json.records, settings, entries: map };
}

export interface StorePlan {
  added: number;
  updated: number;
  unchanged: number;
}

export interface ImportPlan {
  stores: Record<RecordStore, StorePlan>;
  settings: StorePlan;
  /** Files that will be written (assets of added/updated records, frame files). */
  files: Array<{ path: string; bytes: number }>;
  /** Backup assets left out: the hold already has a different asset of that kind here. */
  keptLocal: string[];
  /** Backup assets left out: their file is neither in the backup nor on this device. */
  missingFiles: string[];
}

const ASSET_KEY = /^assets\/[A-Za-z0-9_-]+\.[a-z0-9]+$/;

interface Decision {
  plan: ImportPlan;
  put: { [S in RecordStore]: BackupRecords[S] };
  settings: Array<{ key: string; value: unknown }>;
  /** File path → asset id (or null for a frame file). */
  files: Map<string, string | null>;
}

async function decide(db: MetadataStore, files: AssetStore, c: BackupContents): Promise<Decision> {
  const stores = {} as Record<RecordStore, StorePlan>;
  const put = {} as Decision['put'];
  for (const s of RECORD_STORES) {
    const local = new Map((await db[s].all()).map((r) => [keyOf(s, r), canonical(r)]));
    const p: StorePlan = { added: 0, updated: 0, unchanged: 0 };
    const list: unknown[] = [];
    for (const r of c.records[s]) {
      const have = local.get(keyOf(s, r));
      if (have === undefined) p.added++;
      else if (have !== canonical(r)) p.updated++;
      else {
        p.unchanged++;
        continue;
      }
      list.push(r);
    }
    stores[s] = p;
    (put as Record<RecordStore, unknown[]>)[s] = list;
  }

  // Assets: one per hold and kind. A different local asset for the same hold and kind wins (it is
  // the current capture); a backup asset needs its file from the archive or already on disk.
  const localAssets = await db.assets.all();
  const localIds = new Set(localAssets.map((a) => a.id));
  const slot = (a: Asset) => `${a.holdId}:${a.kind}`;
  const localSlots = new Map(localAssets.map((a) => [slot(a), a.id]));
  const keptLocal: string[] = [];
  const missingFiles: string[] = [];
  const fileMap = new Map<string, string | null>();
  const assets: Asset[] = [];
  for (const a of put.assets) {
    const other = localSlots.get(slot(a));
    if (!localIds.has(a.id) && other && other !== a.id) {
      keptLocal.push(a.id);
      stores.assets.added--;
      continue;
    }
    if (!ASSET_KEY.test(a.storageKey)) throw new BackupError(`Invalid asset path "${a.storageKey}"`);
    if (c.entries.has(a.storageKey)) fileMap.set(a.storageKey, a.id);
    else if (!(await files.get(a.storageKey))) {
      missingFiles.push(a.storageKey);
      if (localIds.has(a.id)) stores.assets.updated--;
      else stores.assets.added--;
      continue;
    }
    assets.push(a);
  }
  // Unchanged asset records whose file is missing here (e.g. evicted) get it back from the backup.
  for (const a of c.records.assets) {
    if (fileMap.has(a.storageKey) || !localIds.has(a.id) || !c.entries.has(a.storageKey) || !ASSET_KEY.test(a.storageKey)) continue;
    if (!(await files.get(a.storageKey))) fileMap.set(a.storageKey, a.id);
  }
  put.assets = assets;

  const importedAnalyses = new Set(put.analyses.map((a) => a.videoId));
  for (const a of c.records.analyses) {
    const key = sampleFileName(a.videoId);
    if (!c.entries.has(key)) continue;
    if (importedAnalyses.has(a.videoId) || !(await files.get(key))) fileMap.set(key, null);
  }

  const settingsPlan: StorePlan = { added: 0, updated: 0, unchanged: 0 };
  const settings: Decision['settings'] = [];
  for (const e of c.settings) {
    const have = await db.settings.get(e.key);
    if (have === undefined) settingsPlan.added++;
    else if (canonical(have) !== canonical(e.value)) settingsPlan.updated++;
    else {
      settingsPlan.unchanged++;
      continue;
    }
    settings.push(e);
  }

  const plan: ImportPlan = {
    stores,
    settings: settingsPlan,
    files: [...fileMap.keys()].map((path) => ({ path, bytes: c.entries.get(path)!.size })),
    keptLocal,
    missingFiles: [...missingFiles, ...c.manifest.missingFiles.filter((p) => !missingFiles.includes(p) && !fileMap.has(p))],
  };
  return { plan, put, settings, files: fileMap };
}

/** What importing `contents` would change, without writing anything. */
export async function planImport(db: MetadataStore, files: AssetStore, contents: BackupContents): Promise<ImportPlan> {
  return (await decide(db, files, contents)).plan;
}

export interface ImportResult {
  plan: ImportPlan;
  filesWritten: number;
  bytesWritten: number;
  /** Files whose checksum did not match; their asset records were not imported. */
  damaged: string[];
}

export interface ImportOptions {
  onProgress?: (phase: 'files' | 'records', done: number, total: number) => void;
}

/** Imports a backup: files first (checksums verified), then all records and settings atomically. */
export async function importBackup(db: MetadataStore, files: AssetStore, contents: BackupContents, opts: ImportOptions = {}): Promise<ImportResult> {
  const d = await decide(db, files, contents);
  const damaged: string[] = [];
  const skipAssets = new Set<string>();
  const totalBytes = d.plan.files.reduce((s, f) => s + f.bytes, 0);
  let bytes = 0;
  let written = 0;
  opts.onProgress?.('files', 0, totalBytes);
  for (const [path, assetId] of d.files) {
    const entry = contents.entries.get(path)!;
    const blob = await entry.data();
    if ((await crc32Blob(blob)) !== entry.crc32) {
      damaged.push(path);
      if (assetId) skipAssets.add(assetId);
    } else {
      await files.put(path, blob);
      written++;
    }
    bytes += entry.size;
    opts.onProgress?.('files', bytes, totalBytes);
  }
  if (skipAssets.size) d.put.assets = d.put.assets.filter((a) => !skipAssets.has(a.id));

  // All records and settings in one transaction: a failed import leaves the metadata untouched.
  const ops: BatchOp[] = [
    ...RECORD_STORES.flatMap((store) => (d.put[store] as unknown[]).map((put): BatchOp => ({ store, put }))),
    ...d.settings.map((e): BatchOp => ({ store: 'settings', put: { key: e.key, value: e.value } })),
  ];
  opts.onProgress?.('records', 0, ops.length);
  await db.batch(ops);
  opts.onProgress?.('records', ops.length, ops.length);
  return { plan: d.plan, filesWritten: written, bytesWritten: bytes, damaged };
}
