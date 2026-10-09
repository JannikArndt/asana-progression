import { exportBackup, OpfsAssetStore, sampleBytes, type BackupManifest, type ImportPlan, type ImportResult, type StorePlan } from '../../storage';
import { formatBytes } from '../diagnostics';
import { formatDay } from '../format';
import type { BackupEvent, BackupRequest } from '../pipeline/backup-protocol';
import { app } from './app.svelte';
import { dialog } from './dialog.svelte';

/** Device-local record of the last export (a `backup.` setting is never part of a backup). */
export const LAST_EXPORT_KEY = 'backup.lastExport';

export interface LastExport {
  at: string;
  bytes: number;
  includesSamples: boolean;
}

const STORE_NAMES: Array<[keyof ImportPlan['stores'], string, string]> = [
  ['sessions', 'session', 'sessions'],
  ['holds', 'labeled hold', 'labeled holds'],
  ['assets', 'image or clip', 'images and clips'],
  ['videos', 'video', 'videos'],
  ['analyses', 'analysis', 'analyses'],
  ['asanas', 'asana', 'asanas'],
  ['templates', 'template', 'templates'],
];

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function list(plan: ImportPlan, field: keyof StorePlan): string {
  const parts = STORE_NAMES.filter(([s]) => plan.stores[s][field] > 0).map(([s, one, many]) => count(plan.stores[s][field], one, many));
  if (plan.settings[field] > 0) parts.push(count(plan.settings[field], 'setting', 'settings'));
  return parts.join(', ');
}

/** Human-readable summary of an import plan. */
export function describePlan(manifest: BackupManifest, plan: ImportPlan): string {
  const lines = [
    `Backup from ${formatDay(manifest.createdAt)}: ${count(manifest.counts.sessions, 'session', 'sessions')}, ${count(manifest.counts.holds, 'labeled hold', 'labeled holds')}, ${formatBytes(manifest.files.reduce((s, f) => s + f.bytes, 0))} of files${manifest.includesSamples ? ' (incl. analysis frames)' : ''}.`,
  ];
  const added = list(plan, 'added');
  const updated = list(plan, 'updated');
  lines.push(added ? `Adds ${added}.` : 'Adds nothing new.');
  if (updated) lines.push(`Replaces ${updated} that differ here with the backup's version.`);
  if (plan.files.length) lines.push(`Writes ${count(plan.files.length, 'file', 'files')} (${formatBytes(plan.files.reduce((s, f) => s + f.bytes, 0))}).`);
  if (plan.keptLocal.length) lines.push(`Keeps ${count(plan.keptLocal.length, 'newer image or clip', 'newer images and clips')} of this device.`);
  if (plan.missingFiles.length) lines.push(`${count(plan.missingFiles.length, 'file is', 'files are')} missing in the backup; those holds can be re-captured from the video.`);
  return lines.join('\n');
}

function nothingToDo(plan: ImportPlan): boolean {
  return plan.files.length === 0 && Object.values(plan.stores).every((s) => s.added + s.updated === 0) && plan.settings.added + plan.settings.updated === 0;
}

function fileName(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `asana-progression-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.zip`;
}

/** Export (main thread, the archive is a Blob of references to the stored files) and import (worker). */
class BackupState {
  exporting = $state<{ done: number; total: number } | null>(null);
  importing = $state<{ phase: 'reading' | 'files' | 'records'; done: number; total: number } | null>(null);
  /** The archive of the last export, waiting to be saved (a fresh tap is needed for download/share). */
  ready = $state.raw<{ file: File; manifest: BackupManifest } | null>(null);
  last = $state.raw<LastExport | null>(null);
  samplesBytes = $state<number | null>(null);
  error = $state<string | null>(null);
  private url: string | null = null;

  async load() {
    this.last = (await app.db.settings.get<LastExport>(LAST_EXPORT_KEY)) ?? null;
    try {
      this.samplesBytes = await sampleBytes(app.db, new OpfsAssetStore());
    } catch {
      this.samplesBytes = null;
    }
  }

  async export(includeSamples: boolean) {
    if (this.exporting) return;
    this.error = null;
    this.ready = null;
    this.exporting = { done: 0, total: 0 };
    let lastPost = 0;
    try {
      const now = new Date();
      const { blob, manifest } = await exportBackup(app.db, new OpfsAssetStore(), {
        includeSamples,
        appVersion: __APP_VERSION__,
        now,
        onProgress: (done, total) => {
          const t = performance.now();
          if (t - lastPost > 100 || done === total) ((lastPost = t), (this.exporting = { done, total }));
        },
      });
      this.ready = { file: new File([blob], fileName(now), { type: 'application/zip' }), manifest };
    } catch (e) {
      this.error = `Export failed: ${(e as Error).message}`;
    } finally {
      this.exporting = null;
    }
  }

  get canShare(): boolean {
    const f = this.ready?.file;
    return !!f && typeof navigator.canShare === 'function' && navigator.canShare({ files: [f] });
  }

  /** Downloads the prepared archive (must run in a tap handler). */
  save() {
    const r = this.ready;
    if (!r) return;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(r.file);
    const a = document.createElement('a');
    a.href = this.url;
    a.download = r.file.name;
    document.body.append(a);
    a.click();
    a.remove();
    void this.remember(r);
  }

  /** Opens the share sheet ("Save to Files", AirDrop …) with the archive. */
  async share() {
    const r = this.ready;
    if (!r) return;
    try {
      await navigator.share({ files: [r.file] });
      await this.remember(r);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') this.error = `Sharing failed: ${(e as Error).message}`;
    }
  }

  private async remember(r: { file: File; manifest: BackupManifest }) {
    const last: LastExport = { at: r.manifest.createdAt, bytes: r.file.size, includesSamples: r.manifest.includesSamples };
    await app.db.settings.set(LAST_EXPORT_KEY, last);
    this.last = last;
  }

  /** Reads a backup, shows what it would change, imports after confirmation, then reloads the app. */
  async import(file: File, busy: boolean) {
    if (this.importing) return;
    if (busy) {
      this.error = 'Wait until processing and capturing are finished, then import.';
      return;
    }
    this.error = null;
    this.importing = { phase: 'reading', done: 0, total: 0 };
    const worker = new Worker(new URL('../pipeline/backup.worker.ts', import.meta.url), { type: 'module' });
    const next = () =>
      new Promise<BackupEvent>((resolve) => {
        worker.onmessage = (e: MessageEvent<BackupEvent>) => {
          if (e.data.type === 'progress') this.importing = { phase: e.data.phase, done: e.data.done, total: e.data.total };
          else resolve(e.data);
        };
        worker.onerror = (e) => resolve({ type: 'error', message: e.message || 'Worker failed' });
      });
    const send = (req: BackupRequest) => worker.postMessage(req);
    try {
      let ev = next();
      send({ type: 'plan', file });
      const planned = await ev;
      if (planned.type === 'error') throw new Error(planned.message);
      if (planned.type !== 'plan') throw new Error('Unexpected worker reply');
      const message = describePlan(planned.manifest, planned.plan);
      if (nothingToDo(planned.plan)) {
        await dialog.ask({ title: 'Already up to date', message, options: [{ id: 'ok', label: 'OK', kind: 'primary' }] });
        return;
      }
      const go = await dialog.ask({
        title: 'Import backup?',
        message,
        options: [
          { id: 'import', label: 'Import', kind: 'primary' },
          { id: 'cancel', label: 'Cancel', kind: 'quiet' },
        ],
      });
      if (go !== 'import') return;
      ev = next();
      send({ type: 'import' });
      const done = await ev;
      if (done.type === 'error') throw new Error(done.message);
      if (done.type !== 'done') throw new Error('Unexpected worker reply');
      await dialog.ask({ title: 'Backup imported', message: describeResult(done.result), options: [{ id: 'ok', label: 'Reload app', kind: 'primary' }] });
      location.reload();
    } catch (e) {
      this.error = `Import failed: ${(e as Error).message}`;
    } finally {
      worker.terminate();
      this.importing = null;
    }
  }
}

function describeResult(r: ImportResult): string {
  const lines = [`Wrote ${count(r.filesWritten, 'file', 'files')} (${formatBytes(r.bytesWritten)}).`];
  const added = list(r.plan, 'added');
  const updated = list(r.plan, 'updated');
  if (added) lines.push(`Added ${added}.`);
  if (updated) lines.push(`Replaced ${updated}.`);
  if (r.damaged.length) lines.push(`Skipped ${count(r.damaged.length, 'damaged file', 'damaged files')}: ${r.damaged.slice(0, 5).join(', ')}${r.damaged.length > 5 ? ' …' : ''}`);
  lines.push('The app reloads to show the imported data.');
  return lines.join('\n');
}

export const backup = new BackupState();
