import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openMetadataStore } from './metadata';
import { MemorySamples, sampleFileName, openSampleReader, openSampleWriter, deleteFile, opfsUsage } from './samples';
import { estimateStorage, probeWritable, requestPersistence, wouldExceedQuota } from './quota';
import { listOpfs, planCleanup, removeOpfsPath } from './opfs';
import { openDatabase } from './idb';
import type { Analysis, Hold, Video } from '../model/types';
import { DEFAULT_PARAMS } from '../detection/params';

function video(id: string, fingerprint: string): Video {
  return {
    id,
    fingerprint,
    fileName: `${id}.mov`,
    fileSize: 1,
    durationS: 10,
    codec: 'hevc',
    width: 3840,
    height: 2160,
    fps: 60,
    recordedAt: '2024-05-12T07:31:22+02:00',
    importedAt: '2024-05-12T08:00:00Z',
  };
}

describe('MetadataStore', () => {
  it('applies a batch atomically across stores', async () => {
    const store = await openMetadataStore(new IDBFactory(), 'test-batch');
    await store.videos.put(video('v1', 'fp1'));
    await store.batch([
      { store: 'videos', put: video('v2', 'fp2') },
      { store: 'videos', delete: 'v1' },
      { store: 'settings', put: { key: 'k', value: 1 } },
    ]);
    expect((await store.videos.all()).map((v) => v.id)).toEqual(['v2']);
    expect(await store.settings.get('k')).toBe(1);
    expect(await store.settings.entries()).toEqual([{ key: 'k', value: 1 }]);
    await store.batch([]);
    // A record without its key fails the whole batch: the first write is rolled back.
    await expect(store.batch([{ store: 'videos', put: video('v3', 'fp3') }, { store: 'videos', put: { nope: 1 } }])).rejects.toThrow();
    expect(await store.videos.get('v3')).toBeUndefined();
    store.close();
  });

  it('stores, finds and deletes records per entity', async () => {
    const store = await openMetadataStore(new IDBFactory(), 'test-a');
    await store.videos.put(video('v1', 'fp1'));
    await store.videos.put(video('v2', 'fp2'));
    expect((await store.videos.get('v1'))?.fileName).toBe('v1.mov');
    expect((await store.videos.all()).length).toBe(2);
    expect((await store.videos.findBy('fingerprint', 'fp2')).map((v) => v.id)).toEqual(['v2']);
    await store.videos.delete('v1');
    expect(await store.videos.get('v1')).toBeUndefined();

    const analysis: Analysis = {
      videoId: 'v2',
      params: { ...DEFAULT_PARAMS },
      sampleHz: 4,
      frameWidth: 80,
      frameHeight: 45,
      sampleCount: 3,
      m: new Float32Array([1, 2, 3]),
      C: new Float32Array([NaN, 2, NaN]),
      threshold: 2,
      singleStill: false,
      candidates: [],
      preMerge: [],
      createdAt: 'now',
      stats: null,
    };
    await store.analyses.put(analysis);
    const back = await store.analyses.get('v2');
    expect(back?.m).toBeInstanceOf(Float32Array);
    expect(Number.isNaN(back!.C[0]!)).toBe(true);

    const hold: Hold = {
      id: 'h1', sessionId: 's1', videoId: 'v2', asanaId: 'a1', side: 'R',
      startS: 1, endS: 2, bestS: 1.5, clipStartS: 1, clipEndS: 2, crop: {},
    };
    await store.holds.put(hold);
    expect((await store.holds.findBy('asanaId', 'a1')).length).toBe(1);
    await store.sessions.put({ id: 's1', date: '2024-05-12', note: '', videoIds: ['v2', 'v3'] });
    expect((await store.sessions.findBy('videoIds', 'v3')).length).toBe(1);

    await store.settings.set('params', { a: 1 });
    expect(await store.settings.get<{ a: number }>('params')).toEqual({ a: 1 });
    await store.settings.delete('params');
    expect(await store.settings.get('params')).toBeUndefined();
    store.close();
  });

  it('reopens an existing database without re-creating stores', async () => {
    const factory = new IDBFactory();
    const a = await openMetadataStore(factory, 'test-b');
    await a.videos.put(video('v1', 'fp1'));
    a.close();
    const b = await openMetadataStore(factory, 'test-b');
    expect((await b.videos.all()).length).toBe(1);
    b.close();
  });

  it('propagates request errors', async () => {
    const store = await openMetadataStore(new IDBFactory(), 'test-c');
    // keyPath missing → DataError
    await expect(store.videos.put({} as Video)).rejects.toBeTruthy();
    store.close();
  });

  it('openDatabase reports blocked upgrades and open errors', async () => {
    const factory = new IDBFactory();
    const first = await openDatabase(factory, 'blocked', 1, (db) => db.createObjectStore('x'));
    first.onversionchange = () => {}; // keep it open → upgrade is blocked
    await expect(openDatabase(factory, 'blocked', 2, () => {})).rejects.toThrow(/blocked/);
    first.close();
    await expect(openDatabase(factory, 'blocked', 1, () => {})).rejects.toBeTruthy(); // version downgrade
  });
});

describe('MemorySamples', () => {
  it('writes, reads, grows, truncates', async () => {
    const s = new MemorySamples(4);
    for (let i = 0; i < 100; i++) s.write(i, new Uint8Array([i, i, i, i, 99]));
    expect(s.count()).toBe(100);
    expect(Array.from(s.read(42))).toEqual([42, 42, 42, 42]);
    expect(() => s.read(100)).toThrow(RangeError);
    s.truncate(10);
    expect(s.count()).toBe(10);
    s.write(5, new Uint8Array([1, 2, 3, 4]));
    expect(s.count()).toBe(10);
    s.flush();
    const r = s.asReader();
    expect(await r.count()).toBe(10);
    expect(Array.from(await r.read(5))).toEqual([1, 2, 3, 4]);
    expect((await r.readRange(0, 3)).length).toBe(12);
    await expect(r.read(10)).rejects.toThrow(RangeError);
    s.close();
  });

  it('builds safe file names', () => {
    expect(sampleFileName('abc:DEF/1')).toBe('samples-abc_DEF_1.bin');
  });
});

describe('OPFS wrappers without OPFS', () => {
  it('fail gracefully', async () => {
    await expect(openSampleWriter('x', 4)).rejects.toThrow(/OPFS/);
    expect(await openSampleReader('x', 4)).toBeNull();
    await expect(deleteFile('x')).resolves.toBeUndefined();
    await expect(opfsUsage()).rejects.toThrow(/OPFS/);
    await expect(listOpfs()).rejects.toThrow(/OPFS/);
    await expect(removeOpfsPath('x/y')).resolves.toBe(false);
  });
});

describe('OPFS wrappers with a fake OPFS', () => {
  afterEach(() => vi.unstubAllGlobals());

  function fakeOpfs() {
    const files = new Map<string, Uint8Array>();
    const handle = (name: string) => ({
      kind: 'file' as const,
      getFile: async () => new Blob([(files.get(name) ?? new Uint8Array(0)) as Uint8Array<ArrayBuffer>]),
      createSyncAccessHandle: async () => ({
        read(buf: Uint8Array, o?: { at?: number }) {
          const d = files.get(name)!;
          const at = o?.at ?? 0;
          const part = d.subarray(at, at + buf.length);
          buf.set(part);
          return part.length;
        },
        write(buf: Uint8Array, o?: { at?: number }) {
          const d = files.get(name)!;
          const at = o?.at ?? 0;
          const next = new Uint8Array(Math.max(d.length, at + buf.length));
          next.set(d);
          next.set(buf, at);
          files.set(name, next);
          return buf.length;
        },
        truncate(n: number) {
          files.set(name, files.get(name)!.slice(0, n));
        },
        getSize: () => files.get(name)!.length,
        flush() {},
        close() {},
      }),
    });
    const dir = {
      async getFileHandle(name: string, o?: { create?: boolean }) {
        if (!files.has(name)) {
          if (!o?.create) throw new Error('NotFound');
          files.set(name, new Uint8Array(0));
        }
        return handle(name);
      },
      async removeEntry(name: string) {
        if (name === 'locked.bin') throw Object.assign(new Error('locked'), { name: 'NoModificationAllowedError' });
        if (!files.delete(name)) throw Object.assign(new Error('NotFound'), { name: 'NotFoundError' });
      },
      async *entries() {
        for (const name of files.keys()) yield [name, handle(name)] as const;
      },
    };
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => dir } });
    return files;
  }

  it('writes and reads sample records', async () => {
    const files = fakeOpfs();
    const w = await openSampleWriter('s.bin', 3);
    w.write(0, new Uint8Array([1, 2, 3]));
    w.write(2, new Uint8Array([7, 8, 9]));
    expect(w.count()).toBe(3);
    expect(Array.from(w.read(2))).toEqual([7, 8, 9]);
    expect(() => w.read(5)).toThrow(RangeError);
    w.truncate(1);
    expect(w.count()).toBe(1);
    w.flush();
    w.close();
    expect(files.get('s.bin')!.length).toBe(3);
    const r = (await openSampleReader('s.bin', 3))!;
    expect(await r.count()).toBe(1);
    expect(Array.from(await r.read(0))).toEqual([1, 2, 3]);
    expect(await opfsUsage()).toBe(3);
    await deleteFile('s.bin');
    expect(files.has('s.bin')).toBe(false);
  });

  it('probes the OPFS quota and removes the probe file', async () => {
    const files = fakeOpfs();
    const { probeOpfsQuota } = await import('./quota');
    const r = await probeOpfsQuota(1024);
    expect(r).toMatchObject({ bytesWritten: 1024, stoppedBy: 'cap' });
    expect(files.has('quota-probe.bin')).toBe(false);
  });

  it('lists, plans and removes leftovers', async () => {
    const files = fakeOpfs();
    files.set('samples-v1.bin', new Uint8Array(10));
    files.set('samples-gone.bin', new Uint8Array(5));
    files.set('quota-probe.bin', new Uint8Array(7));
    const entries = await listOpfs();
    expect(entries.map((e) => e.path)).toEqual(['quota-probe.bin', 'samples-gone.bin', 'samples-v1.bin']);
    const plan = planCleanup(entries, ['v1'], [], sampleFileName);
    expect(plan.keep.map((e) => e.path)).toEqual(['samples-v1.bin']);
    expect(plan.remove.map((e) => e.path)).toEqual(['quota-probe.bin', 'samples-gone.bin']);
    expect(plan.removeBytes).toBe(12);
    for (const e of plan.remove) expect(await removeOpfsPath(e.path)).toBe(true);
    expect(await removeOpfsPath('does-not-exist')).toBe(true);
    expect(await removeOpfsPath('')).toBe(false);
    files.set('locked.bin', new Uint8Array(1));
    expect(await removeOpfsPath('locked.bin')).toBe(false);
    files.delete('locked.bin');
    expect([...files.keys()]).toEqual(['samples-v1.bin']);
  });

  it('keeps unreadable (in use) files out of the removal plan', () => {
    const plan = planCleanup([{ path: 'quota-probe.bin', size: -1 }, { path: 'old.bin', size: 3 }], [], [], sampleFileName);
    expect(plan.inUse.map((e) => e.path)).toEqual(['quota-probe.bin']);
    expect(plan.remove.map((e) => e.path)).toEqual(['old.bin']);
    expect(plan.removeBytes).toBe(3);
  });

  it('detects short writes', async () => {
    fakeOpfs();
    const w = await openSampleWriter('t.bin', 4);
    expect(() => w.write(0, new Uint8Array([1, 2]))).toThrow(/Short write/);
  });
});

describe('quota helpers', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('estimates and requests persistence when available', async () => {
    vi.stubGlobal('navigator', {
      storage: {
        estimate: async () => ({ quota: 1000, usage: 100 }),
        persisted: async () => false,
        persist: async () => true,
      },
    });
    expect(await estimateStorage()).toEqual({ quota: 1000, usage: 100, persisted: false });
    expect(await requestPersistence()).toBe(true);
  });

  it('degrades without the Storage API', async () => {
    vi.stubGlobal('navigator', {});
    expect(await estimateStorage()).toEqual({ quota: null, usage: null, persisted: null });
    expect(await requestPersistence()).toBeNull();
    vi.stubGlobal('navigator', { storage: { persist: async () => { throw new Error('x'); } } });
    expect(await estimateStorage()).toEqual({ quota: null, usage: null, persisted: null });
    vi.stubGlobal('navigator', { storage: { estimate: async () => { throw new Error('x'); }, persisted: async () => { throw new Error('y'); } } });
    expect(await requestPersistence()).toBeNull();
    expect(await estimateStorage()).toEqual({ quota: null, usage: null, persisted: null });
  });

  it('warns before exceeding the quota', () => {
    expect(wouldExceedQuota({ quota: 1000, usage: 100, persisted: null }, 700)).toBe(false);
    expect(wouldExceedQuota({ quota: 1000, usage: 100, persisted: null }, 850)).toBe(true);
    expect(wouldExceedQuota({ quota: null, usage: null, persisted: null }, 1e12)).toBe(false);
  });

  it('probes writable bytes until the cap or an error, then cleans up', async () => {
    let removed = 0;
    const ok = await probeWritable(
      async () => ({ write: (c) => c.length, close: () => {} }),
      async () => void removed++,
      10,
      4,
    );
    expect(ok).toMatchObject({ bytesWritten: 10, stoppedBy: 'cap' });
    let total = 0;
    const progress: number[] = [];
    const full = await probeWritable(
      async () => ({
        write: (c) => {
          if (total >= 8) throw new Error('QuotaExceededError');
          total += c.length;
          return c.length;
        },
        close: () => {
          throw new Error('close failed');
        },
      }),
      async () => void removed++,
      100,
      4,
      (b) => progress.push(b),
    );
    expect(full).toMatchObject({ bytesWritten: 8, stoppedBy: 'error' });
    expect(full.error).toMatch(/Quota/);
    expect(progress).toEqual([4, 8]);
    const zero = await probeWritable(async () => ({ write: () => 0, close: () => {} }), async () => {}, 10, 4);
    expect(zero.stoppedBy).toBe('error');
    expect(removed).toBe(2);
  });
});
