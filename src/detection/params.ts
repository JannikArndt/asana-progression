import type { DetectionParams } from './types';

/** Defaults from the validated 7.6 min test video (9 of 10 holds found, all best frames correct). */
export const DEFAULT_PARAMS: Readonly<DetectionParams> = Object.freeze({
  sampleHz: 4,
  sampleLongSide: 160,
  pool: 2,
  motionMedianWindow: 9,
  changeWindowS: 4,
  edgeWindowMinS: 1,
  stillPercentile: 55,
  gapMergeS: 1,
  minHoldS: 6,
  bestFrameMiddle: 0.8,
  clipWindowS: 4,
  similarMergeFactor: 2,
  similarMergeMaxGapS: 60,
  similarMergeRelative: 0.45,
  similarMergeRefPeak: 1.5,
  similarMergeMinPairs: 5,
  singleStillMaxSpread: 4,
  singleStillMaxS: 300,
});

/** Parameters whose change requires decoding the video again (they shape the samples). */
export const SAMPLING_PARAM_KEYS: ReadonlyArray<keyof DetectionParams> = ['sampleHz', 'sampleLongSide', 'pool'];

/** Parameters that only affect the signal computation (recomputable from stored samples). */
export const SIGNAL_PARAM_KEYS: ReadonlyArray<keyof DetectionParams> = [
  'motionMedianWindow',
  'changeWindowS',
  'edgeWindowMinS',
];

export interface ParamSpec {
  key: keyof DetectionParams;
  label: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
  integer?: boolean;
}

/** UI metadata for the debug panel. */
export const PARAM_SPECS: ReadonlyArray<ParamSpec> = [
  { key: 'sampleHz', label: 'Sample rate', min: 1, max: 15, step: 1, unit: 'Hz', integer: true },
  { key: 'sampleLongSide', label: 'Sample size (long side)', min: 32, max: 640, step: 16, unit: 'px', integer: true },
  { key: 'pool', label: 'Average pool', min: 1, max: 8, step: 1, unit: '×', integer: true },
  { key: 'motionMedianWindow', label: 'Motion median window', min: 1, max: 41, step: 2, unit: 'samples', integer: true },
  { key: 'changeWindowS', label: 'Posture-change half window', min: 0.5, max: 20, step: 0.5, unit: 's' },
  { key: 'edgeWindowMinS', label: 'Min edge window', min: 0.25, max: 10, step: 0.25, unit: 's' },
  { key: 'stillPercentile', label: 'Still percentile', min: 5, max: 95, step: 1, unit: '%' },
  { key: 'gapMergeS', label: 'Join gaps shorter than', min: 0, max: 10, step: 0.25, unit: 's' },
  { key: 'minHoldS', label: 'Minimum hold', min: 0.5, max: 60, step: 0.5, unit: 's' },
  { key: 'bestFrameMiddle', label: 'Best-frame search span', min: 0.1, max: 1, step: 0.05 },
  { key: 'clipWindowS', label: 'Clip window', min: 1, max: 30, step: 0.5, unit: 's' },
  { key: 'similarMergeFactor', label: 'Similar-merge factor', min: 0, max: 10, step: 0.1, unit: '× scale' },
  { key: 'similarMergeMaxGapS', label: 'Similar-merge max gap', min: 0, max: 120, step: 1, unit: 's' },
  { key: 'similarMergeRelative', label: 'Similar-merge cap', min: 0.05, max: 5, step: 0.05, unit: '× median neighbour distance' },
  { key: 'similarMergeRefPeak', label: 'Similar-merge cap: change peak ≥', min: 1, max: 10, step: 0.1, unit: '× threshold' },
  { key: 'similarMergeMinPairs', label: 'Similar-merge cap from', min: 1, max: 100, step: 1, unit: 'pairs', integer: true },
  { key: 'singleStillMaxSpread', label: 'Single-still max spread', min: 1, max: 10, step: 0.1, unit: 'p99/p50' },
  { key: 'singleStillMaxS', label: 'Single-still max length', min: 0, max: 7200, step: 30, unit: 's' },
];

/** Returns a complete, sanitized parameter set (unknown keys dropped, out-of-range values clamped). */
export function normalizeParams(input: Partial<DetectionParams> | undefined): DetectionParams {
  const out: DetectionParams = { ...DEFAULT_PARAMS };
  if (!input) return out;
  for (const spec of PARAM_SPECS) {
    const raw = input[spec.key];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    let v = Math.min(spec.max, Math.max(spec.min, raw));
    if (spec.integer) v = Math.round(v);
    out[spec.key] = v;
  }
  if (out.motionMedianWindow % 2 === 0) out.motionMedianWindow += 1;
  return out;
}

/** True if switching from `a` to `b` requires decoding the video again. */
export function needsResample(a: DetectionParams, b: DetectionParams): boolean {
  return SAMPLING_PARAM_KEYS.some((k) => a[k] !== b[k]);
}
