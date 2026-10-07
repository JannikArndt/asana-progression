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
