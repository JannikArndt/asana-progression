import type { DetectionParams, SignalChunk } from '../../detection';
import type { QuotaProbeResult } from '../../storage';
import type { SamplerStats, VideoMeta } from '../../source';
import type { WorkerEvent, WorkerRequest } from './protocol';
import { WakeLock } from './wake-lock';

export type PipelineStatus = 'idle' | 'running' | 'detecting' | 'done' | 'cancelled' | 'error';

export interface RunRequest {
  file: File;
  videoId: string;
  fingerprint: string;
  params: DetectionParams;
  skipNonReference: boolean;
  resume: boolean;
}

const MAX_AUTO_RETRIES = 3;

/** Main-thread side of the processing worker. Reactive state for the processing screen. */
export class Pipeline {
  status = $state<PipelineStatus>('idle');
  videoId = $state<string | null>(null);
  fileName = $state('');
  meta = $state<VideoMeta | null>(null);
  totalSamples = $state(0);
  index = $state(0);
  mediaTimeS = $state(0);
  sampler = $state<SamplerStats | null>(null);
  error = $state<string | null>(null);
  opfs = $state(true);
  retries = $state(0);
  skipNonReference = $state(true);
  wakeLock = $state<WakeLock['status']>('off');
  /** C(t) so far; mutated in place, `cVersion` bumps on change. */
  C = new Float32Array(0);
  cVersion = $state(0);
  cAvailable = $state(0);
  /** Media seconds per wall second (smoothed) and remaining time estimate. */
  rate = $state(0);
  etaS = $state<number | null>(null);

  private worker: Worker | null = null;
  private jobId = 0;
  private waiters = new Map<number, (e: WorkerEvent) => void>();
  private listeners = new Map<number, (e: WorkerEvent) => void>();
  private lock: WakeLock | null = null;
  private rateRef = { wall: 0, media: 0 };
  sampleHz = $state(4);

  get running(): boolean {
    return this.status === 'running' || this.status === 'detecting';
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('./analyze.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<WorkerEvent>) => this.onEvent(e.data);
    w.onerror = (e) => {
      const id = this.jobId;
      this.onEvent({ type: 'error', jobId: id, message: e.message || 'Worker crashed', stage: 'worker', progressed: false });
    };
    this.worker = w;
    return w;
  }

  private send(req: WorkerRequest) {
    this.ensureWorker().postMessage(req);
  }

  private onEvent(e: WorkerEvent) {
    if ('jobId' in e) this.listeners.get(e.jobId)?.(e);
    const terminal = e.type === 'done' || e.type === 'cancelled' || e.type === 'error' || e.type === 'quota-result';
    if (terminal && 'jobId' in e) {
      this.waiters.get(e.jobId)?.(e);
      this.waiters.delete(e.jobId);
      this.listeners.delete(e.jobId);
    }
  }

  private request(build: (jobId: number) => WorkerRequest, listen?: (e: WorkerEvent) => void): Promise<WorkerEvent> {
    const jobId = ++this.jobId;
    return new Promise((resolve) => {
      this.waiters.set(jobId, resolve);
      if (listen) this.listeners.set(jobId, listen);
      this.send(build(jobId));
    });
  }

  private appendC(chunk: SignalChunk, replace = false) {
    const end = chunk.from + chunk.C.length;
    if (end > this.C.length || replace) {
      const next = new Float32Array(Math.max(end, this.totalSamples, this.C.length)).fill(NaN);
      if (!replace) next.set(this.C.subarray(0, Math.min(this.C.length, next.length)));
      this.C = next;
    }
    this.C.set(chunk.C, chunk.from);
    this.cAvailable = Math.max(replace ? 0 : this.cAvailable, end);
    this.cVersion++;
  }

  private updateRate() {
    const now = performance.now();
    const wall = (now - this.rateRef.wall) / 1000;
    const media = this.mediaTimeS - this.rateRef.media;
    if (wall > 1.5 && media > 0) {
      const r = media / wall;
      this.rate = this.rate > 0 ? 0.7 * this.rate + 0.3 * r : r;
      this.rateRef = { wall: now, media: this.mediaTimeS };
    }
    const dur = this.meta?.durationS ?? 0;
    this.etaS = this.rate > 0 ? Math.max(0, (dur - this.mediaTimeS) / this.rate) : null;
  }

  /** Processes a video; resolves with the final status. Retries after recoverable errors. */
  async run(req: RunRequest): Promise<PipelineStatus> {
    this.lock ??= new WakeLock();
    this.lock.onchange = () => (this.wakeLock = this.lock!.status);
    this.reset(req);
    await this.lock.enable();
    this.wakeLock = this.lock.status;
    try {
      let attempt = { ...req };
      for (;;) {
        const debug = debugOptions();
        const result = await this.request(
          (jobId) => ({ type: 'analyze', jobId, ...attempt, ...(debug ? { debug } : {}) }),
          (e) => this.onRunEvent(e),
        );
        if (result.type === 'done') {
          this.status = 'done';
          return 'done';
        }
        if (result.type === 'cancelled') {
          this.status = 'cancelled';
          return 'cancelled';
        }
        if (result.type !== 'error') continue;
        this.error = `${result.stage}: ${result.message}`;
        const retryable = result.stage === 'decode' && this.retries < MAX_AUTO_RETRIES;
        if (!retryable) {
          this.status = 'error';
          return 'error';
        }
        // A decoder that fails without any progress with packet skipping on: retry decoding everything.
        if (!result.progressed && attempt.skipNonReference) attempt = { ...attempt, skipNonReference: false };
        this.retries++;
        this.skipNonReference = attempt.skipNonReference;
        await waitUntilVisible();
        attempt = { ...attempt, resume: true };
        this.status = 'running';
      }
    } finally {
      await this.lock.disable();
      this.wakeLock = this.lock.status;
    }
  }

  private reset(req: RunRequest) {
    this.status = 'running';
    this.videoId = req.videoId;
    this.fileName = req.file.name;
    this.meta = null;
    this.error = null;
    this.retries = 0;
    this.index = 0;
    this.mediaTimeS = 0;
    this.sampler = null;
    this.rate = 0;
    this.etaS = null;
    this.skipNonReference = req.skipNonReference;
    this.sampleHz = req.params.sampleHz;
    this.C = new Float32Array(0);
    this.cAvailable = 0;
    this.cVersion++;
  }

  private onRunEvent(e: WorkerEvent) {
    switch (e.type) {
      case 'started':
        this.meta = e.meta;
        this.totalSamples = e.totalSamples;
        this.opfs = e.opfs;
        this.index = e.startIndex;
        this.mediaTimeS = e.startIndex / this.sampleHz;
        this.rateRef = { wall: performance.now(), media: this.mediaTimeS };
        if (e.restored) this.appendC(e.restored, true);
        else this.appendC({ from: 0, C: new Float32Array(0) }, true);
        break;
      case 'progress':
        this.index = e.index;
        this.mediaTimeS = e.mediaTimeS;
        this.sampler = e.sampler;
        if (e.chunk.C.length) this.appendC(e.chunk);
        this.updateRate();
        if (this.index >= this.totalSamples - 1) this.status = 'detecting';
        break;
    }
  }

  cancel() {
    this.worker?.postMessage({ type: 'cancel' } satisfies WorkerRequest);
  }

  async reanalyze(videoId: string, params: DetectionParams, onProgress?: (done: number, total: number) => void): Promise<void> {
    const r = await this.request(
      (jobId) => ({ type: 'reanalyze', jobId, videoId, params }),
      (e) => {
        if (e.type === 'reanalyze-progress') onProgress?.(e.done, e.total);
      },
    );
    if (r.type === 'error') throw new Error(r.message);
  }

  async probeQuota(capBytes: number, onProgress?: (bytes: number) => void): Promise<QuotaProbeResult> {
    const r = await this.request(
      (jobId) => ({ type: 'probe-quota', jobId, capBytes }),
      (e) => {
        if (e.type === 'quota-progress') onProgress?.(e.bytes);
      },
    );
    if (r.type !== 'quota-result') throw new Error('Quota probe failed');
    return r.result;
  }
}

/** Debug knobs (set in localStorage, used by the end-to-end tests). */
function debugOptions(): { sampleDelayMs?: number; checkpointMs?: number } | null {
  try {
    const raw = localStorage.getItem('asana.debug.pipeline');
    return raw ? (JSON.parse(raw) as { sampleDelayMs?: number; checkpointMs?: number }) : null;
  } catch {
    return null;
  }
}

function waitUntilVisible(): Promise<void> {
  if (document.visibilityState === 'visible') return new Promise((r) => setTimeout(r, 500));
  return new Promise((resolve) => {
    const on = () => {
      if (document.visibilityState !== 'visible') return;
      document.removeEventListener('visibilitychange', on);
      setTimeout(resolve, 500);
    };
    document.addEventListener('visibilitychange', on);
  });
}

export const pipeline = new Pipeline();
