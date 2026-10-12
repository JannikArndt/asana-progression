/**
 * Detection lab (Settings → Diagnostics → Detection lab): runs the detector with every parameter
 * set of a grid on the stored frames of the fully labeled videos and scores each in review edits
 * (labeling/evaluate.ts). Results are numbers only.
 */
import { DEFAULT_PARAMS, SIGNAL_PARAM_KEYS, findCandidates, reanalyze, type DetectionParams, type Signals } from '../../detection';
import {
  addScores,
  leaveOneSessionOut,
  paramDiff,
  scoreDetection,
  summarizeScore,
  type DetectionScore,
  type ParamGrid,
  type ScoreSummary,
  type ScoredSpan,
} from '../../labeling';
import type { Analysis } from '../../model';
import type { StoredFrames } from './export';

/**
 * Prefilled grid: the still percentile and every detector variant at a few values (144 sets).
 * Hysteresis and splitting are off at 55 and 0, the global threshold is the default.
 */
export const DEFAULT_LAB_GRID: ParamGrid = {
  base: {},
  vary: {
    stillPercentile: [50, 55, 60],
    thresholdMode: ['global', 'rolling'],
    thresholdWindowS: [300, 900],
    stillPercentileExit: [55, 65],
    splitPeakFactor: [0, 0.5, 0.75, 1],
    similarMergeFactor: [1.5, 2],
  },
};

export interface LabVideo {
  videoId: string;
  sessionId: string;
  /** Labeled holds of the video (the truth). */
  holds: ScoredSpan[];
  analysis: Pick<Analysis, 'params' | 'sampleHz' | 'sampleCount' | 'frameWidth' | 'frameHeight' | 'm' | 'C'>;
  /** Loads the stored frames; called once while this video is evaluated. Null when they are missing. */
  load(): Promise<StoredFrames | null>;
}

export interface LabProgress {
  video: number;
  videos: number;
  combo: number;
  combos: number;
}

export interface LabResult {
  combos: DetectionParams[];
  videos: Array<{ videoId: string; sessionId: string; holds: number }>;
  skipped: Array<{ videoId: string; reason: string }>;
  /** scores[c][v]: combination c on video v (videos as listed in `videos`). */
  scores: DetectionScore[][];
  /** The current defaults on each video. */
  reference: DetectionScore[];
}

const signalKey = (p: DetectionParams) => JSON.stringify([p.sampleHz, ...SIGNAL_PARAM_KEYS.map((k) => p[k])]);

/** Runs every combination on every video (one video's frames in memory at a time). */
export async function runLab(
  videos: LabVideo[],
  combos: DetectionParams[],
  opts: { onProgress?: (p: LabProgress) => void; signal?: AbortSignal } = {},
): Promise<LabResult> {
  const out: LabResult = { combos, videos: [], skipped: [], scores: combos.map(() => []), reference: [] };
  for (const [vi, v] of videos.entries()) {
    opts.signal?.throwIfAborted();
    const frames = await v.load();
    if (!frames) {
      out.skipped.push({ videoId: v.videoId, reason: 'The analysis frames are not stored on this device.' });
      continue;
    }
    const a = v.analysis;
    const signals = new Map<string, Signals>([[signalKey(a.params), { sampleHz: a.sampleHz, m: a.m, C: a.C }]]);
    const run = async (params: DetectionParams) => {
      const p = { ...params, sampleHz: a.sampleHz };
      const key = signalKey(p);
      let sig = signals.get(key);
      if (!sig) {
        sig = (await reanalyze(Math.min(a.sampleCount, frames.count), a.frameWidth, a.frameHeight, frames, p)).signals;
        signals.set(key, sig);
      }
      return scoreDetection((await findCandidates(sig, frames, p)).candidates, v.holds);
    };
    out.videos.push({ videoId: v.videoId, sessionId: v.sessionId, holds: v.holds.length });
    out.reference.push(await run({ ...DEFAULT_PARAMS }));
    for (const [ci, p] of combos.entries()) {
      opts.signal?.throwIfAborted();
      opts.onProgress?.({ video: vi, videos: videos.length, combo: ci, combos: combos.length });
      out.scores[ci]!.push(await run(p));
    }
  }
  opts.onProgress?.({ video: videos.length, videos: videos.length, combo: combos.length, combos: combos.length });
  return out;
}

export interface LabRow {
  index: number;
  diff: Partial<DetectionParams>;
  total: ScoreSummary;
  perVideo: Record<string, ScoreSummary>;
  /** Edit cost per session. */
  perSession: Record<string, number>;
}

export interface LabReport {
  format: 'asana-progression/lab';
  version: 1;
  exportedAt: string;
  app: { version: string; builtAt: string } | null;
  grid: ParamGrid;
  defaults: DetectionParams;
  videos: LabResult['videos'];
  sessions: string[];
  skipped: LabResult['skipped'];
  reference: Omit<LabRow, 'index' | 'diff'>;
  /** In grid order; `diff` = the parameters that differ from the defaults. */
  combos: LabRow[];
  /** Combination indices, lowest total edit cost first (then fewer missed, then grid order). */
  ranking: number[];
  /** Per held-out session: the combination best on the other sessions and its cost there. */
  loso: Array<{ session: string; chosen: number; diff: Partial<DetectionParams> | null; trainCost: number; heldOutCost: number; defaultCost: number }>;
}

function row(scores: DetectionScore[], videos: LabResult['videos'], sessions: string[]): Omit<LabRow, 'index' | 'diff'> {
  const perVideo: Record<string, ScoreSummary> = {};
  const perSession: Record<string, number> = Object.fromEntries(sessions.map((s) => [s, 0]));
  scores.forEach((s, i) => {
    const v = videos[i]!;
    perVideo[v.videoId] = summarizeScore(s);
    perSession[v.sessionId] = (perSession[v.sessionId] ?? 0) + s.editCost;
  });
  return { total: summarizeScore(addScores(...scores)), perVideo, perSession };
}

/** Numbers-only report of a lab run (ids, parameters and scores). */
export function labReport(result: LabResult, grid: ParamGrid, meta: { now?: Date; app?: { version: string; builtAt: string } } = {}): LabReport {
  const sessions = [...new Set(result.videos.map((v) => v.sessionId))];
  const combos: LabRow[] = result.combos.map((p, index) => ({ index, diff: paramDiff(p, DEFAULT_PARAMS), ...row(result.scores[index]!, result.videos, sessions) }));
  const ranking = [...combos]
    .sort((a, b) => a.total.editCost - b.total.editCost || a.total.missed - b.total.missed || a.index - b.index)
    .map((c) => c.index);
  const reference = row(result.reference, result.videos, sessions);
  const loso = leaveOneSessionOut(
    combos.map((c) => sessions.map((s) => c.perSession[s]!)),
    sessions,
  ).map((l) => ({ ...l, diff: l.chosen >= 0 ? combos[l.chosen]!.diff : null, defaultCost: reference.perSession[l.session]! }));
  return {
    format: 'asana-progression/lab',
    version: 1,
    exportedAt: (meta.now ?? new Date()).toISOString(),
    app: meta.app ?? null,
    grid,
    defaults: { ...DEFAULT_PARAMS },
    videos: result.videos,
    sessions,
    skipped: result.skipped,
    reference,
    combos,
    ranking,
    loso,
  };
}

/** The grid as JSON text with every value list on one line (for the lab's text field). */
export function gridText(grid: ParamGrid): string {
  const entries = (o: object, indent: string) =>
    Object.entries(o).map(([k, v]) => `${indent}${JSON.stringify(k)}: ${JSON.stringify(v).replace(/,/g, ', ')}`);
  const base = entries(grid.base ?? {}, '    ');
  const vary = entries(grid.vary, '    ');
  const block = (name: string, lines: string[]) => (lines.length ? `  "${name}": {\n${lines.join(',\n')}\n  }` : `  "${name}": {}`);
  return `{\n${block('base', base)},\n${block('vary', vary)}\n}`;
}
