import { medianFilter } from './stats';
import type { DetectionParams, DetectorSnapshot, GrayFrame, SignalChunk, Signals } from './types';

/** Growable Float32 buffer. */
class FloatSeries {
  private buf: Float32Array;
  length = 0;

  constructor(capacity = 1024) {
    this.buf = new Float32Array(Math.max(16, capacity));
  }

  set(i: number, v: number): void {
    if (i >= this.buf.length) {
      let cap = this.buf.length;
      while (cap <= i) cap *= 2;
      const next = new Float32Array(cap);
      next.set(this.buf.subarray(0, this.length));
      this.buf = next;
    }
    if (i >= this.length) {
      this.buf.fill(NaN, this.length, i);
      this.length = i + 1;
    }
    this.buf[i] = v;
  }

  view(): Float32Array {
    return this.buf.subarray(0, this.length);
  }

  copy(): Float32Array {
    return this.buf.slice(0, this.length);
  }
}

/** 2×2 (or k×k) average pooling of a grayscale image. Partial border blocks are dropped. */
export function poolGray(src: GrayFrame, factor: number): GrayFrame {
  const f = Math.max(1, Math.floor(factor));
  if (f === 1) return src;
  const w = Math.max(1, Math.floor(src.width / f));
  const h = Math.max(1, Math.floor(src.height / f));
  const out = new Uint8Array(w * h);
  const area = f * f;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = 0; dy < f; dy++) {
        const row = (y * f + dy) * src.width + x * f;
        for (let dx = 0; dx < f; dx++) s += src.data[row + dx] ?? 0;
      }
      out[y * w + x] = Math.round(s / area);
    }
  }
  return { width: w, height: h, data: out };
}

/**
 * Streaming computation of
 *  - raw short-lag motion: mean |f(t) − f(t − 1 sample)|
 *  - posture change C(t) = mean |mean(f[t−K, t)) − mean(f[t, t+K))|, K = changeWindowS · sampleHz
 *
 * Only the last 2K+1 frames are kept (ring buffer); running sums make each step O(pixels).
 * C(t) lags the input by K samples. Truncated windows (≥ edgeWindowMinS) are used at the start
 * and, after `finish()`, at the end of the video.
 */
export class SignalStream {
  readonly K: number;
  readonly edgeMin: number;
  private readonly hz: number;
  private readonly medianWindow: number;
  private width = 0;
  private height = 0;
  private pixels = 0;
  private ring: Uint8Array[] = [];
  private ringStart = 0; // sample index of ring[0]
  private sumBefore: Int32Array = new Int32Array(0);
  private sumAfter: Int32Array = new Int32Array(0);
  private raw = new FloatSeries();
  private change = new FloatSeries();
  private drained = 0;
  private finished = false;
  count = 0;

  constructor(params: Pick<DetectionParams, 'sampleHz' | 'changeWindowS' | 'edgeWindowMinS' | 'motionMedianWindow'>) {
    this.hz = params.sampleHz;
    this.K = Math.max(1, Math.round(params.changeWindowS * params.sampleHz));
    this.edgeMin = Math.max(1, Math.min(this.K, Math.round(params.edgeWindowMinS * params.sampleHz)));
    this.medianWindow = params.motionMedianWindow;
  }

  get frameSize(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  /** Index of the next C value that will be computed (all lower indices are final). */
  get changeComputedUntil(): number {
    return this.change.length;
  }

  push(frame: GrayFrame): void {
    if (this.finished) throw new Error('SignalStream already finished');
    if (this.count === 0) this.init(frame.width, frame.height);
    else if (frame.width !== this.width || frame.height !== this.height) {
      throw new Error(`Frame size changed from ${this.width}×${this.height} to ${frame.width}×${frame.height}`);
    }
    const n = this.count;
    const f = frame.data;

    // Short-lag motion.
    const prev = this.frameAt(n - 1);
    if (prev) {
      let s = 0;
      for (let p = 0; p < this.pixels; p++) s += Math.abs(f[p]! - prev[p]!);
      this.raw.set(n, s / this.pixels);
    } else {
      this.raw.set(n, NaN);
    }

    // Ring buffer (keeps frames n−2K … n).
    this.ring.push(f);
    if (this.ring.length > 2 * this.K + 1) {
      this.ring.shift();
      this.ringStart++;
    }

    // Running sums: after = [n−K+1, n], before = [n−2K+1, n−K].
    const K = this.K;
    const leaving = this.frameAt(n - K);
    const old = this.frameAt(n - 2 * K);
    for (let p = 0; p < this.pixels; p++) {
      const v = f[p]!;
      let a = this.sumAfter[p]! + v;
      let b = this.sumBefore[p]!;
      if (leaving) {
        const l = leaving[p]!;
        a -= l;
        b += l;
      }
      if (old) b -= old[p]!;
      this.sumAfter[p] = a;
      this.sumBefore[p] = b;
    }
    this.count = n + 1;

    const c = n - K + 1;
    if (c >= K) {
      let s = 0;
      for (let p = 0; p < this.pixels; p++) s += Math.abs(this.sumBefore[p]! - this.sumAfter[p]!);
      this.change.set(c, s / (this.pixels * K));
    } else if (c >= 0) {
      this.change.set(c, c >= this.edgeMin ? this.directChange(c, this.count) : NaN);
    }
  }

  /** Completes C(t) at the end of the video (truncated after-windows). Idempotent. */
  finish(): void {
    if (this.finished) return;
    this.finished = true;
    const N = this.count;
    for (let c = Math.max(0, this.change.length); c < N; c++) {
      const ok = c >= this.edgeMin && N - c >= this.edgeMin;
      this.change.set(c, ok ? this.directChange(c, N) : NaN);
    }
  }

  /** New C values since the last drain (for live graphs). */
  drain(): SignalChunk {
    const from = this.drained;
    const C = this.change.view().slice(from);
    this.drained = this.change.length;
    return { from, C };
  }

  /** Final signals. Call `finish()` first for complete C at the end of the video. */
  signals(): Signals {
    const raw = this.raw.copy();
    if (raw.length > 1) raw[0] = raw[1]!;
    else if (raw.length === 1) raw[0] = 0;
    const m = medianFilter(raw, this.medianWindow);
    const C = new Float32Array(this.count).fill(NaN);
    C.set(this.change.view().subarray(0, this.count));
    return { sampleHz: this.hz, m, C };
  }

  snapshot(): DetectorSnapshot {
    return {
      version: 1,
      count: this.count,
      width: this.width,
      height: this.height,
      ring: this.ring.map((r) => r.slice()),
      rawMotion: this.raw.copy(),
      C: this.change.copy(),
    };
  }

  /** Restores a snapshot into a fresh stream created with the same parameters. */
  restore(s: DetectorSnapshot): void {
    if (this.count !== 0) throw new Error('restore() requires a fresh SignalStream');
    if (s.count === 0) return;
    this.init(s.width, s.height);
    this.count = s.count;
    this.ring = s.ring.map((r) => r.slice());
    this.ringStart = s.count - this.ring.length;
    for (let i = 0; i < s.rawMotion.length; i++) this.raw.set(i, s.rawMotion[i]!);
    for (let i = 0; i < s.C.length; i++) this.change.set(i, s.C[i]!);
    // Rebuild running sums from the ring: after = [n−K+1, n], before = [n−2K+1, n−K] with n = count−1.
    const n = s.count - 1;
    const K = this.K;
    for (let i = Math.max(0, n - 2 * K + 1); i <= n; i++) {
      const f = this.frameAt(i);
      if (!f) throw new Error('Snapshot ring is too short for the configured window');
      const target = i > n - K ? this.sumAfter : this.sumBefore;
      for (let p = 0; p < this.pixels; p++) target[p] = target[p]! + f[p]!;
    }
  }

  private init(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.pixels = width * height;
    this.sumBefore = new Int32Array(this.pixels);
    this.sumAfter = new Int32Array(this.pixels);
  }

  private frameAt(i: number): Uint8Array | undefined {
    if (i < this.ringStart || i < 0) return undefined;
    return this.ring[i - this.ringStart];
  }

  /** C at centre c with windows truncated to [0, available). */
  private directChange(c: number, available: number): number {
    const a0 = Math.max(0, c - this.K);
    const b1 = Math.min(available, c + this.K);
    const nb = c - a0;
    const na = b1 - c;
    if (nb <= 0 || na <= 0) return NaN;
    const before = new Float64Array(this.pixels);
    const after = new Float64Array(this.pixels);
    for (let i = a0; i < c; i++) {
      const f = this.frameAt(i);
      if (!f) return NaN;
      for (let p = 0; p < this.pixels; p++) before[p]! += f[p]!;
    }
    for (let i = c; i < b1; i++) {
      const f = this.frameAt(i);
      if (!f) return NaN;
      for (let p = 0; p < this.pixels; p++) after[p]! += f[p]!;
    }
    let s = 0;
    for (let p = 0; p < this.pixels; p++) s += Math.abs(before[p]! / nb - after[p]! / na);
    return s / this.pixels;
  }
}
