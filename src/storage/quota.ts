import type { QuotaProbeResult, StorageEstimateInfo } from './types';

export async function estimateStorage(): Promise<StorageEstimateInfo> {
  const s = globalThis.navigator?.storage;
  if (!s) return { quota: null, usage: null, persisted: null };
  const [est, persisted] = await Promise.all([
    s.estimate ? s.estimate().catch(() => null) : Promise.resolve(null),
    s.persisted ? s.persisted().catch(() => null) : Promise.resolve(null),
  ]);
  return { quota: est?.quota ?? null, usage: est?.usage ?? null, persisted };
}

/** Asks for persistent storage. Returns the resulting state (null if unsupported). */
export async function requestPersistence(): Promise<boolean | null> {
  const s = globalThis.navigator?.storage;
  if (!s?.persist) return null;
  try {
    return await s.persist();
  } catch {
    return null;
  }
}

/** True if writing `bytes` more would exceed the estimated quota (with a safety margin). */
export function wouldExceedQuota(info: StorageEstimateInfo, bytes: number, margin = 0.9): boolean {
  if (info.quota === null || info.usage === null) return false;
  return info.usage + bytes > info.quota * margin;
}

interface ProbeFile {
  write(chunk: Uint8Array, at: number): number;
  close(): void;
}

/**
 * Measures how much can actually be written: appends `chunkBytes` until `capBytes` or an error,
 * then deletes the file. `open` abstracts the OPFS sync handle so the loop is testable.
 */
export async function probeWritable(
  open: () => Promise<ProbeFile>,
  remove: () => Promise<void>,
  capBytes: number,
  chunkBytes = 64 * 1024 * 1024,
  onProgress?: (bytes: number) => void,
): Promise<QuotaProbeResult> {
  const t0 = performance.now();
  const chunk = new Uint8Array(chunkBytes);
  for (let i = 0; i < chunk.length; i += 4096) chunk[i] = i & 0xff; // avoid trivially sparse files
  let written = 0;
  let file: ProbeFile | null = null;
  try {
    file = await open();
    while (written < capBytes) {
      const n = file.write(chunk.subarray(0, Math.min(chunkBytes, capBytes - written)), written);
      if (n <= 0) throw new Error('write returned 0 bytes');
      written += n;
      onProgress?.(written);
      await new Promise((r) => setTimeout(r, 0));
    }
    return { bytesWritten: written, stoppedBy: 'cap', ms: performance.now() - t0 };
  } catch (e) {
    return { bytesWritten: written, stoppedBy: 'error', error: String(e), ms: performance.now() - t0 };
  } finally {
    try {
      file?.close();
    } catch {
      // ignore
    }
    await remove();
  }
}

/** OPFS quota probe (dedicated worker only). */
export async function probeOpfsQuota(capBytes: number, onProgress?: (bytes: number) => void): Promise<QuotaProbeResult> {
  const name = 'quota-probe.bin';
  const dir = await navigator.storage.getDirectory();
  return probeWritable(
    async () => {
      const fh = (await dir.getFileHandle(name, { create: true })) as FileSystemFileHandle & {
        createSyncAccessHandle(): Promise<{ write(b: Uint8Array, o: { at: number }): number; flush(): void; close(): void }>;
      };
      const h = await fh.createSyncAccessHandle();
      return {
        write: (c, at) => h.write(c, { at }),
        close: () => {
          h.flush();
          h.close();
        },
      };
    },
    async () => {
      try {
        await dir.removeEntry(name);
      } catch {
        // ignore
      }
    },
    capBytes,
    undefined,
    onProgress,
  );
}
