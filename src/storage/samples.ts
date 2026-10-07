import type { SampleReader, SampleWriter } from './types';

/** Subset of FileSystemSyncAccessHandle (OPFS, dedicated workers only). */
interface SyncHandle {
  read(buffer: Uint8Array, options?: { at?: number }): number;
  write(buffer: Uint8Array, options?: { at?: number }): number;
  truncate(size: number): void;
  getSize(): number;
  flush(): void;
  close(): void;
}

type SyncCapableFileHandle = FileSystemFileHandle & { createSyncAccessHandle?: () => Promise<SyncHandle> };

export function sampleFileName(videoId: string): string {
  return `samples-${videoId.replace(/[^a-zA-Z0-9_-]/g, '_')}.bin`;
}

/** In-memory implementation (tests and engines without OPFS). */
export class MemorySamples implements SampleWriter {
  private buf: Uint8Array;
  private size = 0;

  constructor(readonly recordBytes: number) {
    this.buf = new Uint8Array(recordBytes * 64);
  }

  write(index: number, data: Uint8Array): void {
    const end = (index + 1) * this.recordBytes;
    if (end > this.buf.length) {
      let cap = this.buf.length;
      while (cap < end) cap *= 2;
      const next = new Uint8Array(cap);
      next.set(this.buf.subarray(0, this.size));
      this.buf = next;
    }
    this.buf.set(data.subarray(0, this.recordBytes), index * this.recordBytes);
    if (end > this.size) this.size = end;
  }

  read(index: number): Uint8Array {
    if (index < 0 || index >= this.count()) throw new RangeError(`Sample ${index} out of range`);
    return this.buf.slice(index * this.recordBytes, (index + 1) * this.recordBytes);
  }

  count(): number {
    return Math.floor(this.size / this.recordBytes);
  }

  /** Read-only async view (same interface as OPFS-backed readers). */
  asReader(): SampleReader {
    return new BlobSampleReader(new Blob([this.buf.slice(0, this.count() * this.recordBytes)]), this.recordBytes);
  }

  truncate(records: number): void {
    this.size = Math.min(this.size, records * this.recordBytes);
  }

  flush(): void {}
  close(): void {}
}

/** OPFS sample file with a synchronous access handle (dedicated worker only). */
class OpfsSampleWriter implements SampleWriter {
  constructor(
    private readonly handle: SyncHandle,
    readonly recordBytes: number,
  ) {}

  write(index: number, data: Uint8Array): void {
    const n = this.handle.write(data.subarray(0, this.recordBytes), { at: index * this.recordBytes });
    if (n !== this.recordBytes) throw new Error(`Short write (${n} of ${this.recordBytes} bytes) — storage full?`);
  }

  read(index: number): Uint8Array {
    const out = new Uint8Array(this.recordBytes);
    const n = this.handle.read(out, { at: index * this.recordBytes });
    if (n !== this.recordBytes) throw new RangeError(`Sample ${index} out of range`);
    return out;
  }

  count(): number {
    return Math.floor(this.handle.getSize() / this.recordBytes);
  }

  truncate(records: number): void {
    this.handle.truncate(Math.min(this.handle.getSize(), records * this.recordBytes));
  }

  flush(): void {
    this.handle.flush();
  }

  close(): void {
    this.handle.close();
  }
}

class BlobSampleReader implements SampleReader {
  constructor(
    private readonly file: Blob,
    readonly recordBytes: number,
  ) {}

  async count(): Promise<number> {
    return Math.floor(this.file.size / this.recordBytes);
  }

  async read(index: number): Promise<Uint8Array> {
    const b = await this.readRange(index, index + 1);
    if (b.length !== this.recordBytes) throw new RangeError(`Sample ${index} out of range`);
    return b;
  }

  async readRange(from: number, to: number): Promise<Uint8Array> {
    return new Uint8Array(await this.file.slice(from * this.recordBytes, to * this.recordBytes).arrayBuffer());
  }
}

async function root(): Promise<FileSystemDirectoryHandle> {
  if (!globalThis.navigator?.storage?.getDirectory) throw new Error('OPFS is not available');
  return navigator.storage.getDirectory();
}

/** Opens (creating if needed) a sample file for writing. Worker only. */
export async function openSampleWriter(name: string, recordBytes: number): Promise<SampleWriter> {
  const dir = await root();
  const fh = (await dir.getFileHandle(name, { create: true })) as SyncCapableFileHandle;
  if (!fh.createSyncAccessHandle) throw new Error('OPFS sync access handles are not available');
  return new OpfsSampleWriter(await fh.createSyncAccessHandle(), recordBytes);
}

/** Read-only view of a sample file (any context). Null if it does not exist. */
export async function openSampleReader(name: string, recordBytes: number): Promise<SampleReader | null> {
  try {
    const dir = await root();
    const fh = await dir.getFileHandle(name);
    return new BlobSampleReader(await fh.getFile(), recordBytes);
  } catch {
    return null;
  }
}

export async function deleteFile(name: string): Promise<void> {
  try {
    await (await root()).removeEntry(name);
  } catch {
    // already gone
  }
}

/** Total bytes of all files in the OPFS root (top level). */
export async function opfsUsage(): Promise<number> {
  const dir = await root();
  let total = 0;
  // entries() is async-iterable on all engines with OPFS.
  for await (const [, handle] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
    if (handle.kind === 'file') total += (await (handle as FileSystemFileHandle).getFile()).size;
  }
  return total;
}
