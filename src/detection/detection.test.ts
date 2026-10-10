import { describe, expect, it } from 'vitest';
import { analyzeFrames, Detector, reanalyze } from './index';
import { findCandidates, joinGaps, stillRuns } from './candidates';
import { DEFAULT_PARAMS } from './params';
import { POSES, synthesize, type Segment } from './__fixtures__/synthetic';
import type { Candidate, DetectionParams } from './types';

const P: DetectionParams = { ...DEFAULT_PARAMS };

function overlaps(c: Candidate, h: { startS: number; endS: number }): number {
  return Math.max(0, Math.min(c.endS, h.endS) - Math.max(c.startS, h.startS));
}

/** A primary-series-like practice: standing poses, a balancing hold with sway, a split long hold. */
const PRACTICE: Segment[] = [
  { kind: 'move', seconds: 5, to: POSES.standing },
  { kind: 'hold', seconds: 20, pose: POSES.standing, sway: 0.2 },
  { kind: 'move', seconds: 5, to: POSES.triangle },
  { kind: 'hold', seconds: 25, pose: POSES.triangle, sway: 0.3 },
  { kind: 'move', seconds: 4, to: POSES.headstand },
  // balancing hold: sways as much as a slow transition frame-to-frame
  { kind: 'hold', seconds: 30, pose: POSES.headstand, sway: 1.2, swayPeriodS: 3 },
  { kind: 'move', seconds: 6, to: POSES.seated },
  // the same pose twice: out of it and back in (like reps), a separate hold each
  { kind: 'hold', seconds: 25, pose: POSES.seated, sway: 0.2 },
  { kind: 'move', seconds: 1.5, to: POSES.forwardFold, wobble: 0.5 },
  { kind: 'move', seconds: 1.5, to: POSES.seated, wobble: 0.5 },
  { kind: 'hold', seconds: 25, pose: POSES.seated, sway: 0.2 },
  { kind: 'move', seconds: 5, to: POSES.forwardFold },
  { kind: 'hold', seconds: 15, pose: POSES.forwardFold, sway: 0.2 },
  { kind: 'move', seconds: 6, to: POSES.standing },
];

describe('detection on a synthetic practice', () => {
  it('finds every hold once, with best frame and clip inside the hold', async () => {
    const video = synthesize(POSES.seated, PRACTICE);
    const { result, signals } = await analyzeFrames(video.frames, P);
    expect(signals.m.length).toBe(video.frames.length);
    expect(result.singleStill).toBe(false);
    const truth = video.holds;
    expect(result.candidates.length).toBe(truth.length);
    result.candidates.forEach((c, i) => {
      const h = truth[i]!;
      expect(overlaps(c, h) / (c.endS - c.startS)).toBeGreaterThan(0.9);
      expect(c.bestS).toBeGreaterThanOrEqual(h.startS);
      expect(c.bestS).toBeLessThanOrEqual(h.endS);
      expect(c.clipEndS - c.clipStartS).toBeCloseTo(P.clipWindowS);
      expect(c.clipStartS).toBeGreaterThanOrEqual(c.startS);
      expect(c.clipEndS).toBeLessThanOrEqual(c.endS);
      expect(c.status).toBe('open');
    });
    // Without the gap-motion condition the two look-alike seated holds become one.
    const loose = await analyzeFrames(video.frames, { ...P, similarMergeMotion: Infinity });
    expect(loose.result.candidates.length).toBe(truth.length - 1);
    const merged = loose.result.candidates[3]!;
    expect(merged.startS).toBe(result.candidates[3]!.startS);
    expect(merged.endS).toBe(result.candidates[4]!.endS);
    expect(merged.alternatesS.length).toBeGreaterThanOrEqual(1);
  });

  it('does not merge adjacent holds of different poses', async () => {
    const video = synthesize(POSES.standing, [
      { kind: 'hold', seconds: 15, pose: POSES.standing },
      { kind: 'move', seconds: 3, to: POSES.triangle },
      { kind: 'hold', seconds: 15, pose: POSES.triangle },
      { kind: 'move', seconds: 3, to: POSES.standing },
      { kind: 'hold', seconds: 15, pose: POSES.standing },
    ]);
    const { result } = await analyzeFrames(video.frames, P);
    expect(result.candidates.length).toBe(3);
    expect(result.candidates.every((c) => c.alternatesS.length === 0)).toBe(true);
  });

  it('respects the max gap for similar merges and can be disabled', async () => {
    const video = synthesize(POSES.seated, [
      { kind: 'hold', seconds: 15, pose: POSES.seated },
      { kind: 'move', seconds: 1.5, to: POSES.forwardFold, wobble: 0.5 },
      { kind: 'move', seconds: 1.5, to: POSES.seated, wobble: 0.5 },
      { kind: 'hold', seconds: 15, pose: POSES.seated },
      { kind: 'move', seconds: 3, to: POSES.triangle },
      { kind: 'hold', seconds: 15, pose: POSES.triangle },
    ]);
    // Out of the pose and back in moves more than the hold sways: kept apart by default.
    expect((await analyzeFrames(video.frames, P)).result.candidates.length).toBe(3);
    const any = { ...P, similarMergeMotion: Infinity };
    const on = await analyzeFrames(video.frames, any);
    expect(on.result.candidates.length).toBe(2);
    const off = await analyzeFrames(video.frames, { ...any, similarMergeFactor: 0 });
    expect(off.result.candidates.length).toBe(3);
    const noGap = await analyzeFrames(video.frames, { ...any, similarMergeMaxGapS: 1 });
    expect(noGap.result.candidates.length).toBe(3);
  });

  it('keeps the stiller frame as best when merging', async () => {
    const video = synthesize(POSES.seated, [
      { kind: 'hold', seconds: 15, pose: POSES.seated, sway: 0.6, swayPeriodS: 2 },
      { kind: 'move', seconds: 1.5, to: POSES.forwardFold, wobble: 0.5 },
      { kind: 'move', seconds: 1.5, to: POSES.seated, wobble: 0.5 },
      { kind: 'hold', seconds: 15, pose: POSES.seated, sway: 0 },
      { kind: 'move', seconds: 4, to: POSES.triangle },
      { kind: 'hold', seconds: 10, pose: POSES.triangle },
    ]);
    const { result, signals } = await analyzeFrames(video.frames, { ...P, similarMergeMotion: Infinity });
    const c = result.candidates[0]!;
    const hz = P.sampleHz;
    expect(c.alternatesS.length).toBeGreaterThan(0);
    for (const alt of c.alternatesS) {
      expect(signals.m[Math.round(c.bestS * hz)]!).toBeLessThanOrEqual(signals.m[Math.round(alt * hz)]!);
    }
  });

  it('treats a clip of a single pose as one candidate', async () => {
    const video = synthesize(POSES.headstand, [{ kind: 'hold', seconds: 30, pose: POSES.headstand, sway: 0.4 }]);
    const { result } = await analyzeFrames(video.frames, P);
    expect(result.singleStill).toBe(true);
    expect(result.candidates.length).toBe(1);
    const c = result.candidates[0]!;
    expect(c.startS).toBe(0);
    expect(c.endS).toBe(30);
    expect(c.bestS).toBeGreaterThanOrEqual(3);
    expect(c.bestS).toBeLessThanOrEqual(27);
  });

  it('treats a perfectly static clip as one candidate', async () => {
    const video = synthesize(POSES.seated, [{ kind: 'hold', seconds: 10, pose: POSES.seated }], { noise: 0 });
    const { result } = await analyzeFrames(video.frames, P);
    expect(result.singleStill).toBe(true);
    expect(result.candidates.length).toBe(1);
  });

  it('handles tiny and empty inputs', async () => {
    const video = synthesize(POSES.seated, [{ kind: 'hold', seconds: 0.5, pose: POSES.seated }]);
    const { result } = await analyzeFrames(video.frames, P);
    expect(result.candidates.length).toBe(1);
    const empty = await findCandidates({ sampleHz: 4, m: new Float32Array(0), C: new Float32Array(0) }, { frame: () => new Uint8Array(0) }, P);
    expect(empty.candidates).toEqual([]);
  });

  it('drops runs shorter than minHoldS', async () => {
    const video = synthesize(POSES.standing, [
      { kind: 'hold', seconds: 20, pose: POSES.standing },
      { kind: 'move', seconds: 4, to: POSES.triangle },
      { kind: 'hold', seconds: 4, pose: POSES.triangle },
      { kind: 'move', seconds: 4, to: POSES.seated },
      { kind: 'hold', seconds: 20, pose: POSES.seated },
    ]);
    const { result } = await analyzeFrames(video.frames, P);
    expect(result.candidates.length).toBe(2);
  });

  it('Detector supports drain, snapshot and restore; reanalyze matches', async () => {
    const video = synthesize(POSES.seated, PRACTICE.slice(0, 6));
    const d = new Detector(P);
    video.frames.slice(0, 100).forEach((f) => d.push(f));
    expect(d.count).toBe(100);
    expect(d.drain().C.length).toBeGreaterThan(0);
    const d2 = new Detector(P);
    d2.restore(d.snapshot());
    video.frames.slice(100).forEach((f) => d2.push(f));
    const a = await d2.finish({ frame: (i) => video.frames[i]!.data });
    const b = await analyzeFrames(video.frames, P);
    expect(a.result.candidates).toEqual(b.result.candidates);
    const progress: number[] = [];
    const f0 = video.frames[0]!;
    const c = await reanalyze(video.frames.length, f0.width, f0.height, { frame: async (i) => video.frames[i]!.data }, P, (n) => progress.push(n));
    expect(c.result.candidates).toEqual(b.result.candidates);
    expect(progress[0]).toBe(0);
    const c2 = await reanalyze(video.frames.length, f0.width, f0.height, { frame: (i) => video.frames[i]!.data }, P);
    expect(c2.result.candidates.length).toBe(b.result.candidates.length);
  });
});

describe('long inputs', () => {
  // Almost all hold: p55 of C cuts through noise and splits the holds; the noise fragments merge.
  it('handles videos longer than the initial buffers', async () => {
    const video = synthesize(POSES.standing, [
      { kind: 'hold', seconds: 160, pose: POSES.standing },
      { kind: 'move', seconds: 5, to: POSES.triangle },
      { kind: 'hold', seconds: 160, pose: POSES.triangle },
    ], { width: 16, height: 10 });
    const { result } = await analyzeFrames(video.frames, P);
    expect(video.frames.length).toBeGreaterThan(1024);
    expect(result.candidates.length).toBe(2);
  });
});

describe('run helpers', () => {
  it('stillRuns finds maximal half-open runs', () => {
    const v = [1, 1, 0, 1, 0, 0, 1];
    expect(stillRuns(v.length, (i) => v[i] === 1)).toEqual([[0, 2], [3, 4], [6, 7]]);
    expect(stillRuns(0, () => true)).toEqual([]);
  });
  it('joinGaps joins gaps shorter than the limit', () => {
    expect(joinGaps([[0, 2], [3, 4], [10, 12]], 2)).toEqual([[0, 4], [10, 12]]);
    expect(joinGaps([[0, 2], [3, 4]], 1)).toEqual([[0, 2], [3, 4]]);
  });
  it('falls back to the run centre when m has no finite values', async () => {
    const n = 40;
    const C = new Float32Array(n).fill(1);
    const m = new Float32Array(n).fill(NaN);
    const r = await findCandidates({ sampleHz: 4, m, C }, { frame: () => new Uint8Array(1) }, P);
    expect(r.candidates[0]!.bestS).toBe(5);
  });
});
