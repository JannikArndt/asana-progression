import type { Candidate, CandidateResult, DetectionParams, FrameAccess, Signals } from './types';

/**
 * Portable analysis export ("export analysis JSON" debug action). It contains everything needed
 * to replay candidate extraction in a unit test: signals, parameters, and the tiny frames at every
 * best frame (pre-merge and alternates). `meta` is opaque to detection (video metadata etc.).
 */
export interface AnalysisExport {
  format: 'asana-progression/analysis';
  version: 1;
  exportedAt: string;
  params: DetectionParams;
  sampleHz: number;
  frameWidth: number;
  frameHeight: number;
  /** Rounded to 4 decimals; null = NaN. */
  m: Array<number | null>;
  C: Array<number | null>;
  threshold: number | null;
  singleStill: boolean;
  candidates: Candidate[];
  preMerge: Candidate[];
  /** Sample index → base64 of the pooled gray frame. */
  frames: Record<string, string>;
  /** Optional ground truth added by hand: true hold spans in seconds. */
  /**
   * Hand-checked holds. `bestS` (optional) is a frame confirmed by eye as a good representative;
   * the candidate found for the hold must pick a best frame within `bestTolS` (default 1.5 s).
   */
  truth?: Array<{ startS: number; endS: number; name?: string; bestS?: number; bestTolS?: number }>;
  meta?: Record<string, unknown>;
}

function round(v: number): number | null {
  return Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : null;
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Sample indices whose frames a replay of `findCandidates` may read. */
export function framesNeeded(result: CandidateResult, hz: number): number[] {
  const set = new Set<number>();
  for (const c of [...result.preMerge, ...result.candidates]) {
    set.add(Math.round(c.bestS * hz));
    for (const a of c.alternatesS) set.add(Math.round(a * hz));
  }
  return [...set].sort((a, b) => a - b);
}

export async function buildAnalysisExport(
  signals: Signals,
  result: CandidateResult,
  params: DetectionParams,
  frameSize: { width: number; height: number },
  frames: FrameAccess,
  meta?: Record<string, unknown>,
): Promise<AnalysisExport> {
  const out: Record<string, string> = {};
  for (const i of framesNeeded(result, signals.sampleHz)) out[String(i)] = toBase64(await frames.frame(i));
  return {
    format: 'asana-progression/analysis',
    version: 1,
    exportedAt: new Date().toISOString(),
    params,
    sampleHz: signals.sampleHz,
    frameWidth: frameSize.width,
    frameHeight: frameSize.height,
    m: Array.from(signals.m, round),
    C: Array.from(signals.C, round),
    threshold: round(result.threshold),
    singleStill: result.singleStill,
    candidates: result.candidates,
    preMerge: result.preMerge,
    frames: out,
    ...(meta ? { meta } : {}),
  };
}

/** Signals and frame access reconstructed from an export (for replay in tests). */
export function readAnalysisExport(x: AnalysisExport): { signals: Signals; frames: FrameAccess } {
  if (x.format !== 'asana-progression/analysis' || x.version !== 1) throw new Error('Not an analysis export');
  const toF32 = (a: Array<number | null>) => Float32Array.from(a, (v) => (v === null ? NaN : v));
  const decoded = new Map<number, Uint8Array>();
  for (const [k, v] of Object.entries(x.frames)) decoded.set(Number(k), fromBase64(v));
  return {
    signals: { sampleHz: x.sampleHz, m: toF32(x.m), C: toF32(x.C) },
    frames: {
      frame(i) {
        const f = decoded.get(i);
        if (!f) throw new Error(`Frame ${i} is not part of the export`);
        return f;
      },
    },
  };
}
