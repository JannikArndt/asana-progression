/** OPFS inventory and cleanup (works on the main thread and in workers). */

export interface OpfsEntry {
  /** Slash-separated path from the OPFS root, e.g. "samples-vid_1.bin" or "assets/a.jpg". */
  path: string;
  size: number;
}

type Dir = FileSystemDirectoryHandle & { entries(): AsyncIterable<[string, FileSystemHandle]> };

async function root(): Promise<Dir> {
  if (!globalThis.navigator?.storage?.getDirectory) throw new Error('OPFS is not available');
  return (await navigator.storage.getDirectory()) as Dir;
}

/** All files below the OPFS root, recursively. */
export async function listOpfs(): Promise<OpfsEntry[]> {
  const out: OpfsEntry[] = [];
  async function walk(dir: Dir, prefix: string) {
    for await (const [name, handle] of dir.entries()) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === 'directory') await walk(handle as Dir, path);
      else {
        let size = 0;
        try {
          size = (await (handle as FileSystemFileHandle).getFile()).size;
        } catch {
          size = -1; // locked by an open sync handle
        }
        out.push({ path, size });
      }
    }
  }
  await walk(await root(), '');
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** Removes a file (or directory, recursively) by path. Missing entries are ignored. */
export async function removeOpfsPath(path: string): Promise<void> {
  const parts = path.split('/').filter(Boolean);
  const name = parts.pop();
  if (!name) return;
  try {
    let dir: FileSystemDirectoryHandle = await root();
    for (const p of parts) dir = await dir.getDirectoryHandle(p);
    await dir.removeEntry(name, { recursive: true });
  } catch {
    // already gone
  }
}

export interface CleanupPlan {
  keep: OpfsEntry[];
  remove: OpfsEntry[];
  removeBytes: number;
}

/**
 * Decides which OPFS files are leftovers: everything that is not a sample file of a known video
 * and not a referenced asset file (quota probes, samples of deleted videos, orphaned assets).
 */
export function planCleanup(entries: OpfsEntry[], knownVideoIds: Iterable<string>, referencedAssetPaths: Iterable<string>, sampleName: (videoId: string) => string): CleanupPlan {
  const keepNames = new Set<string>();
  for (const id of knownVideoIds) keepNames.add(sampleName(id));
  for (const p of referencedAssetPaths) keepNames.add(p);
  const keep: OpfsEntry[] = [];
  const remove: OpfsEntry[] = [];
  for (const e of entries) (keepNames.has(e.path) ? keep : remove).push(e);
  return { keep, remove, removeBytes: remove.reduce((s, e) => s + Math.max(0, e.size), 0) };
}
