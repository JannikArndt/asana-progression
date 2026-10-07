import type { ClipQuality } from './types';

export interface Size {
  width: number;
  height: number;
}

const SHORT_SIDE: Record<Exclude<ClipQuality, 'original'>, number> = { '720p': 720, '1080p': 1080 };

function checkSize(w: number, h: number): void {
  if (!(w > 0 && h > 0 && Number.isFinite(w) && Number.isFinite(h))) throw new RangeError(`Invalid frame size ${w}×${h}`);
}

/** Nearest even number ≥ 2 that does not exceed `max` (rounded down to even). */
function even(n: number, max: number): number {
  return Math.max(2, Math.min(Math.round(n / 2) * 2, Math.floor(max / 2) * 2));
}

/**
 * Encoded clip size for a displayed (rotated) frame of w × h: the short side becomes 720 or 1080,
 * the aspect ratio is kept, both sides are even and the source is never upscaled.
 */
export function clipSize(displayW: number, displayH: number, quality: ClipQuality): Size {
  checkSize(displayW, displayH);
  const target = quality === 'original' ? Infinity : SHORT_SIDE[quality];
  const s = Math.min(1, target / Math.min(displayW, displayH));
  return { width: even(displayW * s, displayW), height: even(displayH * s, displayH) };
}

/** Thumbnail size: long side `longSide`, aspect kept, never upscaled, at least 1 px. */
export function thumbSize(w: number, h: number, longSide = 512): Size {
  checkSize(w, h);
  const s = Math.min(1, longSide / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

/**
 * Intermediate sizes for downscaling `from` to `to` in halving steps, so that the final step
 * reduces by at most 2× (one large reduction aliases). Excludes `from` and `to`.
 */
export function halvingSteps(from: Size, to: Size): Size[] {
  const steps: Size[] = [];
  const minW = Math.max(1, to.width);
  const minH = Math.max(1, to.height);
  let { width, height } = from;
  for (;;) {
    width = Math.ceil(width / 2);
    height = Math.ceil(height / 2);
    if (width <= minW || height <= minH) return steps;
    steps.push({ width, height });
  }
}

export interface TimedPacket {
  timestampS: number;
  durationS: number;
}

export interface Rebase {
  /** Subtract from every presentation timestamp so the clip starts at 0. */
  offsetS: number;
  /** Source range covered by the packets: [startS, endS). */
  startS: number;
  endS: number;
}

/** Offset and covered range for stream-copied packets (any order). Null if there are none. */
export function rebaseTimestamps(packets: readonly TimedPacket[]): Rebase | null {
  if (packets.length === 0) return null;
  let startS = Infinity;
  let endS = -Infinity;
  for (const p of packets) {
    startS = Math.min(startS, p.timestampS);
    endS = Math.max(endS, p.timestampS + Math.max(0, p.durationS));
  }
  return { offsetS: startS, startS, endS };
}
