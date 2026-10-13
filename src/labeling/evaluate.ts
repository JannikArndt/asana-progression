/**
 * Scores hold detection against fully labeled videos (every hold labeled, "Not a pose" = false
 * detection, uncovered time = no hold) in review edits: how many taps the review step needs to turn
 * the detector's candidates into the labeled holds. Pure; also runs in Node (fixtures, research
 * scripts) and in the detection lab worker.
 */
import {
  DEFAULT_PARAMS,
  PARAM_SPECS,
  SAMPLING_PARAM_KEYS,
  findCandidates,
  isChoiceSpec,
  normalizeParams,
  type DetectionParams,
  type FrameAccess,
  type Signals,
} from '../detection';

/** A time span in seconds; `bestS` = the frame chosen as representative (truth) or picked (candidate). */
export interface ScoredSpan {
  startS: number;
  endS: number;
  bestS?: number;
}

/** Matching rules (fractions of span lengths). */
export const SCORE_RULES = {
  /** "Own": one candidate covers at least this share of the hold… */
  ownCover: 0.5,
  /** …and at least this share of that candidate is the hold. */
  ownPurity: 0.5,
  /** Missed: no candidate covers at least this share of the hold. */
  missCover: 0.3,
  /** A candidate overlaps a hold when the overlap is at least this share of the shorter of the two. */
  overlap: 0.3,
  /** Best frames of own holds further than this (seconds) from the labeled one are counted. */
  bestTolS: 1.5,
} as const;

/**
 * Review edits per finding. A missed hold costs two (find the gap, add the hold by hand and fit its
 * span); a hold split across candidates costs one merge per extra candidate; a candidate spanning
 * several holds one split per extra hold; a false detection one "Not a pose".
 */
export const EDIT_COST = { missed: 2, needSplit: 1, needMerge: 1, falsePos: 1 } as const;

export interface DetectionScore {
  /** Labeled holds and candidates scored. */
  holds: number;
  candidates: number;
  /** Holds that are one candidate's (see SCORE_RULES). */
  own: number;
  missed: number;
  /** Σ over candidates of (holds whose main candidate it is − 1). */
  needSplit: number;
  /** Σ over holds of (candidates whose main hold it is − 1). */
  needMerge: number;
  /** Candidates overlapping no hold. */
  falsePos: number;
  editCost: number;
  /** Per own hold: |Δstart|, |Δend| and |best frame − labeled best frame| in seconds. */
  startErrS: number[];
  endErrS: number[];
  bestErrS: number[];
}

const len = (s: ScoredSpan) => Math.max(0, s.endS - s.startS);
const overlap = (a: ScoredSpan, b: ScoredSpan) => Math.max(0, Math.min(a.endS, b.endS) - Math.max(a.startS, b.startS));

export function editCost(s: Pick<DetectionScore, 'missed' | 'needSplit' | 'needMerge' | 'falsePos'>): number {
  return EDIT_COST.missed * s.missed + EDIT_COST.needSplit * s.needSplit + EDIT_COST.needMerge * s.needMerge + EDIT_COST.falsePos * s.falsePos;
}

/** Index of the largest positive value (first on ties), -1 if none. */
function argmaxPositive(values: number[]): number {
  let best = -1;
  for (let i = 0; i < values.length; i++) if (values[i]! > 0 && (best < 0 || values[i]! > values[best]!)) best = i;
  return best;
}

/** Length of the union of the spans (seconds). */
function unionLength(spans: ScoredSpan[]): number {
  let total = 0;
  let end = -Infinity;
  for (const s of [...spans].sort((a, b) => a.startS - b.startS)) {
    const from = Math.max(s.startS, end);
    if (s.endS > from) total += s.endS - from;
    end = Math.max(end, s.endS);
  }
  return total;
}

/**
 * Scores `candidates` (dismissed ones excluded by the caller) against the labeled `holds` of one
 * video. A candidate touches a hold when they overlap by at least SCORE_RULES.overlap of the
 * shorter one. Missed: the candidates touching a hold cover less than SCORE_RULES.missCover of it
 * together (fragments that together cover more are merges, not a miss). False detection: touches
 * no hold. Each candidate belongs to the hold it overlaps most, each found hold to the touching
 * candidate it overlaps most: holds sharing a candidate need splits, candidates sharing a found
 * hold need merges (fragments of a missed hold go with the miss).
 */
export function scoreDetection(candidates: readonly ScoredSpan[], holds: readonly ScoredSpan[]): DetectionScore {
  const R = SCORE_RULES;
  const ov = holds.map((h) => candidates.map((c) => overlap(h, c)));
  const touches = (hi: number, ci: number) => ov[hi]![ci]! > 0 && ov[hi]![ci]! >= R.overlap * Math.min(len(holds[hi]!), len(candidates[ci]!));
  const missed = holds.map((h, hi) => {
    const touching = candidates.filter((_, ci) => touches(hi, ci)).map((c) => ({ startS: Math.max(c.startS, h.startS), endS: Math.min(c.endS, h.endS) }));
    return !(len(h) > 0 && unionLength(touching) >= R.missCover * len(h));
  });
  const falsePos = candidates.map((_, ci) => !holds.some((_, hi) => touches(hi, ci)));
  const mainCandidate = holds.map((_, hi) => (missed[hi] ? -1 : argmaxPositive(candidates.map((_, ci) => (touches(hi, ci) ? ov[hi]![ci]! : 0)))));
  const mainHold = candidates.map((_, ci) => {
    if (falsePos[ci]) return -1;
    const hi = argmaxPositive(holds.map((_, k) => (touches(k, ci) ? ov[k]![ci]! : 0)));
    return missed[hi] ? -1 : hi;
  });
  const count = (list: number[], n: number) => {
    const out = new Array<number>(n).fill(0);
    for (const i of list) if (i >= 0) out[i]!++;
    return out;
  };
  const needSplit = count(mainCandidate, candidates.length).reduce((s, k) => s + Math.max(0, k - 1), 0);
  const needMerge = count(mainHold, holds.length).reduce((s, k) => s + Math.max(0, k - 1), 0);

  const startErrS: number[] = [];
  const endErrS: number[] = [];
  const bestErrS: number[] = [];
  let own = 0;
  holds.forEach((h, hi) => {
    const ci = candidates.findIndex((c, k) => ov[hi]![k]! >= R.ownCover * len(h) && ov[hi]![k]! >= R.ownPurity * len(c) && ov[hi]![k]! > 0);
    if (ci < 0) return;
    own++;
    const c = candidates[ci]!;
    startErrS.push(Math.abs(c.startS - h.startS));
    endErrS.push(Math.abs(c.endS - h.endS));
    if (h.bestS !== undefined && c.bestS !== undefined) bestErrS.push(Math.abs(c.bestS - h.bestS));
  });
  const counts = {
    missed: missed.filter(Boolean).length,
    needSplit,
    needMerge,
    falsePos: falsePos.filter(Boolean).length,
  };
  return { holds: holds.length, candidates: candidates.length, own, ...counts, editCost: editCost(counts), startErrS, endErrS, bestErrS };
}

export function emptyScore(): DetectionScore {
  return { holds: 0, candidates: 0, own: 0, missed: 0, needSplit: 0, needMerge: 0, falsePos: 0, editCost: 0, startErrS: [], endErrS: [], bestErrS: [] };
}

/** Sum of several scores (counts add up, error lists are concatenated). */
export function addScores(...scores: DetectionScore[]): DetectionScore {
  const out = emptyScore();
  for (const s of scores) {
    out.holds += s.holds;
    out.candidates += s.candidates;
    out.own += s.own;
    out.missed += s.missed;
    out.needSplit += s.needSplit;
    out.needMerge += s.needMerge;
    out.falsePos += s.falsePos;
    out.editCost += s.editCost;
    out.startErrS.push(...s.startErrS);
    out.endErrS.push(...s.endErrS);
    out.bestErrS.push(...s.bestErrS);
  }
  return out;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

/** Numbers only: counts plus medians of the span and best-frame errors (seconds, 2 decimals). */
export interface ScoreSummary extends Omit<DetectionScore, 'startErrS' | 'endErrS' | 'bestErrS'> {
  medianStartErrS: number | null;
  medianEndErrS: number | null;
  medianBestErrS: number | null;
  /** Own holds whose best frame is further than SCORE_RULES.bestTolS from the labeled one. */
  bestOverTol: number;
}

export function summarizeScore(s: DetectionScore): ScoreSummary {
  const { startErrS, endErrS, bestErrS, ...counts } = s;
  const r2 = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);
  return {
    ...counts,
    medianStartErrS: r2(median(startErrS)),
    medianEndErrS: r2(median(endErrS)),
    medianBestErrS: r2(median(bestErrS)),
    bestOverTol: bestErrS.filter((d) => d > SCORE_RULES.bestTolS).length,
  };
}

/** Runs the detector with `params` on one video's signals and scores it against its labeled holds. */
export async function evaluateParams(signals: Signals, frames: FrameAccess, params: DetectionParams, holds: readonly ScoredSpan[]): Promise<DetectionScore> {
  const r = await findCandidates(signals, frames, params);
  return scoreDetection(r.candidates, holds);
}

// ---- parameter grid --------------------------------------------------------------------------

/** `{ base?, vary }`: every combination of the `vary` values on top of `base` (on top of the defaults). */
export interface ParamGrid {
  base?: Partial<DetectionParams>;
  vary: Partial<Record<keyof DetectionParams, ReadonlyArray<number | string>>>;
}

export const MAX_GRID_COMBOS = 2000;

/**
 * A parameter set as the detector sees it: settings without effect are reset (the rolling window
 * with a global threshold, an exit percentile at or below the enter percentile), so identical
 * detections compare equal.
 */
export function effectiveParams(p: DetectionParams): DetectionParams {
  return {
    ...p,
    thresholdWindowS: p.thresholdMode === 'rolling' ? p.thresholdWindowS : DEFAULT_PARAMS.thresholdWindowS,
    stillPercentileExit: Math.max(p.stillPercentile, p.stillPercentileExit),
  };
}

/**
 * Every parameter set of the grid (normalized, duplicates of the same effective detection
 * removed, first occurrence kept; the last `vary` key changes fastest). Throws with a readable
 * message for unknown keys, invalid values, sampling parameters (they need decoding again) or more
 * than `max` combinations.
 */
export function expandGrid(grid: ParamGrid, max = MAX_GRID_COMBOS): DetectionParams[] {
  if (!grid || typeof grid !== 'object' || !grid.vary || typeof grid.vary !== 'object') throw new Error('The grid needs a "vary" object.');
  const specs = new Map(PARAM_SPECS.map((s) => [s.key as string, s]));
  for (const k of Object.keys(grid.base ?? {})) {
    if (!specs.has(k)) throw new Error(`Unknown parameter "${k}" in base.`);
    if (SAMPLING_PARAM_KEYS.includes(k as keyof DetectionParams)) throw new Error(`"${k}" shapes the stored frames; it needs decoding again.`);
  }
  const keys = Object.keys(grid.vary) as Array<keyof DetectionParams>;
  let total = 1;
  for (const k of keys) {
    const spec = specs.get(k);
    if (!spec) throw new Error(`Unknown parameter "${k}".`);
    if (SAMPLING_PARAM_KEYS.includes(k)) throw new Error(`"${k}" shapes the stored frames; it needs decoding again.`);
    const values = grid.vary[k];
    if (!Array.isArray(values) || values.length === 0) throw new Error(`"${k}" needs a non-empty list of values.`);
    for (const v of values) {
      const ok = isChoiceSpec(spec) ? spec.options.includes(v as DetectionParams['thresholdMode']) : typeof v === 'number' && Number.isFinite(v);
      if (!ok) throw new Error(`Invalid value ${JSON.stringify(v)} for "${k}".`);
    }
    total *= values.length;
  }
  if (total > max) throw new Error(`${total} combinations; at most ${max}.`);
  const base = normalizeParams(grid.base);
  const out: DetectionParams[] = [];
  const seen = new Set<string>();
  const walk = (i: number, acc: Partial<DetectionParams>) => {
    if (i === keys.length) {
      const p = normalizeParams({ ...base, ...acc });
      const key = JSON.stringify(effectiveParams(p));
      if (!seen.has(key)) {
        seen.add(key);
        out.push(p);
      }
      return;
    }
    for (const v of grid.vary[keys[i]!]!) walk(i + 1, { ...acc, [keys[i]!]: v });
  };
  walk(0, {});
  return out;
}

/** Parses the lab's JSON text into parameter sets, or an error message. */
export function parseGrid(text: string, max = MAX_GRID_COMBOS): { grid: ParamGrid; combos: DetectionParams[] } | { error: string } {
  let grid: ParamGrid;
  try {
    grid = JSON.parse(text) as ParamGrid;
  } catch (e) {
    return { error: `Not valid JSON: ${(e as Error).message}` };
  }
  try {
    return { grid, combos: expandGrid(grid, max) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** The parameters in which `p` differs from `ref` (for compact result rows). */
export function paramDiff(p: DetectionParams, ref: DetectionParams): Partial<DetectionParams> {
  const out: Partial<DetectionParams> = {};
  for (const k of Object.keys(p) as Array<keyof DetectionParams>) if (p[k] !== ref[k]) (out as Record<string, unknown>)[k] = p[k];
  return out;
}

/**
 * Leave-one-session-out choice: for each session, the parameter set with the lowest edit cost on
 * all other sessions (first on ties) and its cost on the held-out session. `cost[c][s]` = edit cost
 * of combination `c` on session `s`.
 */
export function leaveOneSessionOut(cost: number[][], sessions: readonly string[]): Array<{ session: string; chosen: number; trainCost: number; heldOutCost: number }> {
  return sessions.map((session, s) => {
    let chosen = -1;
    let trainCost = Infinity;
    cost.forEach((row, c) => {
      const t = row.reduce((sum, v, k) => (k === s ? sum : sum + v), 0);
      if (t < trainCost) {
        trainCost = t;
        chosen = c;
      }
    });
    return { session, chosen, trainCost: chosen < 0 ? NaN : trainCost, heldOutCost: chosen < 0 ? NaN : cost[chosen]![s]! };
  });
}
