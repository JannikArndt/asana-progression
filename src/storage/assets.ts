import type { AssetStore } from './types';

/** OPFS directory holding all asset files. */
export const ASSET_DIR = 'assets';

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};
const MIME_BY_EXT: Record<string, string> = {
  ...Object.fromEntries(Object.entries(EXT_BY_MIME).map(([m, e]) => [e, m])),
  jpeg: 'image/jpeg',
};

/** Storage key of an asset file, e.g. "assets/<id>.jpg". */
export function assetKey(assetId: string, mime: string): string {
  const ext = EXT_BY_MIME[mime.split(';')[0]!.trim().toLowerCase()] ?? 'bin';
  return `${ASSET_DIR}/${assetId.replace(/[^a-zA-Z0-9_-]/g, '_')}.${ext}`;
}

/** MIME type implied by a key's extension ('' if unknown). */
export function mimeForKey(key: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(key)?.[1]?.toLowerCase();
  return (ext && MIME_BY_EXT[ext]) || '';
}

function splitKey(key: string): { dirs: string[]; name: string } {
  const parts = key.split('/').filter(Boolean);
  const name = parts.pop();
  if (!name) throw new Error(`Invalid asset key "${key}"`);
  return { dirs: parts, name };
}

function normKey(key: string): string {
  const { dirs, name } = splitKey(key);
  return [...dirs, name].join('/');
}

/** Restores the type that OPFS files lose (needed for e.g. `<video>` playback of blob URLs). */
function typed(blob: Blob, key: string): Blob {
  const mime = mimeForKey(key);
  return blob.type || !mime ? blob : blob.slice(0, blob.size, mime);
}

function isNotFound(e: unknown): boolean {
  return (e as { name?: unknown } | null)?.name === 'NotFoundError';
}

/** Subset of FileSystemSyncAccessHandle (OPFS, dedicated workers only). */
interface SyncHandle {
  write(buffer: Uint8Array, options?: { at?: number }): number;
  truncate(size: number): void;
  flush(): void;
  close(): void;
}

interface Writable {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
  abort?(reason?: unknown): Promise<void>;
}

/** The parts of FileSystemFileHandle used here; both write APIs are optional depending on the context. */
interface FileHandle {
  getFile(): Promise<File>;
  createSyncAccessHandle?: () => Promise<SyncHandle>;
  createWritable?: () => Promise<Writable>;
}

type Dir = FileSystemDirectoryHandle & { entries(): AsyncIterable<[string, FileSystemHandle]> };

async function opfsRoot(): Promise<Dir> {
  if (!globalThis.navigator?.storage?.getDirectory) throw new Error('OPFS is not available');
  return (await navigator.storage.getDirectory()) as Dir;
}

async function directory(dirs: string[], create: boolean): Promise<Dir> {
  let dir = await opfsRoot();
  for (const d of dirs) dir = (await dir.getDirectoryHandle(d, { create })) as Dir;
  return dir;
}

function writeSync(handle: SyncHandle, bytes: Uint8Array): void {
  try {
    handle.truncate(0);
    const n = handle.write(bytes, { at: 0 });
    if (n !== bytes.length) throw new Error(`Short write (${n} of ${bytes.length} bytes) — storage full?`);
    handle.flush();
  } finally {
    handle.close();
  }
}

async function writeStream(w: Writable, data: Blob): Promise<void> {
  try {
    await w.write(data);
    await w.close();
  } catch (e) {
    await w.abort?.(e).catch(() => {});
    throw e;
  }
}

async function dirSize(dir: Dir): Promise<number> {
  let total = 0;
  for await (const [, handle] of dir.entries()) {
    if (handle.kind === 'directory') total += await dirSize(handle as Dir);
    else total += (await (handle as FileSystemFileHandle).getFile()).size;
  }
  return total;
}

/**
 * Asset files in OPFS, addressed by slash-separated keys from the OPFS root ("assets/<id>.jpg").
 * Writes use a sync access handle where available (dedicated workers), else createWritable
 * (not available on the main thread of older Safari versions: write from a worker there).
 */
export class OpfsAssetStore implements AssetStore {
  async put(key: string, data: Blob): Promise<void> {
    const { dirs, name } = splitKey(key);
    const dir = await directory(dirs, true);
    const fh = (await dir.getFileHandle(name, { create: true })) as unknown as FileHandle;
    if (fh.createSyncAccessHandle) {
      const bytes = new Uint8Array(await data.arrayBuffer());
      return writeSync(await fh.createSyncAccessHandle(), bytes);
    }
    if (fh.createWritable) return writeStream(await fh.createWritable(), data);
    throw new Error('Writing OPFS files is not available in this context');
  }

  async get(key: string): Promise<Blob | null> {
    const { dirs, name } = splitKey(key);
    try {
      const dir = await directory(dirs, false);
      const fh = (await dir.getFileHandle(name)) as unknown as FileHandle;
      return typed(await fh.getFile(), key);
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    const { dirs, name } = splitKey(key);
    try {
      await (await directory(dirs, false)).removeEntry(name);
    } catch (e) {
      if (!isNotFound(e)) throw e;
    }
  }

  /** Total bytes of all files below `assets/`. */
  async usage(): Promise<number> {
    try {
      return await dirSize(await directory([ASSET_DIR], false));
    } catch (e) {
      if (isNotFound(e)) return 0;
      throw e;
    }
  }
}

/** In-memory implementation (tests and engines without OPFS). */
export class MemoryAssetStore implements AssetStore {
  private readonly files = new Map<string, Blob>();

  async put(key: string, data: Blob): Promise<void> {
    this.files.set(normKey(key), data);
  }

  async get(key: string): Promise<Blob | null> {
    const blob = this.files.get(normKey(key));
    return blob ? typed(blob, key) : null;
  }

  async delete(key: string): Promise<void> {
    this.files.delete(normKey(key));
  }

  /** Total bytes of all files below `assets/` (like the OPFS store). */
  async usage(): Promise<number> {
    let total = 0;
    for (const [key, b] of this.files) if (key.startsWith(`${ASSET_DIR}/`)) total += b.size;
    return total;
  }
}
