/**
 * Processing worker: wires source → detection → storage. Decodes the video, pools the samples,
 * streams them into the detector, stores the pooled frames in OPFS and checkpoints the detector
 * state to IndexedDB so processing resumes after the tab was killed.
 */
import { Detector, poolGray, reanalyze, type DetectorSnapshot } from '../../detection';
import { openVideo, targetSize, type SamplerStats } from '../../source';
import {
  MemorySamples,
  openMetadataStore,
  openSampleWriter,
  probeOpfsQuota,
  sampleFileName,
  type MetadataStore,
  type SampleWriter,
} from '../../storage';
import type { Analysis, ProcessingJob, ProcessingStats } from '../../model';
import type { WorkerEvent, WorkerRequest } from './protocol';

const scope = self as unknown as {
  postMessage(message: WorkerEvent): void;
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
};

const CHECKPOINT_MS = 5000;
const PROGRESS_MS = 200;

let storePromise: Promise<MetadataStore> | null = null;
const store = () => (storePromise ??= openMetadataStore());
let current: AbortController | null = null;

function post(e: WorkerEvent) {
  scope.postMessage(e);
}

function emptyStats(skip: boolean): ProcessingStats {
  return {
    decodeWallMs: 0,
    framesDecoded: 0,
    packetsRead: 0,
    packetsSkipped: 0,
    convertMs: 0,
    realtimeFactor: 0,
    resumedCount: 0,
    skipNonReference: skip,
  };
}

function combine(base: ProcessingStats, run: SamplerStats | null, mediaS: number): ProcessingStats {
  if (!run) return base;
  const method = run.grayMethod ?? base.grayMethod ?? null;
  const wall = base.decodeWallMs + run.wallMs;
  const prevMedia = base.realtimeFactor * (base.decodeWallMs / 1000);
  return {
    ...base,
    decodeWallMs: wall,
    framesDecoded: base.framesDecoded + run.framesDecoded,
    packetsRead: base.packetsRead + run.packetsRead,
    packetsSkipped: base.packetsSkipped + run.packetsSkipped,
    convertMs: base.convertMs + run.convertMs,
    realtimeFactor: wall > 0 ? (prevMedia + mediaS) / (wall / 1000) : 0,
    grayMethod: method,
    grayBenchmark: run.grayBenchmark ?? base.grayBenchmark ?? null,
    pixelFormat: run.pixelFormat ?? base.pixelFormat ?? null,
  };
}

async function openWriter(videoId: string, recordBytes: number): Promise<{ writer: SampleWriter; opfs: boolean }> {
  try {
    return { writer: await openSampleWriter(sampleFileName(videoId), recordBytes), opfs: true };
  } catch {
    return { writer: new MemorySamples(recordBytes), opfs: false };
  }
}

async function analyze(req: Extract<WorkerRequest, { type: 'analyze' }>) {
  const { jobId, videoId, params: p } = req;
  let stage = 'open';
  let progressed = false;
  let writer: SampleWriter | null = null;
  const db = await store();
  const source = await openVideo(req.file).catch((e) => {
    post({ type: 'error', jobId, message: String(e), stage, progressed });
    return null;
  });
  if (!source) return;
  const abort = new AbortController();
  current = abort;
  try {
    const meta = source.meta;
    const gray = targetSize(meta.displayWidth, meta.displayHeight, p.sampleLongSide);
    const fw = Math.max(1, Math.floor(gray.width / p.pool));
    const fh = Math.max(1, Math.floor(gray.height / p.pool));
    const opened = await openWriter(videoId, fw * fh);
    writer = opened.writer;
    const detector = new Detector(p);
    let startIndex = 0;
    let base = emptyStats(req.skipNonReference);
    const startedAt = new Date().toISOString();
    let restored = null;

    if (req.resume) {
      const job = await db.jobs.get(videoId);
      const snap = job?.snapshot as DetectorSnapshot | undefined;
      if (
        job &&
        snap &&
        opened.opfs &&
        job.fingerprint === req.fingerprint &&
        JSON.stringify(job.params) === JSON.stringify(p) &&
        writer.count() >= snap.count
      ) {
        detector.restore(snap);
        startIndex = snap.count;
        writer.truncate(startIndex);
        base = { ...job.stats, resumedCount: job.stats.resumedCount + 1, skipNonReference: req.skipNonReference };
        restored = detector.drain();
      }
    }
    if (startIndex === 0) writer.truncate(0);

    const totalSamples = Math.max(1, Math.floor(meta.durationS * p.sampleHz));
    post({ type: 'started', jobId, meta, totalSamples, startIndex, frameWidth: fw, frameHeight: fh, opfs: opened.opfs, restored });

    let sampler: SamplerStats | null = null;
    let lastPost = 0;
    let lastCheckpoint = performance.now();
    let mediaTimeS = startIndex / p.sampleHz;
    const startMedia = mediaTimeS;

    const checkpoint = async (status: ProcessingJob['status'], error?: string) => {
      if (!writer || !opened.opfs) return;
      writer.flush();
      const job: ProcessingJob = {
        videoId,
        fingerprint: req.fingerprint,
        fileName: meta.fileName,
        fileSize: meta.fileSize,
        durationS: meta.durationS,
        params: p,
        skipNonReference: req.skipNonReference,
        nextIndex: detector.count,
        frameWidth: fw,
        frameHeight: fh,
        snapshot: detector.snapshot(),
        stats: combine(base, sampler, mediaTimeS - startMedia),
        startedAt,
        updatedAt: new Date().toISOString(),
        status,
        ...(error ? { error } : {}),
      };
      await db.jobs.put(job);
    };

    stage = 'decode';
    const samples = source.sampleGray({
      hz: p.sampleHz,
      longSide: p.sampleLongSide,
      startIndex,
      skipNonReference: req.skipNonReference,
      // A resumed run must keep the first run's gray conversion (different filters shift gray levels).
      ...(startIndex > 0 && base.grayMethod
        ? { grayMethod: base.grayMethod }
        : req.debug?.grayMethod
          ? { grayMethod: req.debug.grayMethod }
          : {}),
      signal: abort.signal,
      onStats: (s) => (sampler = s),
    });
    try {
      for await (const s of samples) {
        if (s.index !== detector.count) throw new Error(`Sample ${s.index} arrived, expected ${detector.count}`);
        const pooled = poolGray(s, p.pool);
        writer.write(s.index, pooled.data);
        detector.push(pooled);
        progressed = true;
        mediaTimeS = s.timestampS;
        const now = performance.now();
        if (now - lastPost >= PROGRESS_MS) {
          lastPost = now;
          post({ type: 'progress', jobId, index: s.index, mediaTimeS, sampler, chunk: detector.drain() });
        }
        if (req.debug?.sampleDelayMs) await new Promise((r) => setTimeout(r, req.debug!.sampleDelayMs));
        if (now - lastCheckpoint >= (req.debug?.checkpointMs ?? CHECKPOINT_MS)) {
          lastCheckpoint = now;
          await checkpoint('running');
        }
      }
    } catch (e) {
      await checkpoint('error', String(e)).catch(() => {});
      throw e;
    }

    if (abort.signal.aborted) {
      await checkpoint('interrupted');
      post({ type: 'cancelled', jobId });
      return;
    }

    stage = 'detect';
    post({ type: 'progress', jobId, index: detector.count - 1, mediaTimeS, sampler, chunk: detector.drain() });
    const w = writer;
    const { signals, result } = await detector.finish({ frame: (i) => w.read(i) });
    post({ type: 'progress', jobId, index: detector.count - 1, mediaTimeS, sampler, chunk: detector.drain() });
    const analysis: Analysis = {
      videoId,
      params: p,
      sampleHz: p.sampleHz,
      frameWidth: fw,
      frameHeight: fh,
      sampleCount: detector.count,
      m: signals.m,
      C: signals.C,
      threshold: result.threshold,
      singleStill: result.singleStill,
      candidates: result.candidates,
      preMerge: result.preMerge,
      createdAt: new Date().toISOString(),
      stats: combine(base, sampler, mediaTimeS - startMedia),
    };
    stage = 'save';
    await db.analyses.put(analysis);
    await db.jobs.delete(videoId);
    post({ type: 'done', jobId, videoId, candidates: result.candidates.length });
  } catch (e) {
    post({ type: 'error', jobId, message: e instanceof Error ? e.message : String(e), stage, progressed });
  } finally {
    current = null;
    try {
      writer?.flush();
      writer?.close();
    } catch {
      // ignore
    }
    source.close();
  }
}

async function reanalyzeStored(req: Extract<WorkerRequest, { type: 'reanalyze' }>) {
  const { jobId, videoId, params } = req;
  let writer: SampleWriter | null = null;
  try {
    const db = await store();
    const prev = await db.analyses.get(videoId);
    if (!prev) throw new Error('No analysis to recompute');
    writer = await openSampleWriter(sampleFileName(videoId), prev.frameWidth * prev.frameHeight);
    const total = Math.min(prev.sampleCount, writer.count());
    const w = writer;
    const { signals, result } = await reanalyze(total, prev.frameWidth, prev.frameHeight, { frame: (i) => w.read(i) }, params, (done) =>
      post({ type: 'reanalyze-progress', jobId, done, total }),
    );
    await db.analyses.put({
      ...prev,
      params,
      m: signals.m,
      C: signals.C,
      threshold: result.threshold,
      singleStill: result.singleStill,
      candidates: result.candidates,
      preMerge: result.preMerge,
      createdAt: new Date().toISOString(),
    });
    post({ type: 'done', jobId, videoId, candidates: result.candidates.length });
  } catch (e) {
    post({ type: 'error', jobId, message: e instanceof Error ? e.message : String(e), stage: 'reanalyze', progressed: false });
  } finally {
    writer?.close();
  }
}

scope.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  switch (req.type) {
    case 'analyze':
      void analyze(req);
      break;
    case 'reanalyze':
      void reanalyzeStored(req);
      break;
    case 'probe-quota':
      void probeOpfsQuota(req.capBytes, (bytes) => post({ type: 'quota-progress', jobId: req.jobId, bytes })).then((result) =>
        post({ type: 'quota-result', jobId: req.jobId, result }),
      );
      break;
    case 'cancel':
      current?.abort();
      break;
  }
};
