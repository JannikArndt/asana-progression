import { OpfsAssetStore } from '../../storage';
import type { ClipQuality } from '../../capture';
import type { Asset, Hold } from '../../model';
import type { CaptureEvent, CaptureRequest } from '../pipeline/capture-protocol';
import { app } from './app.svelte';
import { CROP_VERSION, type BodyBox } from '../../crop';
import { needsCapture, recropStill, replacedAssets, withAutoCrop } from './capture-plan';

export type CaptureStatus = 'queued' | 'capturing' | 'done' | 'error' | 'needs-file';

const assetStore = new OpfsAssetStore();
const urls = new Map<string, Promise<string | null>>();

/** Object URL for an asset file (cached for the page's lifetime). */
export function assetUrl(asset: Pick<Asset, 'storageKey'>): Promise<string | null> {
  let u = urls.get(asset.storageKey);
  if (!u) {
    u = assetStore.get(asset.storageKey).then((b) => (b ? URL.createObjectURL(b) : null));
    urls.set(asset.storageKey, u);
  }
  return u;
}

/** Removes asset records and files (e.g. when a hold is deleted or re-captured). */
export async function deleteAssets(list: Asset[]): Promise<void> {
  for (const a of list) {
    await app.db.assets.delete(a.id);
    await assetStore.delete(a.storageKey);
    const u = urls.get(a.storageKey);
    urls.delete(a.storageKey);
    void u?.then((x) => x && URL.revokeObjectURL(x));
  }
  app.removeAssets(list.map((a) => a.id));
}

function debugCropper(): 'mediapipe' | 'none' {
  try {
    const raw = localStorage.getItem('asana.debug.capture');
    return raw && (JSON.parse(raw) as { cropper?: string }).cropper === 'none' ? 'none' : 'mediapipe';
  } catch {
    return 'mediapipe';
  }
}

/** Crop version to record for a pose detection run by `cropper` (none for the null cropper). */
function cropVersion(cropper: string): number | null {
  return cropper === 'none' ? null : CROP_VERSION;
}

/**
 * Background capture of stills, thumbnails and clips for labeled holds. Runs one video at a time
 * in a worker; needs the video file picked in this browser session. Stills whose automatic crop
 * is from an older crop version are cropped again from the stored file (no video needed).
 */
class CaptureQueue {
  status = $state.raw<Record<string, CaptureStatus>>({});
  errors = $state.raw<Record<string, string>>({});
  cropper = $state<string | null>(null);
  private pending = new Map<string, Hold>();
  private recropping = new Map<string, Asset>();
  private running = false;
  private worker: Worker | null = null;
  private jobId = 0;

  get busy(): boolean {
    return this.running;
  }

  private set(holdId: string, s: CaptureStatus, error?: string) {
    this.status = { ...this.status, [holdId]: s };
    if (error !== undefined) this.errors = { ...this.errors, [holdId]: error };
  }

  /** Queues labeled holds whose still/thumbnail/clip is missing or stale. */
  request(holds: Hold[], force = false) {
    for (const h of holds) {
      const need = needsCapture(h, app.assets);
      if (!force && !need.still && !need.clip) {
        if (!this.status[h.id]) this.set(h.id, 'done');
        continue;
      }
      if (!app.files.has(h.videoId)) {
        this.set(h.id, 'needs-file');
        continue;
      }
      this.pending.set(h.id, h);
      this.set(h.id, 'queued');
    }
    this.recropStale(holds);
    void this.pump();
  }

  /** Queues holds whose automatic crop is from an older crop version (skipped with the debug null cropper). */
  recropStale(holds: Hold[]) {
    if (debugCropper() === 'none') return;
    let added = false;
    for (const h of holds) {
      const still = recropStill(h, app.assets, CROP_VERSION);
      if (still && !this.pending.has(h.id) && !this.recropping.has(h.id)) {
        this.recropping.set(h.id, still);
        added = true;
      }
    }
    if (added) void this.pump();
  }

  /** Holds waiting for their video file, by video id. */
  waitingForFile(holds: Hold[]): Set<string> {
    return new Set(holds.filter((h) => this.status[h.id] === 'needs-file').map((h) => h.videoId));
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL('../pipeline/capture.worker.ts', import.meta.url), { type: 'module' });
    return this.worker;
  }

  private async pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending.size || this.recropping.size) {
        if (!this.pending.size) {
          const batch = [...this.recropping];
          this.recropping.clear();
          await this.runRecrop(batch.map(([id, still]) => ({ id, stillKey: still.storageKey })));
          continue;
        }
        const first = this.pending.values().next().value as Hold;
        const batch = [...this.pending.values()].filter((h) => h.videoId === first.videoId);
        for (const h of batch) this.pending.delete(h.id);
        const file = app.files.get(first.videoId);
        if (!file) {
          for (const h of batch) this.set(h.id, 'needs-file');
          continue;
        }
        await this.runBatch(file, first.videoId, batch);
      }
    } finally {
      this.running = false;
    }
  }

  private runBatch(file: File, videoId: string, holds: Hold[]): Promise<void> {
    const worker = this.ensureWorker();
    const jobId = ++this.jobId;
    const quality: ClipQuality = app.clipQuality;
    return new Promise((resolve) => {
      const chain: Array<Promise<void>> = [];
      worker.onmessage = (e: MessageEvent<CaptureEvent>) => {
        const ev = e.data;
        if (ev.jobId !== jobId) return;
        switch (ev.type) {
          case 'hold-start':
            this.set(ev.holdId, 'capturing');
            break;
          case 'hold-done':
            this.cropper = ev.cropper;
            chain.push(this.store(ev).then(() => this.set(ev.holdId, 'done')));
            break;
          case 'hold-error':
            this.set(ev.holdId, 'error', ev.message);
            break;
          case 'error':
            for (const h of holds) if (this.status[h.id] !== 'done') this.set(h.id, 'error', ev.message);
            void Promise.all(chain).then(() => resolve());
            break;
          case 'done':
            this.cropper = ev.cropper;
            void Promise.all(chain).then(() => resolve());
            break;
        }
      };
      const req: CaptureRequest = {
        type: 'capture',
        jobId,
        file,
        videoId,
        holds: holds.map((h) => {
          const need = needsCapture(h, app.assets);
          return { id: h.id, bestS: h.bestS, clipStartS: h.clipStartS, clipEndS: h.clipEndS, still: need.still || !need.clip, clip: need.clip || !need.still };
        }),
        quality,
        cropper: debugCropper(),
        baseUrl: import.meta.env.BASE_URL,
      };
      worker.postMessage(req);
    });
  }

  private runRecrop(holds: Array<{ id: string; stillKey: string }>): Promise<void> {
    const worker = this.ensureWorker();
    const jobId = ++this.jobId;
    return new Promise((resolve) => {
      const chain: Array<Promise<void>> = [];
      worker.onmessage = (e: MessageEvent<CaptureEvent>) => {
        const ev = e.data;
        if (ev.jobId !== jobId) return;
        if (ev.type === 'recrop-done') {
          this.cropper = ev.cropper;
          chain.push(this.storeCrop(ev.holdId, ev.crop, ev.cropper));
        } else if (ev.type === 'hold-error') {
          console.warn('[capture] re-crop failed', ev.holdId, ev.message);
        } else if (ev.type === 'done' || ev.type === 'error') {
          void Promise.all(chain).then(() => resolve());
        }
      };
      const req: CaptureRequest = { type: 'recrop', jobId, holds, cropper: debugCropper(), baseUrl: import.meta.env.BASE_URL };
      worker.postMessage(req);
    });
  }

  /** Records a re-detected automatic crop (the stored still did not change). */
  private async storeCrop(holdId: string, box: BodyBox | null, cropper: string) {
    const version = cropVersion(cropper);
    const hold = await app.db.holds.get(holdId);
    if (!hold || version === null) return;
    const updated: Hold = { ...hold, crop: withAutoCrop(hold.crop, box, version) };
    await app.db.holds.put(updated);
    app.upsertHold(updated);
  }

  /** Stores new asset records, removes the ones they replace, records the automatic crop. */
  private async store(ev: Extract<CaptureEvent, { type: 'hold-done' }>) {
    const db = app.db;
    const hold = await db.holds.get(ev.holdId);
    if (!hold) {
      // The hold was deleted while capturing: drop the fresh files.
      for (const a of ev.assets) await assetStore.delete(a.storageKey);
      return;
    }
    const old = replacedAssets(hold.id, app.assets, ev.assets.map((a) => a.kind));
    for (const a of ev.assets) await db.assets.put(a);
    app.addAssets(ev.assets);
    await deleteAssets(old);
    if (ev.assets.some((a) => a.kind === 'still')) {
      // A new still: the old automatic crop belonged to another frame.
      const { auto: _, ...rest } = hold.crop;
      const updated: Hold = { ...hold, crop: withAutoCrop(rest, ev.crop, cropVersion(ev.cropper)) };
      await db.holds.put(updated);
      app.upsertHold(updated);
    }
  }
}

export const capture = new CaptureQueue();
