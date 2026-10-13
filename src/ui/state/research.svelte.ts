import type { ParamGrid } from '../../labeling';
import type { LabProgress, LabReport } from '../research/lab';
import type { ResearchEvent, ResearchRequest } from '../pipeline/research-protocol';
import { debugCropper } from './capture.svelte';

const APP = { version: __APP_VERSION__, builtAt: __BUILT_AT__ };

function day(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Research export and detection lab (Settings → Diagnostics), both in one worker. A finished file
 * waits in `ready` for a fresh tap (iOS only downloads or shares from a user gesture).
 */
class ResearchState {
  exporting = $state<{ phase: 'analyses' | 'poses'; done: number; total: number } | null>(null);
  labRunning = $state<LabProgress | null>(null);
  report = $state.raw<LabReport | null>(null);
  /** A file to save: the research export or the lab results. */
  ready = $state.raw<{ kind: 'export' | 'lab'; file: File; note: string } | null>(null);
  error = $state<{ kind: 'export' | 'lab'; message: string } | null>(null);
  private worker: Worker | null = null;
  private jobId = 0;
  private cancelled = false;

  get busy(): boolean {
    return !!this.exporting || !!this.labRunning;
  }

  private run(req: ResearchRequest, kind: 'export' | 'lab', on: (e: ResearchEvent) => boolean): Promise<void> {
    this.worker ??= new Worker(new URL('../pipeline/research.worker.ts', import.meta.url), { type: 'module' });
    const worker = this.worker;
    return new Promise((resolve) => {
      worker.onmessage = (e: MessageEvent<ResearchEvent>) => {
        const ev = e.data;
        if (!('jobId' in ev) || ev.jobId !== this.jobId) return;
        if (ev.type === 'error') {
          // A cancelled job is no failure.
          this.error = this.cancelled ? null : { kind, message: ev.message };
          resolve();
        } else if (on(ev)) resolve();
      };
      worker.onerror = (e) => {
        this.error = { kind, message: e.message || 'Worker failed' };
        this.worker?.terminate();
        this.worker = null;
        resolve();
      };
      this.cancelled = false;
      worker.postMessage(req);
    });
  }

  /** Builds the research export in the worker; the file then waits in `ready`. */
  async exportData() {
    if (this.busy) return;
    this.error = null;
    this.ready = null;
    this.exporting = { phase: 'analyses', done: 0, total: 0 };
    const jobId = ++this.jobId;
    try {
      await this.run({ type: 'export', jobId, cropper: debugCropper(), baseUrl: import.meta.env.BASE_URL, app: APP }, 'export', (ev) => {
        if (ev.type === 'export-progress') this.exporting = { phase: ev.phase, done: ev.done, total: ev.total };
        if (ev.type !== 'export-done') return false;
        const file = new File([ev.blob], `asana-progression-research-${day(new Date())}.json`, { type: 'application/json' });
        this.ready = { kind: 'export', file, note: `${ev.videos} video${ev.videos === 1 ? '' : 's'}, ${ev.holds} hold${ev.holds === 1 ? '' : 's'}` };
        return true;
      });
    } finally {
      this.exporting = null;
    }
  }

  /** Runs the lab with every combination of `grid`; the report is shown and can be exported. */
  async runLab(grid: ParamGrid) {
    if (this.busy) return;
    this.error = null;
    this.ready = null;
    this.report = null;
    this.labRunning = { video: 0, videos: 0, combo: 0, combos: 0 };
    const jobId = ++this.jobId;
    try {
      await this.run({ type: 'lab', jobId, grid: $state.snapshot(grid) as ParamGrid, app: APP }, 'lab', (ev) => {
        if (ev.type === 'lab-progress') this.labRunning = ev.progress;
        if (ev.type !== 'lab-done') return false;
        this.report = ev.report;
        return true;
      });
    } finally {
      this.labRunning = null;
    }
  }

  /** Prepares the lab results (numbers only) as a file to save. */
  prepareReport() {
    const r = this.report;
    if (!r) return;
    const file = new File([JSON.stringify(r, null, 1)], `asana-progression-lab-${day(new Date())}.json`, { type: 'application/json' });
    this.ready = { kind: 'lab', file, note: `${r.combos.length} parameter sets on ${r.videos.length} video${r.videos.length === 1 ? '' : 's'}` };
  }

  cancel() {
    this.cancelled = true;
    this.worker?.postMessage({ type: 'cancel' } satisfies ResearchRequest);
  }
}

export const research = new ResearchState();
