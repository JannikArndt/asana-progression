import { bestFrameIndex, findCandidates, lowestSumWindow, percentile, valleyProminence, type DetectionParams, type FrameAccess } from '../detection';
import type { Hold, ReviewCandidate } from '../model/types';
import type { SignalView, TimeRange } from './types';

/** Valley prominence lives in detection (also used to split still runs); re-exported for splitInto's callers. */
export { valleyProminence };

/** Best frame and clip window of a span, from the motion signal. */
export function fitSpan(startS: number, endS: number, sig: SignalView): { bestS: number; clipStartS: number; clipEndS: number } {
  const hz = sig.sampleHz;
  const a = Math.max(0, Math.floor(startS * hz));
  const b = Math.max(a + 1, Math.min(sig.m.length, Math.ceil(endS * hz)));
  const best = bestFrameIndex(sig.m, a, b, sig.bestFrameMiddle);
  const clipLen = Math.max(1, Math.round(sig.clipWindowS * hz));
  const clipStart = lowestSumWindow(sig.m, a, b, clipLen);
  return {
    bestS: best / hz,
    clipStartS: clipStart / hz,
    clipEndS: Math.min(b, clipStart + clipLen) / hz,
  };
}

function motionAt(sig: SignalView, t: number): number {
  const v = sig.m[Math.round(t * sig.sampleHz)];
  return v !== undefined && Number.isFinite(v) ? v : Infinity;
}

let counter = 0;
/** Unique id for candidates created by editing. */
export function editedId(prefix: string): string {
  counter = (counter + 1) % 1e6;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Merges two candidates (in time order). The stiller best frame wins (`keepBest`: `a`'s best frame,
 * e.g. when `b` was the preparation for `a`); the other best frame and all alternates are kept as
 * alternates. The merged candidate keeps `a`'s id and hold. A label always survives (labeled +
 * anything = labeled); "Not a pose" only when both were dismissed.
 */
export function mergeCandidates(a: ReviewCandidate, b: ReviewCandidate, sig: SignalView, keepBest = false): ReviewCandidate {
  const [first, second] = a.startS <= b.startS ? [a, b] : [b, a];
  const startS = Math.min(first.startS, second.startS);
  const endS = Math.max(first.endS, second.endS);
  const keepA = keepBest || motionAt(sig, a.bestS) <= motionAt(sig, b.bestS);
  const winner = keepA ? a.bestS : b.bestS;
  const loser = keepA ? b.bestS : a.bestS;
  const fit = fitSpan(startS, endS, sig);
  const alternatesS = [...new Set([...a.alternatesS, ...b.alternatesS, loser])].filter((t) => t !== winner).sort((x, y) => x - y);
  return {
    ...a,
    startS,
    endS,
    bestS: winner,
    alternatesS,
    clipStartS: fit.clipStartS,
    clipEndS: fit.clipEndS,
    status: a.status === 'labeled' || b.status === 'labeled' ? 'labeled' : a.status === 'dismissed' && b.status === 'dismissed' ? 'dismissed' : 'open',
    ...(a.holdId ? { holdId: a.holdId } : b.holdId ? { holdId: b.holdId } : {}),
  };
}

/** Splits a candidate at `atS`. The left part keeps the id, status and hold; the right part is open. */
export function splitCandidate(c: ReviewCandidate, atS: number, sig: SignalView): [ReviewCandidate, ReviewCandidate] {
  const minPart = 1 / sig.sampleHz;
  const t = Math.min(c.endS - minPart, Math.max(c.startS + minPart, atS));
  const left = fitSpan(c.startS, t, sig);
  const right = fitSpan(t, c.endS, sig);
  const { holdId, ...rest } = c;
  return [
    { ...c, endS: t, ...left, alternatesS: c.alternatesS.filter((x) => x < t) },
    {
      ...rest,
      id: editedId('split'),
      startS: t,
      ...right,
      alternatesS: c.alternatesS.filter((x) => x >= t),
      status: 'open',
      origin: 'manual',
    },
  ];
}

/**
 * Splits a candidate into `k` holds (k e.g. from the template: 6 × Utthita Hasta Padangusthasana
 * between two labeled holds). Knowing k replaces the still threshold: every hold is a valley of
 * C(t), so take the k most prominent valleys in the span (prominence = how far C rises on the
 * lower side before reaching a deeper point) and cut at the biggest posture change between
 * consecutive ones. Without k valleys, the longest parts are halved. The first part keeps the id,
 * status and hold; the others are new open candidates.
 */
export function splitInto(c: ReviewCandidate, k: number, sig: SignalView): ReviewCandidate[] {
  const hz = sig.sampleHz;
  const a = Math.max(0, Math.ceil(c.startS * hz));
  const b = Math.max(a, Math.min(sig.C.length, Math.floor(c.endS * hz)));
  const parts = Math.max(1, Math.min(Math.floor(k), b - a));
  if (parts < 2) return [c];
  const value = (i: number) => {
    const v = sig.C[i];
    return v !== undefined && Number.isFinite(v) ? v : NaN;
  };
  const argmax = (from: number, to: number) => {
    let best = from;
    for (let i = from; i < to; i++) if (!(value(i) <= value(best))) best = Number.isNaN(value(i)) ? best : i;
    return best;
  };
  const valleys = valleyProminence(value, a, b)
    .sort((x, y) => y.prominence - x.prominence || x.at - y.at)
    .slice(0, parts)
    .map((v) => v.at)
    .sort((x, y) => x - y);
  const cuts = valleys.slice(1).map((v, i) => argmax(valleys[i]! + 1, v));
  // Fewer valleys than holds: halve the longest part.
  while (cuts.length < parts - 1) {
    const bounds = [a, ...cuts.sort((x, y) => x - y), b];
    let li = 0;
    for (let i = 1; i < bounds.length - 1; i++) if (bounds[i + 1]! - bounds[i]! > bounds[li + 1]! - bounds[li]!) li = i;
    const mid = Math.round((bounds[li]! + bounds[li + 1]!) / 2);
    if (mid <= bounds[li]! || mid >= bounds[li + 1]!) break;
    cuts.push(mid);
  }
  cuts.sort((x, y) => x - y);
  const edges = [c.startS, ...cuts.map((i) => i / hz), c.endS];
  const { holdId, ...rest } = c;
  return edges.slice(0, -1).map((startS, i) => {
    const endS = edges[i + 1]!;
    const fit = fitSpan(startS, endS, sig);
    const alternatesS = [...c.alternatesS, c.bestS].filter((t) => t >= startS && t < endS && t !== fit.bestS).sort((x, y) => x - y);
    return i === 0
      ? { ...c, startS, endS, ...fit, alternatesS }
      : { ...rest, id: editedId('split'), startS, endS, ...fit, alternatesS, status: 'open' as const, origin: 'manual' as const };
  });
}

/**
 * A candidate for a hold the detector missed, around `atS`: expands over the surrounding samples
 * whose posture change is at or below the 75th percentile (at least ±2 s, at most ±60 s), never
 * beyond `bounds`.
 */
export function missedCandidate(atS: number, sig: SignalView, bounds?: TimeRange): ReviewCandidate {
  const hz = sig.sampleHz;
  const n = sig.C.length;
  // Bounds (the uncovered gap the user picked from) keep the new span off its neighbours.
  let lo = bounds ? Math.max(0, Math.ceil(bounds.fromS * hz)) : 0;
  let hi = bounds ? Math.min(n, Math.floor(bounds.toS * hz)) : n;
  if (hi - lo < 1) [lo, hi] = [0, n];
  const loose = percentile(sig.C, 75);
  const still = (i: number) => {
    const v = sig.C[i];
    return v !== undefined && Number.isFinite(v) && v <= loose;
  };
  const center = Math.min(hi - 1, Math.max(lo, Math.round(atS * hz)));
  const minHalf = Math.round(2 * hz);
  const maxHalf = Math.round(60 * hz);
  let a = center;
  let b = center + 1;
  while (a > lo && center - a < maxHalf && (center - a < minHalf || still(a - 1))) a--;
  while (b < hi && b - center < maxHalf && (b - center < minHalf || still(b))) b++;
  const startS = a / hz;
  const endS = Math.min(sig.durationS, b / hz);
  return { id: editedId('manual'), startS, endS, ...fitSpan(startS, endS, sig), alternatesS: [], status: 'open', origin: 'manual' };
}

/**
 * Runs the detector on one stretch of a video (e.g. an uncovered gap): the still threshold is the
 * stretch's own percentile, so holds the global threshold missed (sway, a short practice part
 * with much movement) can show up. Uses the stored signals; `frames` (pooled analysis frames, by
 * sample index of the whole video) enable the similar-frame merge, without them nothing merges.
 * The single-still case is off: a stretch is never one hold just because it is uniform. Returns
 * new open candidates (origin `manual`: a re-run of the whole video keeps them).
 */
export async function detectInRange(range: TimeRange, sig: SignalView, params: DetectionParams, frames: FrameAccess | null): Promise<ReviewCandidate[]> {
  const hz = sig.sampleHz;
  const a = Math.max(0, Math.ceil(range.fromS * hz - 1e-6));
  const b = Math.min(sig.C.length, sig.m.length, Math.floor(range.toS * hz + 1e-6));
  if (b - a < params.minHoldS * hz) return [];
  const slice = (v: ArrayLike<number>) => Float32Array.from({ length: b - a }, (_, i) => v[a + i] ?? NaN);
  const p: DetectionParams = { ...params, sampleHz: hz, singleStillMaxS: 0, ...(frames ? {} : { similarMergeFactor: 0 }) };
  const empty = new Uint8Array(0);
  const result = await findCandidates({ sampleHz: hz, m: slice(sig.m), C: slice(sig.C) }, { frame: (i) => (frames ? frames.frame(a + i) : empty) }, p);
  const o = a / hz;
  return result.candidates.map((c) => ({
    ...c,
    id: editedId('found'),
    startS: o + c.startS,
    endS: o + c.endS,
    bestS: o + c.bestS,
    alternatesS: c.alternatesS.map((t) => o + t),
    clipStartS: o + c.clipStartS,
    clipEndS: o + c.clipEndS,
    status: 'open' as const,
    origin: 'manual' as const,
  }));
}

/**
 * The uncovered stretch around `atS` between the neighbouring candidates (any status), or null if
 * `atS` lies inside a candidate. `toS` is Infinity after the last candidate.
 */
export function freeSpanAround(candidates: readonly ReviewCandidate[], atS: number): TimeRange | null {
  let fromS = 0;
  let toS = Infinity;
  for (const c of candidates) {
    if (c.startS <= atS && atS <= c.endS) return null;
    if (c.endS < atS) fromS = Math.max(fromS, c.endS);
    else toS = Math.min(toS, c.startS);
  }
  return { fromS, toS };
}

/** Moves the best frame; the previous best becomes an alternate. */
export function nudgeBest(c: ReviewCandidate, bestS: number): ReviewCandidate {
  const t = Math.min(c.endS, Math.max(c.startS, bestS));
  if (t === c.bestS) return c;
  const alternatesS = [...new Set([...c.alternatesS, c.bestS])].filter((x) => x !== t).sort((x, y) => x - y);
  return { ...c, bestS: t, alternatesS };
}

export function sortCandidates(list: ReviewCandidate[]): ReviewCandidate[] {
  return [...list].sort((a, b) => a.startS - b.startS || a.endS - b.endS);
}

function overlap(a: { startS: number; endS: number }, b: { startS: number; endS: number }): number {
  return Math.max(0, Math.min(a.endS, b.endS) - Math.max(a.startS, b.startS));
}

/**
 * After re-running detection: keep every labeled hold (its span replaces overlapping new
 * candidates), keep manual candidates, carry dismissals over to new candidates that mostly
 * overlap a dismissed one.
 */
export function reconcile(fresh: ReviewCandidate[], previous: ReviewCandidate[], holds: Hold[]): ReviewCandidate[] {
  const holdById = new Map(holds.map((h) => [h.id, h]));
  const keep = previous.filter((c) => (c.status === 'labeled' && c.holdId && holdById.has(c.holdId)) || c.origin === 'manual');
  const dismissed = previous.filter((c) => c.status === 'dismissed');
  const out: ReviewCandidate[] = [...keep];
  for (const c of fresh) {
    if (keep.some((k) => overlap(k, c) > 0.5 * Math.min(k.endS - k.startS, c.endS - c.startS))) continue;
    const wasDismissed = dismissed.some((d) => overlap(d, c) >= 0.5 * (c.endS - c.startS));
    out.push({ ...c, status: wasDismissed ? 'dismissed' : 'open', origin: 'detected' });
  }
  return sortCandidates(out);
}

/** Hold spans follow their candidate. */
export function holdFromCandidate(h: Hold, c: ReviewCandidate): Hold {
  return { ...h, startS: c.startS, endS: c.endS, bestS: c.bestS, clipStartS: c.clipStartS, clipEndS: c.clipEndS };
}
