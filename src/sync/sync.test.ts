import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { MemoryAssetStore, openMetadataStore, sampleFileName, typedJsonReplacer, typedJsonReviver } from '../storage';
import type { Analysis, Asset, Hold } from '../model';
import { DEFAULT_PARAMS } from '../detection';
import { gunzip, localSizes, pullChanges, pushChanges, samplesKey, uploadAll, uploadMissingFiles } from './index';
import type { PullPage, PushOp, RemoteFile, SyncApi } from './types';

/** The server's semantics in memory (records by revision, files by key). */
class FakeServer implements SyncApi {
  rev = 0;
  records = new Map<string, { store: string; key: string; rev: number; deleted: boolean; body?: string }>();
  files = new Map<string, { data: Blob; rawBytes: number | null }>();
  pushes = 0;
  async status() {
    return { rev: this.rev, records: {}, files: {} };
  }
  async push(ops: PushOp[]) {
    this.pushes++;
    // Through JSON like the real request.
    const parsed = JSON.parse(JSON.stringify({ ops }, typedJsonReplacer)) as { ops: Array<{ store: string; key: string; body?: unknown; deleted?: boolean }> };
    for (const o of parsed.ops) {
      this.records.set(`${o.store}/${o.key}`, { store: o.store, key: o.key, rev: ++this.rev, deleted: !!o.deleted, body: o.deleted ? undefined : JSON.stringify(o.body) });
    }
    return this.rev;
  }
  async pull(since: number): Promise<PullPage> {
    const rows = [...this.records.values()].filter((r) => r.rev > since).sort((a, b) => a.rev - b.rev);
    const page = rows.slice(0, 2);
    const json = `{"records":[${page.map((r) => `{"store":"${r.store}","key":"${r.key}","rev":${r.rev}${r.deleted ? ',"deleted":true' : `,"body":${r.body}`}}`).join(',')}],"rev":${page.at(-1)?.rev ?? since},"latest":${this.rev},"more":${rows.length > 2}}`;
    return JSON.parse(json, typedJsonReviver) as PullPage;
  }
  async listFiles(prefix: string): Promise<RemoteFile[]> {
    return [...this.files].filter(([k]) => k.startsWith(prefix)).map(([key, f]) => ({ key, bytes: f.data.size, rawBytes: f.rawBytes }));
  }
  async putFile(key: string, data: Blob, rawBytes?: number) {
    this.files.set(key, { data, rawBytes: rawBytes ?? null });
  }
  async getFile(key: string) {
    return this.files.get(key)?.data ?? null;
  }
}

let n = 0;
const open = () => openMetadataStore(new IDBFactory(), `sync-${n++}`);

function hold(id: string): Hold {
  return { id, sessionId: 's1', videoId: 'v1', asanaId: 'navasana', side: null, startS: 1, endS: 9, bestS: 5, clipStartS: 2, clipEndS: 6, crop: {} };
}
function asset(id: string, kind: Asset['kind']): Asset {
  return { id, holdId: 'h1', kind, mime: kind === 'clip' ? 'video/mp4' : 'image/jpeg', width: 10, height: 10, bytes: 3, storageKey: `assets/${id}.${kind === 'clip' ? 'mp4' : 'jpg'}` };
}
function analysis(): Analysis {
  return {
    videoId: 'v1',
    params: { ...DEFAULT_PARAMS },
    sampleHz: 4,
    frameWidth: 2,
    frameHeight: 2,
    sampleCount: 3,
    m: new Float32Array([1, NaN, 3]),
    C: new Float32Array([0.5, 0.25, 0]),
    threshold: 1,
    singleStill: false,
    candidates: [],
    preMerge: [],
    createdAt: 'now',
    stats: null,
  };
}

describe('sync', () => {
  it('uploadAll sends files the server lacks, then every record; options leave out clips and frames', async () => {
    const db = await open();
    const files = new MemoryAssetStore();
    await db.holds.put(hold('h1'));
    for (const a of [asset('st', 'still'), asset('th', 'thumb'), asset('cl', 'clip')]) {
      await db.assets.put(a);
      await files.put(a.storageKey, new Blob([new Uint8Array([1, 2, 3])]));
    }
    await db.analyses.put(analysis());
    await files.put(sampleFileName('v1'), new Blob([new Uint8Array(16)]));
    await db.settings.set('clipQuality', '720p');
    await db.settings.set('catalogVersion', 5);
    const api = new FakeServer();
    const progress: string[] = [];
    const r = await uploadAll(db, files, api, { clips: false, frames: false }, (p) => progress.push(`${p.phase} ${p.done}/${p.total}`));
    expect(r).toEqual({ files: 2, records: 6 });
    expect([...api.files.keys()].sort()).toEqual(['assets/st.jpg', 'assets/th.jpg']);
    expect([...api.records.keys()].sort()).toEqual(['analyses/v1', 'assets/cl', 'assets/st', 'assets/th', 'holds/h1', 'settings/clipQuality']);
    expect(progress.at(-1)).toBe('records 6/6');
    expect(await db.outbox.count()).toBe(0);

    // Again with clips and frames: only the new files go.
    expect(await uploadMissingFiles(db, files, api, { clips: true, frames: true })).toBe(2);
    const frames = api.files.get(samplesKey('v1'))!;
    expect(frames.rawBytes).toBe(16);
    expect((await gunzip(frames.data)).size).toBe(16);
    expect(await uploadMissingFiles(db, files, api, { clips: true, frames: true })).toBe(0);
    db.close();
  });

  it('pushChanges sends the outbox (deletes too) and pullChanges brings it to another device', async () => {
    const api = new FakeServer();
    const phone = await open();
    const phoneFiles = new MemoryAssetStore();
    await phone.holds.put(hold('h1'));
    await phone.holds.put(hold('h2'));
    await phone.assets.put(asset('st', 'still'));
    await phoneFiles.put('assets/st.jpg', new Blob(['jpg']));
    await phone.analyses.put(analysis());
    await phone.settings.set('sync.rev', 0);
    expect(await pushChanges(phone, phoneFiles, api, { clips: true, frames: false })).toBe(4);
    expect(api.files.has('assets/st.jpg')).toBe(true);
    expect(await phone.outbox.count()).toBe(0);
    expect(await pushChanges(phone, phoneFiles, api, { clips: true, frames: false })).toBe(0);

    const mac = await open();
    const macFiles = new MemoryAssetStore();
    const pulled = await pullChanges(mac, macFiles, api);
    expect(pulled.records).toBe(4);
    expect([...pulled.stores].sort()).toEqual(['analyses', 'assets', 'holds']);
    const an = await mac.analyses.get('v1');
    expect(an?.m).toBeInstanceOf(Float32Array);
    expect(Number.isNaN(an!.m[1])).toBe(true);
    expect(await mac.outbox.count()).toBe(0);
    expect(await mac.settings.get('sync.rev')).toBe(4);

    // A delete on the phone reaches the Mac; the Mac's own pending edit is not overwritten.
    await macFiles.put('assets/st.jpg', new Blob(['jpg']));
    await phone.assets.delete('st');
    await phone.holds.put({ ...hold('h2'), asanaId: 'phone-edit' });
    await mac.holds.put({ ...hold('h2'), asanaId: 'mac-edit' });
    await pushChanges(phone, phoneFiles, api, { clips: true, frames: false });
    const again = await pullChanges(mac, macFiles, api);
    expect(again.records).toBe(1);
    expect(await mac.assets.get('st')).toBeUndefined();
    expect(await macFiles.get('assets/st.jpg')).toBeNull();
    expect((await mac.holds.get('h2'))?.asanaId).toBe('mac-edit');
    await pushChanges(mac, macFiles, api, { clips: true, frames: false });
    await pullChanges(phone, phoneFiles, api);
    expect((await phone.holds.get('h2'))?.asanaId).toBe('mac-edit');
    phone.close();
    mac.close();
  });

  it('localSizes adds up images, clips and frames', async () => {
    const db = await open();
    const files = new MemoryAssetStore();
    await db.assets.put(asset('st', 'still'));
    await db.assets.put(asset('cl', 'clip'));
    await db.analyses.put(analysis());
    await files.put(sampleFileName('v1'), new Blob([new Uint8Array(10)]));
    expect(await localSizes(db, files)).toEqual({ records: 3, images: { count: 1, bytes: 3 }, clips: { count: 1, bytes: 3 }, frames: { count: 1, bytes: 10 } });
    db.close();
  });
});

describe('first pull', () => {
  it('serverWins replaces local changes made before it where the server has the record', async () => {
    const api = new FakeServer();
    const a = await open();
    await a.asanas.put({ id: 'navasana', name: 'Boat (edited)', sided: false });
    await pushChanges(a, new MemoryAssetStore(), api, { clips: true, frames: false });
    const b = await open();
    await b.asanas.put({ id: 'navasana', name: 'Navasana', sided: false });
    await b.asanas.put({ id: 'only-here', name: 'Only here', sided: false });
    await pullChanges(b, new MemoryAssetStore(), api, undefined, { serverWins: true });
    expect((await b.asanas.get('navasana'))?.name).toBe('Boat (edited)');
    expect((await b.outbox.list()).map((e) => e.id)).toEqual(['asanas/only-here']);
    a.close();
    b.close();
  });
});
