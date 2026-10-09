import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { MemoryAssetStore } from './assets';
import { BackupError, exportBackup, importBackup, isDeviceSetting, planImport, readBackup, sampleBytes } from './backup';
import { openMetadataStore } from './metadata';
import { sampleFileName } from './samples';
import { createZip, readZip } from './zip';
import type { MetadataStore } from './types';
import type { Analysis, Asset, Hold, Session, Video } from '../model/types';
import { DEFAULT_PARAMS } from '../detection/params';

let n = 0;
const open = () => openMetadataStore(new IDBFactory(), `backup-${n++}`);

const video: Video = {
  id: 'v1',
  fingerprint: 'fp',
  fileName: 'v1.mov',
  fileSize: 1,
  durationS: 60,
  codec: 'hevc',
  width: 1920,
  height: 1080,
  fps: 30,
  recordedAt: '2026-10-09T07:00:00+02:00',
  importedAt: '2026-10-09T08:00:00Z',
};
const session: Session = { id: 's1', date: video.recordedAt!, note: 'n', videoIds: ['v1'], templateId: 'primary-series' };
const analysis: Analysis = {
  videoId: 'v1',
  params: { ...DEFAULT_PARAMS },
  sampleHz: 4,
  frameWidth: 2,
  frameHeight: 2,
  sampleCount: 3,
  m: new Float32Array([1, 2.5, NaN]),
  C: new Float32Array([NaN, 0.25, -1]),
  threshold: 2,
  singleStill: false,
  candidates: [{ startS: 1, endS: 9, bestS: 5, clipStartS: 3, clipEndS: 7, alternatesS: [], status: 'labeled', holdId: 'h1' } as never],
  preMerge: [],
  createdAt: 'now',
  stats: null,
};
const hold: Hold = {
  id: 'h1',
  sessionId: 's1',
  videoId: 'v1',
  asanaId: 'navasana',
  side: null,
  startS: 1,
  endS: 9,
  bestS: 5,
  clipStartS: 3,
  clipEndS: 7,
  crop: { auto: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } },
};
const asset = (id: string, kind: Asset['kind'], holdId = 'h1'): Asset => ({
  id,
  holdId,
  kind,
  mime: kind === 'clip' ? 'video/mp4' : 'image/jpeg',
  width: 10,
  height: 10,
  bytes: 3,
  storageKey: `assets/${id}.${kind === 'clip' ? 'mp4' : 'jpg'}`,
});

async function seed(): Promise<{ db: MetadataStore; files: MemoryAssetStore }> {
  const db = await open();
  const files = new MemoryAssetStore();
  await db.asanas.put({ id: 'navasana', name: 'Navasana', sided: false });
  await db.templates.put({ id: 'primary-series', name: 'Primary series', entries: [{ asanaId: 'navasana', reps: 5 }] });
  await db.videos.put(video);
  await db.sessions.put(session);
  await db.analyses.put(analysis);
  await db.holds.put(hold);
  for (const a of [asset('a1', 'still'), asset('a2', 'thumb'), asset('a3', 'clip')]) {
    await db.assets.put(a);
    await files.put(a.storageKey, new Blob([a.id]));
  }
  await files.put(sampleFileName('v1'), new Blob([new Uint8Array(12).fill(7)]));
  await db.settings.set('clipQuality', 'original');
  await db.settings.set('catalogVersion', 3);
  await db.settings.set('persistGranted', true);
  await db.settings.set('diag.hdrProbe', { x: 1 });
  await db.jobs.put({ videoId: 'v9' } as never);
  return { db, files };
}

describe('backup', () => {
  it('round-trips records, settings and files into an empty store', async () => {
    const { db, files } = await seed();
    expect(await sampleBytes(db, files)).toBe(12);
    const { blob, manifest } = await exportBackup(db, files, { includeSamples: true, appVersion: 'abc', now: new Date('2026-10-09T10:00:00Z') });
    expect(manifest.counts).toEqual({ asanas: 1, templates: 1, sessions: 1, videos: 1, analyses: 1, holds: 1, assets: 3, settings: 1 });
    expect(manifest.files.map((f) => f.path)).toEqual(['assets/a1.jpg', 'assets/a2.jpg', 'assets/a3.mp4', 'samples-v1.bin']);
    expect((await readZip(blob))[0]!.name).toBe('backup.json');

    const db2 = await open();
    const files2 = new MemoryAssetStore();
    const contents = await readBackup(blob);
    expect(contents.manifest.appVersion).toBe('abc');
    const plan = await planImport(db2, files2, contents);
    expect(plan.stores.holds).toEqual({ added: 1, updated: 0, unchanged: 0 });
    expect(plan.files.length).toBe(4);

    const phases = new Set<string>();
    const r = await importBackup(db2, files2, contents, { onProgress: (p) => phases.add(p) });
    expect([...phases]).toEqual(['files', 'records']);
    expect(r.filesWritten).toBe(4);
    expect(r.damaged).toEqual([]);
    expect(await db2.holds.get('h1')).toEqual(hold);
    const a = (await db2.analyses.get('v1'))!;
    expect(a.m).toBeInstanceOf(Float32Array);
    expect([...a.m].slice(0, 2)).toEqual([1, 2.5]);
    expect(Number.isNaN(a.m[2]!)).toBe(true);
    expect([...a.C].slice(1)).toEqual([0.25, -1]);
    expect(await (await files2.get('assets/a3.mp4'))!.text()).toBe('a3');
    expect((await files2.get('samples-v1.bin'))!.size).toBe(12);
    expect(await db2.settings.get('clipQuality')).toBe('original');
    expect(await db2.settings.get('catalogVersion')).toBeUndefined();
    expect(await db2.settings.get('persistGranted')).toBeUndefined();
    expect(await db2.jobs.all()).toEqual([]);

    // Importing again changes nothing.
    const again = await planImport(db2, files2, contents);
    expect(again.stores.holds).toEqual({ added: 0, updated: 0, unchanged: 1 });
    expect(again.stores.analyses.unchanged).toBe(1);
    expect(again.settings).toEqual({ added: 0, updated: 0, unchanged: 1 });
    expect(again.files).toEqual([]);
  });

  it('merges: replaces changed records, keeps local assets of the same hold, restores lost files', async () => {
    const { db, files } = await seed();
    const { blob } = await exportBackup(db, files, { includeSamples: false });

    // Local changes after the backup: the note changed, the still was re-captured under a new
    // id, the thumb file was evicted, a new hold was added.
    await db.sessions.put({ ...session, note: 'newer' });
    await db.assets.delete('a1');
    await db.assets.put(asset('a9', 'still'));
    await files.delete('assets/a2.jpg');
    await db.holds.put({ ...hold, id: 'h2' });
    await db.settings.set('clipQuality', '720p');

    const contents = await readBackup(blob);
    expect(contents.manifest.includesSamples).toBe(false);
    const plan = await planImport(db, files, contents);
    expect(plan.stores.sessions).toEqual({ added: 0, updated: 1, unchanged: 0 });
    expect(plan.stores.holds).toEqual({ added: 0, updated: 0, unchanged: 1 });
    expect(plan.keptLocal).toEqual(['a1']);
    expect(plan.stores.assets).toEqual({ added: 0, updated: 0, unchanged: 2 });
    expect(plan.files.map((f) => f.path)).toEqual(['assets/a2.jpg']);
    expect(plan.settings.updated).toBe(1);

    await importBackup(db, files, contents);
    expect((await db.sessions.get('s1'))!.note).toBe('n');
    expect(await db.assets.get('a1')).toBeUndefined();
    expect(await db.assets.get('a9')).toBeDefined();
    expect(await (await files.get('assets/a2.jpg'))!.text()).toBe('a2');
    expect(await db.holds.get('h2')).toBeDefined();
    expect(await db.settings.get('clipQuality')).toBe('original');
  });

  it('skips assets whose files are missing everywhere and reports them', async () => {
    const { db, files } = await seed();
    await files.delete('assets/a3.mp4');
    const { blob, manifest } = await exportBackup(db, files, { includeSamples: false });
    expect(manifest.missingFiles).toEqual(['assets/a3.mp4']);

    const db2 = await open();
    const files2 = new MemoryAssetStore();
    const contents = await readBackup(blob);
    const plan = await planImport(db2, files2, contents);
    expect(plan.missingFiles).toEqual(['assets/a3.mp4']);
    expect(plan.stores.assets.added).toBe(2);
    await importBackup(db2, files2, contents);
    expect((await db2.assets.all()).map((a) => a.id).sort()).toEqual(['a1', 'a2']);

    // Updated asset record whose file is gone here and not in the backup: also left out.
    await db2.assets.put({ ...asset('a3', 'clip'), bytes: 99 });
    const plan2 = await planImport(db2, files2, contents);
    expect(plan2.stores.assets).toEqual({ added: 0, updated: 0, unchanged: 2 });
  });

  it('writes frame files when the analysis changes or the file is missing', async () => {
    const { db, files } = await seed();
    const { blob } = await exportBackup(db, files, { includeSamples: true });
    const contents = await readBackup(blob);
    expect((await planImport(db, files, contents)).files).toEqual([]);
    await files.delete(sampleFileName('v1'));
    expect((await planImport(db, files, contents)).files.map((f) => f.path)).toEqual(['samples-v1.bin']);
    await files.put(sampleFileName('v1'), new Blob(['x']));
    await db.analyses.put({ ...analysis, threshold: 3 });
    expect((await planImport(db, files, contents)).files.map((f) => f.path)).toEqual(['samples-v1.bin']);
  });

  it('does not import damaged files or their asset records', async () => {
    const { db, files } = await seed();
    const { blob } = await exportBackup(db, files, { includeSamples: false });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // Flip the first content byte of "assets/a1.jpg" (its local header name is followed by the data).
    bytes[findBytes(bytes, new TextEncoder().encode('assets/a1.jpga1')) + 13] = 0x41;
    const db2 = await open();
    const files2 = new MemoryAssetStore();
    const r = await importBackup(db2, files2, await readBackup(new Blob([bytes])));
    expect(r.damaged).toEqual(['assets/a1.jpg']);
    expect(await db2.assets.get('a1')).toBeUndefined();
    expect(await files2.get('assets/a1.jpg')).toBeNull();
    expect(await db2.assets.get('a2')).toBeDefined();
  });

  it('rejects files that are not backups', async () => {
    await expect(readBackup(new Blob(['nope']))).rejects.toThrow(BackupError);
    const zip = (entries: Array<[string, string]>) => createZip(entries.map(([name, s]) => ({ name, data: new Blob([s]) })));
    await expect(readBackup(await zip([['other.txt', 'x']]))).rejects.toThrow(/backup.json is missing/);
    await expect(readBackup(await zip([['backup.json', '{']]))).rejects.toThrow(/not valid/);
    await expect(readBackup(await zip([['backup.json', '{"manifest":{"format":"x"}}']]))).rejects.toThrow(/Not a backup of this app/);
    const m = { format: 'asana-progression-backup', version: 99 };
    await expect(readBackup(await zip([['backup.json', JSON.stringify({ manifest: m })]]))).rejects.toThrow(/newer version/);
    m.version = 1;
    await expect(readBackup(await zip([['backup.json', JSON.stringify({ manifest: m, records: {} })]]))).rejects.toThrow(/"asanas" is missing/);
    const records = { asanas: [{ name: 'no id' }], templates: [], sessions: [], videos: [], analyses: [], holds: [], assets: [] };
    await expect(readBackup(await zip([['backup.json', JSON.stringify({ manifest: m, records })]]))).rejects.toThrow(/has no key/);
    records.asanas = [];
    const typed = { ...records, analyses: [{ videoId: 'v', m: { $typed: 'BigInt64Array', b64: '' } }] };
    await expect(readBackup(await zip([['backup.json', JSON.stringify({ manifest: m, records: typed })]]))).rejects.toThrow(/Unknown typed array/);
    const bad = { ...records, assets: [{ ...asset('x', 'still'), storageKey: '../x.jpg' }] };
    const contents = await readBackup(await zip([['backup.json', JSON.stringify({ manifest: { ...m, missingFiles: [] }, records: bad, settings: [{ key: 'persistGranted', value: true }] })]]));
    expect(contents.settings).toEqual([]);
    await expect(planImport(await open(), new MemoryAssetStore(), contents)).rejects.toThrow(/Invalid asset path/);
  });

  it('detects a damaged backup.json', async () => {
    const { db, files } = await seed();
    const bytes = new Uint8Array(await (await exportBackup(db, files, { includeSamples: false })).blob.arrayBuffer());
    bytes[findBytes(bytes, new TextEncoder().encode('"Navasana"')) + 1] = 0x4d;
    await expect(readBackup(new Blob([bytes]))).rejects.toThrow(/damaged/);
  });

  it('classifies device settings', () => {
    expect(['persistRequested', 'persistGranted', 'catalogVersion', 'diag.quotaProbe', 'backup.lastExport'].every(isDeviceSetting)).toBe(true);
    expect(['clipQuality', 'detectionParams', 'skipNonReference'].some(isDeviceSetting)).toBe(false);
  });
});

function findBytes(hay: Uint8Array, needle: Uint8Array, from = 0): number {
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  throw new Error('not found');
}
