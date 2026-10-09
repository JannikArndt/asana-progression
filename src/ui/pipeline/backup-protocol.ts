import type { BackupManifest, ImportPlan, ImportResult } from '../../storage';

export type BackupRequest = { type: 'plan'; file: File } | { type: 'import' };

export type BackupEvent =
  | { type: 'plan'; manifest: BackupManifest; plan: ImportPlan }
  | { type: 'progress'; phase: 'files' | 'records'; done: number; total: number }
  | { type: 'done'; result: ImportResult }
  | { type: 'error'; message: string };
