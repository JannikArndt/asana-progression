import { findCandidates } from './candidates';
import { SignalStream } from './signals';
import type {
  CandidateResult,
  DetectionParams,
  DetectorSnapshot,
  FrameAccess,
  GrayFrame,
  SignalChunk,
  Signals,
} from './types';

export type * from './types';
export { DEFAULT_PARAMS, PARAM_SPECS, normalizeParams, needsResample, SAMPLING_PARAM_KEYS } from './params';
export type { ParamSpec } from './params';
export { poolGray } from './signals';
export { findCandidates } from './candidates';
export { percentile, meanAbsDiff } from './stats';

export interface DetectionOutput {
  signals: Signals;
  result: CandidateResult;
}

/**
 * Streaming detector: push pooled frames in sample order, drain C(t) for live display,
 * snapshot/restore for resumable processing, finish() for candidates.
 */
export class Detector {
  private readonly stream: SignalStream;

  constructor(readonly params: DetectionParams) {
    this.stream = new SignalStream(params);
  }

  get count(): number {
    return this.stream.count;
  }

  push(frame: GrayFrame): void {
    this.stream.push(frame);
  }

  drain(): SignalChunk {
    return this.stream.drain();
  }

  snapshot(): DetectorSnapshot {
    return this.stream.snapshot();
  }

  restore(s: DetectorSnapshot): void {
    this.stream.restore(s);
  }

  async finish(frames: FrameAccess): Promise<DetectionOutput> {
    this.stream.finish();
    const signals = this.stream.signals();
    const result = await findCandidates(signals, frames, this.params);
    return { signals, result };
  }
}

/** Batch helper: runs the whole pipeline over pooled frames held in memory. */
export async function analyzeFrames(frames: GrayFrame[], params: DetectionParams): Promise<DetectionOutput> {
  const d = new Detector(params);
  for (const f of frames) d.push(f);
  return d.finish({ frame: (i) => frames[i]!.data });
}

/** Recomputes signals + candidates from stored pooled frames (no video decoding needed). */
export async function reanalyze(
  count: number,
  width: number,
  height: number,
  frames: FrameAccess,
  params: DetectionParams,
  onProgress?: (done: number) => void,
): Promise<DetectionOutput> {
  const d = new Detector(params);
  for (let i = 0; i < count; i++) {
    d.push({ width, height, data: await frames.frame(i) });
    if (onProgress && i % 500 === 0) onProgress(i);
  }
  return d.finish(frames);
}
export { buildAnalysisExport, readAnalysisExport, type AnalysisExport } from './fixture';
