import { bestFrameIndex, lowestSumWindow, percentile } from '../detection';
import type { Hold, ReviewCandidate } from '../model/types';
import type { SignalView } from './types';

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
 * Merges two candidates (in time order). The stiller best frame wins; the other best frame and
 * all alternates are kept as alternates. The merged candidate keeps `a`'s id and hold.
 */
export function mergeCandidates(a: ReviewCandidate, b: ReviewCandidate, sig: SignalView): ReviewCandidate {
  const [first, second] = a.startS <= b.startS ? [a, b] : [b, a];
  const startS = Math.min(first.startS, second.startS);
  const endS = Math.max(first.endS, second.endS);
  const keepA = motionAt(sig, a.bestS) <= motionAt(sig, b.bestS);
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
    status: a.status === 'labeled' || b.status !== 'labeled' ? a.status : b.status,
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
 * Local minima of `value` in [a, b) with their prominence: from the minimum, the highest value
 * passed on each side before reaching a lower point (or the span's end); the lower of the two
 * sides minus the minimum. A plateau counts once (its first sample). NaN samples are skipped.
 */
export function valleyProminence(value: (i: number) => number, a: number, b: number): Array<{ at: number; prominence: number }> {
  const idx: number[] = [];
  for (let i = a; i < b; i++) if (!Number.isNaN(value(i))) idx.push(i);
  const v = idx.map(value);
  const out: Array<{ at: number; prominence: number }> = [];
  for (let j = 0; j < v.length; j++) {
    const x = v[j]!;
    if (j > 0 && v[j - 1]! <= x) continue;
    let r = j;
    while (r + 1 < v.length && v[r + 1] === x) r++;
    if (r + 1 < v.length && v[r + 1]! < x) continue;
    let left = x;
    for (let l = j - 1; l >= 0 && v[l]! >= x; l--) left = Math.max(left, v[l]!);
    let right = x;
    for (let q = r + 1; q < v.length && v[q]! >= x; q++) right = Math.max(right, v[q]!);
    out.push({ at: idx[j]!, prominence: Math.min(left, right) - x });
  }
  return out;
}

/**
 * A candidate for a hold the detector missed, around `atS`: expands over the surrounding samples
 * whose posture change is at or below the 75th percentile (at least ±2 s, at most ±60 s).
 */
export function missedCandidate(atS: number, sig: SignalView): ReviewCandidate {
  const hz = sig.sampleHz;
  const n = sig.C.length;
  const loose = percentile(sig.C, 75);
  const still = (i: number) => {
    const v = sig.C[i];
    return v !== undefined && Number.isFinite(v) && v <= loose;
  };
  const center = Math.min(n - 1, Math.max(0, Math.round(atS * hz)));
  const minHalf = Math.round(2 * hz);
  const maxHalf = Math.round(60 * hz);
  let a = center;
  let b = center + 1;
  while (a > 0 && center - a < maxHalf && (center - a < minHalf || still(a - 1))) a--;
  while (b < n && b - center < maxHalf && (b - center < minHalf || still(b))) b++;
  const startS = a / hz;
  const endS = Math.min(sig.durationS, b / hz);
  return { id: editedId('manual'), startS, endS, ...fitSpan(startS, endS, sig), alternatesS: [], status: 'open', origin: 'manual' };
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
