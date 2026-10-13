import { describe, expect, it } from 'vitest';
import { findCandidates, innerPeakCuts } from './candidates';
import { DEFAULT_PARAMS, normalizeParams } from './params';
import { percentile, rollingPercentile, valleyProminence } from './stats';
import type { DetectionParams, FrameAccess } from './types';

const HZ = 4;
const P: DetectionParams = { ...DEFAULT_PARAMS, singleStillMaxS: 0 };

/** C built from [seconds, value] pieces; m follows C (moving between holds, little inside). */
function signal(pieces: Array<[number, number]>) {
  const C: number[] = [];
  for (const [s, v] of pieces) for (let i = 0; i < s * HZ; i++) C.push(v);
  return { sampleHz: HZ, C: Float32Array.from(C), m: Float32Array.from(C, (c) => 0.1 + 0.2 * c) };
}

/** Percentile (0–100) at the middle of the block of samples equal to `v`. */
function rankOf(C: Float32Array, v: number): number {
  const sorted = [...C].sort((a, b) => a - b);
  return (100 * (sorted.indexOf(v) + sorted.lastIndexOf(v))) / 2 / (sorted.length - 1);
}

/** Every sample looks different (nothing merges)… */
const distinct: FrameAccess = { frame: (i) => new Uint8Array(16).fill((i * 37) % 256) };
/** …or every sample looks the same (everything that may merge does). */
const same: FrameAccess = { frame: () => new Uint8Array(16).fill(7) };

const spans = (cs: Array<{ startS: number; endS: number }>) => cs.map((c) => [c.startS, c.endS]);

describe('rollingPercentile', () => {
  it('equals the percentile of each truncated centred window, skipping NaN', () => {
    const v = Array.from({ length: 200 }, (_, i) => (i % 17 === 0 ? NaN : Math.sin(i * 1.3) * 10 + (i % 7)));
    for (const half of [0, 1, 5, 30, 300]) {
      const r = rollingPercentile(v, half, 55);
      for (let i = 0; i < v.length; i++) {
        const w = v.slice(Math.max(0, i - half), Math.min(v.length, i + half + 1));
        const want = percentile(w, 55);
        if (Number.isNaN(want)) expect(r[i]).toBeNaN();
        else expect(r[i]).toBeCloseTo(want, 4);
      }
    }
  });

  it('is NaN where the window has no finite value', () => {
    const r = rollingPercentile([NaN, NaN, NaN, 1], 1, 50);
    expect([...r].map((x) => (Number.isNaN(x) ? null : x))).toEqual([null, null, 1, 1]);
    expect(rollingPercentile([], 3, 50).length).toBe(0);
  });
});

describe('valleyProminence (shared with labeling.splitInto)', () => {
  it('measures each minimum against the lower side', () => {
    const v = [3, 1, 2, 0, 3, 2, 2, 4];
    expect(valleyProminence((i) => v[i]!, 0, v.length)).toEqual([
      { at: 1, prominence: 1 },
      { at: 3, prominence: 3 },
      { at: 5, prominence: 1 },
    ]);
  });
});

describe('detector variants', () => {
  it('the defaults keep the global threshold, no hysteresis and no splitting', () => {
    expect(P.thresholdMode).toBe('global');
    expect(P.stillPercentileExit).toBe(P.stillPercentile);
    expect(P.splitPeakFactor).toBe(0);
    expect(normalizeParams({ thresholdMode: 'bogus' as 'global' }).thresholdMode).toBe('global');
    expect(normalizeParams({ thresholdMode: 'rolling' }).thresholdMode).toBe('rolling');
  });

  it('rolling threshold: a part with much movement does not swallow the calm part', async () => {
    // Calm part: holds at 0.2, transitions at 2. Busy part: holds swaying at 2.5, transitions at 6.
    const pieces: Array<[number, number]> = [];
    const holds: Array<[number, number]> = [];
    for (const [hold, move] of [
      [0.2, 2],
      [2.5, 6],
    ] as const) {
      for (let k = 0; k < 10; k++) {
        const t = pieces.reduce((s, [d]) => s + d, 0);
        holds.push([t, t + 40]);
        pieces.push([40, hold], [10, move]);
      }
    }
    const sig = signal(pieces);
    const own = (cs: Array<{ startS: number; endS: number }>) =>
      holds.filter(([a, b]) => cs.some((c) => Math.abs(c.startS - a) <= 1 && Math.abs(c.endS - b) <= 1)).length;
    const global = await findCandidates(sig, distinct, P);
    // The global p55 lands on the busy holds: the calm transitions count as still.
    expect(global.threshold).toBeCloseTo(2.5, 5);
    expect(global.candidates[0]!.endS).toBeGreaterThan(400);
    // Only busy holds are found, minus the first (joined with the last calm transition).
    expect(own(global.candidates)).toBe(9);
    const rolling = await findCandidates(sig, distinct, { ...P, thresholdMode: 'rolling', thresholdWindowS: 200 });
    expect(rolling.threshold).toBeCloseTo(global.threshold, 5);
    // Only the calm holds within a window of the busy part are still joined.
    expect(own(rolling.candidates)).toBeGreaterThanOrEqual(18);
    expect(own(rolling.candidates.filter((c) => c.endS < 400))).toBe(8);
  });

  it('hysteresis: a hold stays one run while C stays below the exit threshold', async () => {
    // Holds at 0.5 with a 3 s sway burst at 1.5 in the middle; transitions at 5.
    const pieces: Array<[number, number]> = [[10, 5]];
    for (let k = 0; k < 4; k++) pieces.push([15, 0.5], [3, 1.5], [15, 0.5], [12, 5]);
    const sig = signal(pieces);
    const plain = await findCandidates(sig, distinct, P);
    expect(plain.threshold).toBe(0.5);
    expect(plain.candidates.length).toBe(8);
    // The exit percentile that reaches the burst value.
    const exit = rankOf(sig.C, 1.5);
    const hyst = await findCandidates(sig, distinct, { ...P, stillPercentileExit: exit });
    expect(spans(hyst.candidates)).toEqual([
      [10, 43],
      [55, 88],
      [100, 133],
      [145, 178],
    ]);
    // An exit percentile below the enter one changes nothing.
    expect(spans((await findCandidates(sig, distinct, { ...P, stillPercentileExit: 20 })).candidates)).toEqual(spans(plain.candidates));
  });

  it('hysteresis: a run that never reaches the enter threshold is no hold', async () => {
    const pieces: Array<[number, number]> = [];
    for (let k = 0; k < 6; k++) pieces.push([20, 0.5], [10, 5]);
    pieces.push([20, 1.5], [10, 5]);
    const sig = signal(pieces);
    const exit = rankOf(sig.C, 1.5);
    const r = await findCandidates(sig, distinct, { ...P, stillPercentileExit: exit });
    expect(r.candidates.length).toBe(6);
  });

  it('splitPeakFactor cuts a still run at a prominent inner peak; the parts never merge again', async () => {
    // Two look-alike holds (0.3) with a small change between them (0.9) under the threshold (≈ 1).
    const pieces: Array<[number, number]> = [[10, 6]];
    for (let k = 0; k < 3; k++) pieces.push([12, 0.3], [2, 0.9], [12, 0.3], [10, 6]);
    pieces.push([30, 1]);
    const sig = signal(pieces);
    const off = await findCandidates(sig, same, P);
    expect(off.threshold).toBe(1);
    // Off: the run of the trailing 30 s at exactly the threshold plus three double holds.
    const doubles = (r: typeof off) => r.candidates.filter((c) => c.endS - c.startS > 20 && c.endS < 110);
    expect(doubles(off).length).toBe(3);
    const on = await findCandidates(sig, same, { ...P, splitPeakFactor: 0.5 });
    const firstThree = on.candidates.filter((c) => c.endS <= 112);
    expect(spans(firstThree)).toEqual([
      [10, 22],
      [22, 36],
      [46, 58],
      [58, 72],
      [82, 94],
      [94, 108],
    ]);
    expect(on.preMerge.length).toBe(on.candidates.length);
    // Not prominent enough: no cut.
    expect(doubles(await findCandidates(sig, same, { ...P, splitPeakFactor: 0.7 })).length).toBe(3);
  });

  it('innerPeakCuts keeps every part at least minLen long, most prominent peaks first', () => {
    const C = [0.2, 0.2, 0.2, 0.9, 0.2, 0.2, 0.2, 0.2, 0.6, 0.2, 0.2, 0.2, 0.2, 0.95, 0.2];
    const thr = () => 1;
    expect(innerPeakCuts(C, 0, C.length, thr, 0, 1)).toEqual([]);
    expect(innerPeakCuts(C, 0, C.length, thr, 0.3, 1)).toEqual([3, 8, 13]);
    // 0.6 is not prominent enough at 0.5.
    expect(innerPeakCuts(C, 0, C.length, thr, 0.5, 1)).toEqual([3, 13]);
    // Parts of at least 3: the peak at 13 would leave 2 samples.
    expect(innerPeakCuts(C, 0, C.length, thr, 0.3, 3)).toEqual([3, 8]);
    // NaN samples are skipped.
    expect(innerPeakCuts([0.2, NaN, 0.9, 0.2], 0, 4, thr, 0.5, 1)).toEqual([2]);
  });
});
