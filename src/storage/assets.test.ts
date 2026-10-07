import { afterEach, describe, expect, it, vi } from 'vitest';
import { ASSET_DIR, MemoryAssetStore, OpfsAssetStore, assetKey, mimeForKey } from './assets';

const notFound = () => new DOMException('not found', 'NotFoundError');

interface FakeFile {
  kind: 'file';
  data: Uint8Array;
}

/** Nested fake OPFS directory (the subset of FileSystemDirectoryHandle the stores use). */
class FakeDir {
  readonly kind = 'directory' as const;
  readonly children = new Map<string, FakeDir | FakeFile>();

  constructor(private readonly api: Api) {}

  async getDirectoryHandle(name: string, o?: { create?: boolean }) {
    const c = this.children.get(name);
    if (c instanceof FakeDir) return c;
    if (c) throw new DOMException('is a file', 'TypeMismatchError');
    if (!o?.create) throw notFound();
    const d = new FakeDir(this.api);
    this.children.set(name, d);
    return d;
  }

  async getFileHandle(name: string, o?: { create?: boolean }) {
    let c = this.children.get(name);
    if (c instanceof FakeDir) throw new DOMException('is a directory', 'TypeMismatchError');
    if (!c) {
      if (!o?.create) throw notFound();
      c = { kind: 'file', data: new Uint8Array(0) };
      this.children.set(name, c);
    }
    return fileHandle(name, c, this.api);
  }

  async removeEntry(name: string) {
    const c = this.children.get(name);
    if (!c) throw notFound();
    if (c instanceof FakeDir && c.children.size > 0) throw new DOMException('not empty', 'InvalidModificationError');
    this.children.delete(name);
  }

  async *entries() {
    for (const [name, c] of this.children) yield [name, c instanceof FakeDir ? c : fileHandle(name, c, this.api)] as const;
  }
}

interface Api {
  sync: boolean;
  writable: boolean;
  /** Bytes a sync write reports as written (simulates a full disk). */
  shortWrite?: number;
  failStream?: boolean;
  log: string[];
}

function fileHandle(name: string, file: FakeFile, api: Api) {
  const h: Record<string, unknown> = {
    kind: 'file',
    name,
    getFile: async () => new File([file.data as Uint8Array<ArrayBuffer>], name),
  };
  if (api.sync) {
    h.createSyncAccessHandle = async () => ({
      truncate(n: number) {
        file.data = file.data.slice(0, n);
      },
      write(buf: Uint8Array, o?: { at?: number }) {
        const at = o?.at ?? 0;
        const n = Math.min(buf.length, api.shortWrite ?? buf.length);
        const next = new Uint8Array(Math.max(file.data.length, at + n));
        next.set(file.data);
        next.set(buf.subarray(0, n), at);
        file.data = next;
        return n;
      },
      flush: () => api.log.push('flush'),
      close: () => api.log.push('close'),
    });
  }
  if (api.writable) {
    h.createWritable = async () => {
      const chunks: Uint8Array[] = [];
      return {
        async write(d: Blob) {
          if (api.failStream) throw new Error('QuotaExceededError');
          chunks.push(new Uint8Array(await d.arrayBuffer()));
        },
        async close() {
          file.data = new Uint8Array(await new Blob(chunks as Uint8Array<ArrayBuffer>[]).arrayBuffer());
          api.log.push('stream-close');
        },
        async abort() {
          api.log.push('abort');
        },
      };
    };
  }
  return h;
}

function fakeOpfs(opts: Partial<Omit<Api, 'log'>> = {}) {
  const api: Api = { sync: true, writable: false, log: [], ...opts };
  const root = new FakeDir(api);
  vi.stubGlobal('navigator', { storage: { getDirectory: async () => root } });
  return { root, api };
}

const blob = (...bytes: number[]) => new Blob([new Uint8Array(bytes)]);
const bytesOf = async (b: Blob | null) => Array.from(new Uint8Array(await b!.arrayBuffer()));

describe('asset keys', () => {
  it('builds safe keys with an extension from the MIME type', () => {
    expect(assetKey('as_1', 'image/jpeg')).toBe('assets/as_1.jpg');
    expect(assetKey('a/b:c', 'video/mp4; codecs="avc1.640028"')).toBe('assets/a_b_c.mp4');
    expect(assetKey('x', 'application/octet-stream')).toBe('assets/x.bin');
    expect(ASSET_DIR).toBe('assets');
  });

  it('maps extensions back to MIME types', () => {
    expect(mimeForKey('assets/a.jpg')).toBe('image/jpeg');
    expect(mimeForKey('assets/a.JPEG')).toBe('image/jpeg');
    expect(mimeForKey('assets/a.mp4')).toBe('video/mp4');
    expect(mimeForKey('assets/a.bin')).toBe('');
    expect(mimeForKey('assets/noext')).toBe('');
  });
});

describe('OpfsAssetStore', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('writes nested files with sync access handles, reads, replaces, deletes and sums usage', async () => {
    const { root, api } = fakeOpfs();
    const store = new OpfsAssetStore();
    await store.put('assets/a.jpg', blob(1, 2, 3));
    await store.put('/assets/clips/b.mp4', blob(4, 5, 6, 7, 8));
    expect(api.log).toEqual(['flush', 'close', 'flush', 'close']);
    expect(root.children.get('assets')).toBeInstanceOf(FakeDir);

    const a = await store.get('assets/a.jpg');
    expect(a?.type).toBe('image/jpeg');
    expect(await bytesOf(a)).toEqual([1, 2, 3]);
    expect(await bytesOf(await store.get('assets/clips/b.mp4'))).toEqual([4, 5, 6, 7, 8]);
    expect((await store.get('assets/clips/b.mp4'))?.type).toBe('video/mp4');

    // Files outside assets/ do not count.
    await store.put('samples-v1.bin', blob(9, 9));
    expect((await store.get('samples-v1.bin'))?.type).toBe('');
    expect(await store.usage()).toBe(8);

    await store.put('assets/a.jpg', blob(7));
    expect(await bytesOf(await store.get('assets/a.jpg'))).toEqual([7]);
    expect(await store.usage()).toBe(6);

    await store.delete('assets/a.jpg');
    expect(await store.get('assets/a.jpg')).toBeNull();
    expect(await store.usage()).toBe(5);
  });

  it('treats missing files and directories as absent', async () => {
    fakeOpfs();
    const store = new OpfsAssetStore();
    expect(await store.usage()).toBe(0);
    expect(await store.get('assets/missing.jpg')).toBeNull();
    expect(await store.get('nope/deeper/x.jpg')).toBeNull();
    await expect(store.delete('assets/missing.jpg')).resolves.toBeUndefined();
    await expect(store.delete('nope/x.jpg')).resolves.toBeUndefined();
  });

  it('propagates other errors and rejects invalid keys', async () => {
    const { root } = fakeOpfs();
    const store = new OpfsAssetStore();
    await store.put('assets/clips/c.mp4', blob(1));
    await expect(store.get('assets/clips')).rejects.toThrow(/directory/);
    await expect(store.delete('assets/clips')).rejects.toThrow(/not empty/);
    await expect(store.put('', blob(1))).rejects.toThrow(/Invalid asset key/);
    await expect(store.get('///')).rejects.toThrow(/Invalid asset key/);
    root.children.set('assets', { kind: 'file', data: new Uint8Array(1) });
    await expect(store.usage()).rejects.toThrow(/is a file/);
  });

  it('reports short writes and still closes the handle', async () => {
    const { api } = fakeOpfs({ shortWrite: 2 });
    const store = new OpfsAssetStore();
    await expect(store.put('assets/a.jpg', blob(1, 2, 3))).rejects.toThrow(/Short write \(2 of 3 bytes\)/);
    expect(api.log).toEqual(['close']);
  });

  it('falls back to createWritable without sync access handles', async () => {
    const { api } = fakeOpfs({ sync: false, writable: true });
    const store = new OpfsAssetStore();
    await store.put('assets/a.jpg', blob(1, 2, 3));
    await store.put('assets/a.jpg', blob(4, 5));
    expect(await bytesOf(await store.get('assets/a.jpg'))).toEqual([4, 5]);
    expect(api.log).toEqual(['stream-close', 'stream-close']);
    api.failStream = true;
    await expect(store.put('assets/b.jpg', blob(1))).rejects.toThrow(/Quota/);
    expect(api.log).toEqual(['stream-close', 'stream-close', 'abort']);
  });

  it('fails clearly without a write API or without OPFS', async () => {
    fakeOpfs({ sync: false, writable: false });
    const store = new OpfsAssetStore();
    await expect(store.put('assets/a.jpg', blob(1))).rejects.toThrow(/not available in this context/);
    vi.stubGlobal('navigator', {});
    await expect(store.put('assets/a.jpg', blob(1))).rejects.toThrow(/OPFS is not available/);
    await expect(store.get('assets/a.jpg')).rejects.toThrow(/OPFS is not available/);
    await expect(store.usage()).rejects.toThrow(/OPFS is not available/);
  });
});

describe('MemoryAssetStore', () => {
  it('puts, gets, replaces, deletes and sums usage below assets/', async () => {
    const store = new MemoryAssetStore();
    expect(await store.usage()).toBe(0);
    await store.put('assets/a.jpg', blob(1, 2, 3));
    await store.put('assets//clips/b.mp4', new Blob([new Uint8Array(4)], { type: 'video/mp4' }));
    await store.put('other.bin', blob(1));
    expect(await store.usage()).toBe(7);
    const a = await store.get('/assets/a.jpg');
    expect(a?.type).toBe('image/jpeg');
    expect(await bytesOf(a)).toEqual([1, 2, 3]);
    expect((await store.get('assets/clips/b.mp4'))?.type).toBe('video/mp4');
    await store.put('assets/a.jpg', blob(9));
    expect(await bytesOf(await store.get('assets/a.jpg'))).toEqual([9]);
    await store.delete('assets/a.jpg');
    await store.delete('assets/missing.jpg');
    expect(await store.get('assets/a.jpg')).toBeNull();
    expect(await store.usage()).toBe(4);
    await expect(store.put('/', blob(1))).rejects.toThrow(/Invalid asset key/);
  });
});
