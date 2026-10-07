import { argminRange, lowestWindow, meanAbsDiff, percentileSorted, sortedFinite } from './stats';
import type { Candidate, CandidateResult, DetectionParams, FrameAccess, Signals } from './types';

/** Half-open sample range [start, end) with derived points. */
interface Run {
  start: number;
  end: number;
  best: number;
  alternates: number[];
  clipStart: number;
}

/** Maximal runs of indices where `still(i)` holds. Half-open ranges. */
export function stillRuns(n: number, still: (i: number) => boolean): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  let start = -1;
  for (let i = 0; i < n; i++) {
    if (still(i)) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      runs.push([start, i]);
      start = -1;
    }
  }
  if (start >= 0) runs.push([start, n]);
  return runs;
}

/** Joins runs whose gap is shorter than `maxGap` samples. */
export function joinGaps(runs: Array<[number, number]>, maxGap: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && r[0] - last[1] < maxGap) last[1] = r[1];
    else out.push([r[0], r[1]]);
  }
  return out;
}

/** Best frame: argmin m inside the middle `middle` fraction of [start, end). */
export function bestIndex(m: ArrayLike<number>, start: number, end: number, middle: number): number {
  const len = end - start;
  const margin = Math.floor((len * (1 - middle)) / 2);
  const a = start + margin;
  const b = Math.max(a + 1, end - margin);
  const i = argminRange(m, a, b);
  return i >= 0 ? i : Math.min(end - 1, start + (len >> 1));
}

function makeRun(m: Float32Array, start: number, end: number, p: DetectionParams): Run {
  const clipLen = Math.max(1, Math.round(p.clipWindowS * p.sampleHz));
  return {
    start,
    end,
    best: bestIndex(m, start, end, p.bestFrameMiddle),
    alternates: [],
    clipStart: lowestWindow(m, start, end, clipLen),
  };
}

function toCandidate(r: Run, p: DetectionParams): Candidate {
  const hz = p.sampleHz;
  const clipLen = Math.max(1, Math.round(p.clipWindowS * hz));
  const clipEnd = Math.min(r.end, r.clipStart + clipLen);
  return {
    id: `cand-${r.start}`,
    startS: r.start / hz,
    endS: r.end / hz,
    bestS: r.best / hz,
    alternatesS: r.alternates.map((a) => a / hz).sort((a, b) => a - b),
    clipStartS: r.clipStart / hz,
    clipEndS: clipEnd / hz,
    status: 'open',
  };
}

/**
 * Turns signals into hold candidates:
 *  1. still = C ≤ percentile(C, stillPercentile); special case: no clear posture change → one run
 *  2. join gaps < gapMergeS, drop runs < minHoldS
 *  3. best frame = argmin m in the middle `bestFrameMiddle` of the run
 *  4. clip window = lowest summed m over clipWindowS
 *  5. merge adjacent candidates whose best frames look alike (alternates keep the merged-away bests)
 */
export async function findCandidates(
  signals: Signals,
  frames: FrameAccess,
  p: DetectionParams,
): Promise<CandidateResult> {
  const { m, C } = signals;
  const n = Math.min(m.length, C.length);
  const sorted = sortedFinite(C.subarray(0, n));
  const threshold = percentileSorted(sorted, p.stillPercentile);
  if (n === 0) return { threshold, singleStill: false, candidates: [], preMerge: [] };

  const p50 = percentileSorted(sorted, 50);
  const p99 = percentileSorted(sorted, 99);
  const singleStill = sorted.length === 0 || p99 <= p.singleStillMaxSpread * p50 + 1e-9;

  let runs: Run[];
  if (singleStill) {
    runs = [makeRun(m, 0, n, p)];
  } else {
    const raw = stillRuns(n, (i) => C[i]! <= threshold);
    const joined = joinGaps(raw, Math.round(p.gapMergeS * p.sampleHz));
    const minLen = p.minHoldS * p.sampleHz;
    runs = joined.filter(([a, b]) => b - a >= minLen - 1e-9).map(([a, b]) => makeRun(m, a, b, p));
  }
  const preMerge = runs.map((r) => toCandidate(r, p));

  // Similar-best-frame merge of adjacent candidates.
  const merged: Run[] = [];
  const maxGap = p.similarMergeMaxGapS * p.sampleHz;
  for (const r of runs) {
    const last = merged[merged.length - 1];
    // Scale: the larger of the still threshold (4 s means) and the frame-to-frame noise floor
    // at the two best frames (single frames are noisier than 4 s means).
    const scale = last ? Math.max(threshold, m[last.best] ?? 0, m[r.best] ?? 0) : 0;
    const maxDiff = p.similarMergeFactor * (Number.isFinite(scale) ? scale : 0);
    if (last && r.start - last.end <= maxGap && maxDiff > 0) {
      const d = meanAbsDiff(await frames.frame(last.best), await frames.frame(r.best));
      if (d < maxDiff) {
        const keepLast = !(m[r.best]! < m[last.best]!);
        const winner = keepLast ? last.best : r.best;
        const loser = keepLast ? r.best : last.best;
        const alternates = [...last.alternates, ...r.alternates, loser];
        const next = makeRun(m, last.start, r.end, p);
        next.best = winner;
        next.alternates = alternates;
        merged[merged.length - 1] = next;
        continue;
      }
    }
    merged.push(r);
  }

  return { threshold, singleStill, candidates: merged.map((r) => toCandidate(r, p)), preMerge };
}
