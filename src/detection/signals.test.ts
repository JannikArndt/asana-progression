import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from './params';
import { poolGray, SignalStream } from './signals';
import { POSES, rng, synthesize } from './__fixtures__/synthetic';
import type { GrayFrame } from './types';

function referenceC(frames: GrayFrame[], K: number, edgeMin: number): Float32Array {
  const N = frames.length;
  const out = new Float32Array(N).fill(NaN);
  const P = frames[0]!.data.length;
  for (let c = 0; c < N; c++) {
    if (c < edgeMin || N - c < edgeMin) continue;
    const a0 = Math.max(0, c - K);
    const b1 = Math.min(N, c + K);
    let s = 0;
    for (let p = 0; p < P; p++) {
      let before = 0;
      let after = 0;
      for (let i = a0; i < c; i++) before += frames[i]!.data[p]!;
      for (let i = c; i < b1; i++) after += frames[i]!.data[p]!;
      s += Math.abs(before / (c - a0) - after / (b1 - c));
    }
    out[c] = s / P;
  }
  return out;
}

function randomFrames(n: number, seed: number, w = 6, h = 4): GrayFrame[] {
  const r = rng(seed);
  return Array.from({ length: n }, () => ({
    width: w,
    height: h,
    data: Uint8Array.from({ length: w * h }, () => Math.floor(r() * 256)),
  }));
}

const P = { ...DEFAULT_PARAMS };

describe('SignalStream', () => {
  it('streaming C equals a direct computation (incl. truncated edges)', () => {
    for (const n of [1, 3, 10, 20, 33, 34, 80]) {
      const frames = randomFrames(n, n);
      const s = new SignalStream(P);
      for (const f of frames) s.push(f);
      s.finish();
      const { C } = s.signals();
      const ref = referenceC(frames, s.K, s.edgeMin);
      expect(C.length).toBe(n);
      for (let i = 0; i < n; i++) {
        if (Number.isNaN(ref[i]!)) expect(C[i]).toBeNaN();
        else expect(C[i]).toBeCloseTo(ref[i]!, 3);
      }
    }
  });

  it('computes raw motion and median filtering', () => {
    const frames: GrayFrame[] = [0, 0, 10, 10, 10].map((v) => ({ width: 1, height: 1, data: new Uint8Array([v]) }));
    const s = new SignalStream({ ...P, motionMedianWindow: 1 });
    frames.forEach((f) => s.push(f));
    s.finish();
    expect(Array.from(s.signals().m)).toEqual([0, 0, 10, 0, 0]);
    const single = new SignalStream(P);
    single.push(frames[0]!);
    expect(Array.from(single.signals().m)).toEqual([0]);
    expect(Array.from(new SignalStream(P).signals().m)).toEqual([]);
  });

  it('C lags by K samples while streaming and drain returns only new values', () => {
    const frames = randomFrames(60, 7);
    const s = new SignalStream(P);
    const chunks: number[] = [];
    let collected = 0;
    for (const f of frames) {
      s.push(f);
      const d = s.drain();
      expect(d.from).toBe(collected);
      collected += d.C.length;
      chunks.push(d.C.length);
    }
    expect(s.changeComputedUntil).toBe(60 - s.K + 1);
    s.finish();
    s.finish(); // idempotent
    const tail = s.drain();
    expect(tail.from + tail.C.length).toBe(60);
    expect(() => s.push(frames[0]!)).toThrow(/finished/);
  });

  it('rejects frame size changes', () => {
    const s = new SignalStream(P);
    s.push({ width: 2, height: 2, data: new Uint8Array(4) });
    expect(() => s.push({ width: 3, height: 2, data: new Uint8Array(6) })).toThrow(/size changed/);
  });

  it('snapshot/restore continues exactly where it left off', () => {
    const frames = randomFrames(120, 11);
    for (const cut of [0, 5, 31, 33, 50, 119]) {
      const a = new SignalStream(P);
      frames.slice(0, cut).forEach((f) => a.push(f));
      const snap = a.snapshot();
      const b = new SignalStream(P);
      b.restore(structuredClone(snap));
      frames.slice(cut).forEach((f) => b.push(f));
      b.finish();
      const ref = new SignalStream(P);
      frames.forEach((f) => ref.push(f));
      ref.finish();
      const x = b.signals();
      const y = ref.signals();
      expect(Array.from(x.C)).toEqual(Array.from(y.C));
      expect(Array.from(x.m)).toEqual(Array.from(y.m));
      expect(b.frameSize).toEqual({ width: 6, height: 4 });
    }
  });

  it('restore requires a fresh stream and a sufficient ring', () => {
    const a = new SignalStream(P);
    a.push({ width: 1, height: 1, data: new Uint8Array([1]) });
    expect(() => a.restore(a.snapshot())).toThrow(/fresh/);
    const frames = randomFrames(50, 3);
    const big = new SignalStream(P);
    frames.forEach((f) => big.push(f));
    const snap = big.snapshot();
    snap.ring = snap.ring.slice(-3);
    expect(() => new SignalStream(P).restore(snap)).toThrow(/too short/);
  });

  it('works on a synthetic practice: C is high during moves, low during holds', () => {
    const { frames } = synthesize(POSES.standing, [
      { kind: 'hold', seconds: 20, pose: POSES.standing },
      { kind: 'move', seconds: 4, to: POSES.triangle },
      { kind: 'hold', seconds: 20, pose: POSES.triangle },
    ]);
    const s = new SignalStream(P);
    frames.forEach((f) => s.push(f));
    s.finish();
    const { C } = s.signals();
    const hold = C[40]!; // 10 s
    const move = C[88]!; // 22 s
    expect(move).toBeGreaterThan(hold * 4);
  });
});

describe('poolGray', () => {
  it('averages k×k blocks and drops partial borders', () => {
    const src = { width: 5, height: 2, data: new Uint8Array([0, 2, 4, 6, 99, 2, 4, 6, 8, 99]) };
    const out = poolGray(src, 2);
    expect(out.width).toBe(2);
    expect(out.height).toBe(1);
    expect(Array.from(out.data)).toEqual([2, 6]);
    expect(poolGray(src, 1)).toBe(src);
    expect(poolGray({ width: 1, height: 1, data: new Uint8Array([5]) }, 4).data.length).toBe(1);
  });
});
