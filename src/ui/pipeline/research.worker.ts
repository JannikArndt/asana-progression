/**
 * Research worker: builds the research export (stored records, the detection re-run on the stored
 * frames, pose landmarks of every still) and runs the detection lab. Reads IndexedDB and OPFS only;
 * writes nothing.
 */
import { previewFromStill } from '../../capture';
import { expandGrid } from '../../labeling';
import type { Analysis } from '../../model';
import { openMetadataStore, openSampleReader, OpfsAssetStore, sampleFileName, type MetadataStore } from '../../storage';
import { buildResearchExport, isFullyLabeled, type StoredFrames } from '../research/export';
import { labReport, runLab, type LabVideo } from '../research/lab';
import { workerCropper } from './cropper';
import type { ResearchEvent, ResearchRequest } from './research-protocol';

const scope = self as unknown as {
  postMessage(message: ResearchEvent): void;
  onmessage: ((e: MessageEvent<ResearchRequest>) => void) | null;
};

const PROGRESS_MS = 150;
const CHUNK = 512;
const assets = new OpfsAssetStore();
const getCropper = workerCropper();
let current: AbortController | null = null;

/**
 * Stored frames of a video without holding them all in memory: a sequential scan (signals computed
 * again) reads chunks of CHUNK frames; other reads (best frames, again and again in the lab) read
 * the single frame and keep it.
 */
async function storedFrames(a: Analysis): Promise<StoredFrames | null> {
  const rb = a.frameWidth * a.frameHeight;
  const reader = await openSampleReader(sampleFileName(a.videoId), rb);
  if (!reader) return null;
  const count = Math.min(a.sampleCount, await reader.count());
  if (count === 0) return null;
  const picked = new Map<number, Uint8Array>();
  let start = -1;
  let chunk: Uint8Array = new Uint8Array(0);
  let last = -2;
  return {
    count,
    async frame(i) {
      if (i < 0 || i >= count) throw new RangeError(`Sample ${i} out of range`);
      const sequential = i === last + 1;
      last = i;
      if (start >= 0 && i >= start && i < start + CHUNK) return chunk.subarray((i - start) * rb, (i - start + 1) * rb);
      const hit = picked.get(i);
      if (hit) return hit;
      if (sequential) {
        start = i;
        chunk = await reader.readRange(i, Math.min(count, i + CHUNK));
        return chunk.subarray(0, rb);
      }
      const f = await reader.read(i);
      picked.set(i, f);
      return f;
    },
  };
}

function throttled<T extends unknown[]>(fn: (...args: T) => void): (...args: T) => void {
  let last = 0;
  return (...args) => {
    const t = performance.now();
    if (t - last < PROGRESS_MS) return;
    last = t;
    fn(...args);
  };
}

async function exportData(db: MetadataStore, req: Extract<ResearchRequest, { type: 'export' }>) {
  const { jobId } = req;
  const [asanas, templates, sessions, videos, analyses, holds, stored] = await Promise.all([
    db.asanas.all(),
    db.templates.all(),
    db.sessions.all(),
    db.videos.all(),
    db.analyses.all(),
    db.holds.all(),
    db.assets.all(),
  ]);
  const cropper = await getCropper(req.cropper, req.baseUrl);
  const progress = throttled((phase: 'analyses' | 'poses', done: number, total: number) =>
    scope.postMessage({ type: 'export-progress', jobId, phase, done, total }),
  );
  const x = await buildResearchExport(
    { asanas, templates, sessions, videos, analyses, holds, assets: stored },
    {
      frames: storedFrames,
      async pose(still) {
        const blob = await assets.get(still.storageKey);
        if (!blob) throw new Error('Still file missing');
        const preview = await previewFromStill(blob);
        try {
          return { detection: await cropper.detect(preview), width: preview.width, height: preview.height, cropper: cropper.name };
        } finally {
          preview.close();
        }
      },
      app: req.app,
      // Cancelling stops before the next analysis or hold.
      onProgress: (phase, done, total) => {
        current?.signal.throwIfAborted();
        progress(phase, done, total);
      },
    },
  );
  current?.signal.throwIfAborted();
  const blob = new Blob([JSON.stringify(x)], { type: 'application/json' });
  scope.postMessage({ type: 'export-done', jobId, blob, videos: x.analyses.length, holds: x.holds.length });
}

async function lab(db: MetadataStore, req: Extract<ResearchRequest, { type: 'lab' }>) {
  const { jobId } = req;
  const combos = expandGrid(req.grid);
  const [sessions, analyses, holds] = await Promise.all([db.sessions.all(), db.analyses.all(), db.holds.all()]);
  const videos: LabVideo[] = [];
  for (const s of [...sessions].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const videoId of s.videoIds) {
      const a = analyses.find((x) => x.videoId === videoId);
      if (!a || !isFullyLabeled(a)) continue;
      videos.push({ videoId, sessionId: s.id, holds: holds.filter((h) => h.videoId === videoId), analysis: a, load: () => storedFrames(a) });
    }
  }
  if (!videos.length) throw new Error('No fully labeled video: label every card of a video (or mark it "Not a pose") first.');
  const result = await runLab(videos, combos, {
    signal: current!.signal,
    onProgress: throttled((progress) => scope.postMessage({ type: 'lab-progress', jobId, progress })),
  });
  scope.postMessage({ type: 'lab-done', jobId, report: labReport(result, req.grid, { app: req.app }) });
}

async function handle(req: Exclude<ResearchRequest, { type: 'cancel' }>) {
  current = new AbortController();
  let db: MetadataStore | null = null;
  try {
    db = await openMetadataStore();
    if (req.type === 'export') await exportData(db, req);
    else await lab(db, req);
  } catch (e) {
    const aborted = current?.signal.aborted;
    scope.postMessage({ type: 'error', jobId: req.jobId, message: aborted ? 'Cancelled.' : e instanceof Error ? e.message : String(e) });
  } finally {
    db?.close();
    current = null;
  }
}

scope.onmessage = (e) => {
  if (e.data.type === 'cancel') current?.abort();
  else void handle(e.data);
};
