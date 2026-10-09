/**
 * Backup import worker: reads the archive, plans the merge and writes files (OPFS sync access
 * handles, which iOS only offers in workers) and records (IndexedDB).
 */
import { importBackup, openMetadataStore, OpfsAssetStore, planImport, readBackup, type BackupContents } from '../../storage';
import type { BackupEvent, BackupRequest } from './backup-protocol';

const scope = self as unknown as {
  postMessage(message: BackupEvent): void;
  onmessage: ((e: MessageEvent<BackupRequest>) => void) | null;
};

const files = new OpfsAssetStore();
let contents: BackupContents | null = null;

async function handle(req: BackupRequest) {
  const db = await openMetadataStore();
  try {
    if (req.type === 'plan') {
      contents = await readBackup(req.file);
      scope.postMessage({ type: 'plan', manifest: contents.manifest, plan: await planImport(db, files, contents) });
      return;
    }
    if (!contents) throw new Error('No backup file read');
    let last = 0;
    const result = await importBackup(db, files, contents, {
      onProgress: (phase, done, total) => {
        const t = performance.now();
        if (t - last < 100 && done < total) return;
        last = t;
        scope.postMessage({ type: 'progress', phase, done, total });
      },
    });
    contents = null;
    scope.postMessage({ type: 'done', result });
  } finally {
    db.close();
  }
}

scope.onmessage = (e) => {
  handle(e.data).catch((err: unknown) => scope.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) }));
};
