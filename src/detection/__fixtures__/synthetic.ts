import type { GrayFrame } from '../types';

/** A pose is a set of rectangles (relative coordinates 0–1). */
export type Pose = Array<{ x: number; y: number; w: number; h: number }>;

export type Segment =
  | { kind: 'hold'; seconds: number; pose: Pose; sway?: number; swayPeriodS?: number }
  | { kind: 'move'; seconds: number; to: Pose; wobble?: number };

export interface SyntheticOptions {
  width?: number;
  height?: number;
  hz?: number;
  noise?: number;
  seed?: number;
  background?: number;
  foreground?: number;
}

export interface SyntheticVideo {
  frames: GrayFrame[];
  /** True hold spans in seconds. */
  holds: Array<{ startS: number; endS: number }>;
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

export function renderPose(pose: Pose, dx: number, W: number, H: number, opts: Required<SyntheticOptions>, rand: () => number): GrayFrame {
  const data = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let cov = 0;
      for (const r of pose) {
        const x0 = r.x * W + dx;
        const y0 = r.y * H;
        cov += overlap(x, x + 1, x0, x0 + r.w * W) * overlap(y, y + 1, y0, y0 + r.h * H);
      }
      cov = Math.min(1, cov);
      const v = opts.background + (opts.foreground - opts.background) * cov + (rand() * 2 - 1) * opts.noise;
      data[y * W + x] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }
  return { width: W, height: H, data };
}

function lerpPose(a: Pose, b: Pose, t: number): Pose {
  return a.map((r, i) => {
    const s = b[i] ?? r;
    return { x: r.x + (s.x - r.x) * t, y: r.y + (s.y - r.y) * t, w: r.w + (s.w - r.w) * t, h: r.h + (s.h - r.h) * t };
  });
}

/** Renders a sequence of holds and transitions into pooled-size frames. */
export function synthesize(start: Pose, segments: Segment[], options: SyntheticOptions = {}): SyntheticVideo {
  const opts: Required<SyntheticOptions> = {
    width: 40,
    height: 24,
    hz: 4,
    noise: 2,
    seed: 1,
    background: 50,
    foreground: 190,
    ...options,
  };
  const rand = rng(opts.seed);
  const frames: GrayFrame[] = [];
  const holds: SyntheticVideo['holds'] = [];
  let pose = start;
  let t = 0;
  for (const seg of segments) {
    const n = Math.round(seg.seconds * opts.hz);
    if (seg.kind === 'hold') {
      holds.push({ startS: t, endS: t + seg.seconds });
      for (let i = 0; i < n; i++) {
        const dx = (seg.sway ?? 0) * Math.sin((2 * Math.PI * (i / opts.hz)) / (seg.swayPeriodS ?? 5));
        frames.push(renderPose(seg.pose, dx, opts.width, opts.height, opts, rand));
      }
      pose = seg.pose;
    } else {
      for (let i = 0; i < n; i++) {
        const k = (i + 1) / n;
        const wob = (seg.wobble ?? 1.5) * Math.sin(Math.PI * k);
        frames.push(renderPose(lerpPose(pose, seg.to, k), wob, opts.width, opts.height, opts, rand));
      }
      pose = seg.to;
    }
    t += seg.seconds;
  }
  return { frames, holds };
}

/** A few clearly distinct poses (torso + limb). */
export const POSES = {
  standing: [
    { x: 0.45, y: 0.15, w: 0.1, h: 0.75 },
    { x: 0.42, y: 0.25, w: 0.16, h: 0.08 },
  ],
  triangle: [
    { x: 0.3, y: 0.3, w: 0.4, h: 0.1 },
    { x: 0.3, y: 0.4, w: 0.06, h: 0.5 },
  ],
  forwardFold: [
    { x: 0.4, y: 0.5, w: 0.25, h: 0.12 },
    { x: 0.6, y: 0.5, w: 0.06, h: 0.4 },
  ],
  seated: [
    { x: 0.3, y: 0.75, w: 0.4, h: 0.1 },
    { x: 0.3, y: 0.45, w: 0.08, h: 0.3 },
  ],
  headstand: [
    { x: 0.47, y: 0.05, w: 0.08, h: 0.7 },
    { x: 0.42, y: 0.72, w: 0.18, h: 0.08 },
  ],
} satisfies Record<string, Pose>;
