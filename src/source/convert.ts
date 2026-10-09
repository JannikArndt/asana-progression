import { drawRotated } from './gray';
import { rgbaToGray } from './gray';
import type { Rotation } from './types';

/**
 * Frame → small grayscale image. Two implementations:
 *  - 'canvas': draw the VideoFrame into a canvas (two-step downscale), read back RGBA, convert to luma
 *  - 'luma':   VideoFrame.copyTo() the planar YUV data and box-filter the Y plane in JS
 * Which one is faster depends on the engine; the sampler benchmarks both on the first frame and
 * keeps the winner for the whole video (mixing them would shift gray levels).
 */
export type GrayMethod = 'canvas' | 'luma';

export interface GrayConverter {
  readonly method: GrayMethod;
  convert(frame: VideoFrame): Promise<Uint8Array>;
}

/** Planar/semi-planar formats whose first plane is luma. */
const LUMA_8 = new Set(['I420', 'I420A', 'I422', 'I444', 'NV12']);
const LUMA_16 = new Set(['I420P10', 'I420AP10', 'I422P10', 'I444P10', 'I420P12', 'I422P12', 'I444P12']);

export function lumaBits(format: string | null): 8 | 16 | null {
  if (!format) return null;
  if (LUMA_8.has(format)) return 8;
  if (LUMA_16.has(format)) return 16;
  return null;
}

/**
 * Box-filter downscale of a luma plane (8-bit, or 16-bit with `shift` to 8-bit). Each output pixel
 * averages up to 12 × 12 taps of its source block; tap positions are jittered by a fixed hash inside
 * their cell so periodic textures (stripes, grids) don't alias onto one phase. Positions are the
 * same for every frame, so static texture yields constant values.
 */
export function downsampleLuma(
  src: Uint8Array | Uint16Array,
  offset: number,
  stride: number,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  shift = 0,
): Uint8Array {
  const out = new Uint8Array(dstW * dstH);
  const block = Math.min(srcW / dstW, srcH / dstH);
  const step = Math.max(1, Math.floor(block / 12));
  const xTaps = tapsPerCell(srcW, dstW, step, 0x9e37);
  const yTaps = tapsPerCell(srcH, dstH, step, 0x7f4a);
  const scale = 1 / (1 << shift);
  for (let oy = 0; oy < dstH; oy++) {
    const ys = yTaps[oy]!;
    for (let ox = 0; ox < dstW; ox++) {
      const xs = xTaps[ox]!;
      let s = 0;
      for (let j = 0; j < ys.length; j++) {
        const row = offset + ys[j]! * stride;
        for (let i = 0; i < xs.length; i++) s += src[row + xs[i]!]!;
      }
      out[oy * dstW + ox] = Math.min(255, Math.round((s / (xs.length * ys.length)) * scale));
    }
  }
  return out;
}

/** Source positions sampled for each output cell: one per `step`-wide sub-cell, at a hashed offset. */
function tapsPerCell(srcLen: number, dstLen: number, step: number, seed: number): Int32Array[] {
  const out: Int32Array[] = [];
  for (let o = 0; o < dstLen; o++) {
    const a = Math.min(srcLen - 1, Math.floor((o * srcLen) / dstLen));
    const b = Math.max(a + 1, Math.min(srcLen, Math.floor(((o + 1) * srcLen) / dstLen)));
    const taps: number[] = [];
    for (let x = a; x < b; x += step) {
      const h = Math.imul(x ^ seed, 0x45d9f3b) >>> 0;
      taps.push(Math.min(b - 1, x + ((h >>> 8) % step)));
    }
    out.push(Int32Array.from(taps));
  }
  return out;
}

/** Rotates a gray image clockwise by 0/90/180/270 degrees. */
export function rotateGray(src: Uint8Array, w: number, h: number, rotation: Rotation): { data: Uint8Array; width: number; height: number } {
  if (rotation === 0) return { data: src, width: w, height: h };
  const out = new Uint8Array(w * h);
  if (rotation === 180) {
    for (let i = 0; i < w * h; i++) out[w * h - 1 - i] = src[i]!;
    return { data: out, width: w, height: h };
  }
  // 90: (x, y) → (h-1-y, x) in a h×w image; 270: (x, y) → (y, w-1-x)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = src[y * w + x]!;
      if (rotation === 90) out[x * h + (h - 1 - y)] = v;
      else out[(w - 1 - x) * h + y] = v;
    }
  }
  return { data: out, width: h, height: w };
}

/** Converter that reads the Y plane via VideoFrame.copyTo (engines exposing NV12/I420). */
export function lumaConverter(rotation: Rotation, target: { width: number; height: number }): GrayConverter {
  const unrotated = rotation === 90 || rotation === 270 ? { width: target.height, height: target.width } : target;
  let buf: Uint8Array | null = null;
  return {
    method: 'luma',
    async convert(frame) {
      const bits = lumaBits(frame.format as string | null);
      if (!bits) throw new Error(`pixel format ${frame.format ?? 'opaque'} has no readable luma plane`);
      const size = frame.allocationSize();
      if (!buf || buf.byteLength < size) buf = new Uint8Array(size);
      const layout = await frame.copyTo(buf);
      const y = layout[0];
      if (!y) throw new Error('no luma plane');
      const w = frame.visibleRect?.width ?? frame.codedWidth;
      const h = frame.visibleRect?.height ?? frame.codedHeight;
      const small =
        bits === 8
          ? downsampleLuma(buf, y.offset, y.stride, w, h, unrotated.width, unrotated.height)
          : downsampleLuma(new Uint16Array(buf.buffer, buf.byteOffset, buf.byteLength >> 1), y.offset >> 1, y.stride >> 1, w, h, unrotated.width, unrotated.height, frame.format?.endsWith('12') ? 4 : 2);
      return rotateGray(small, unrotated.width, unrotated.height, rotation).data;
    },
  };
}

function context2d(canvas: OffscreenCanvas, readback: boolean): OffscreenCanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: readback });
  if (!ctx) throw new Error('OffscreenCanvas 2D is not available');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return ctx;
}

/** Converter that draws into a canvas (two-step downscale to limit aliasing) and reads back RGBA. */
export function canvasConverter(
  rotation: Rotation,
  mid: { width: number; height: number },
  target: { width: number; height: number },
): GrayConverter {
  const midCanvas = new OffscreenCanvas(mid.width, mid.height);
  const midCtx = context2d(midCanvas, false);
  const outCanvas = new OffscreenCanvas(target.width, target.height);
  const outCtx = context2d(outCanvas, true);
  return {
    method: 'canvas',
    async convert(frame) {
      drawRotated(midCtx, frame, rotation, mid.width, mid.height);
      outCtx.drawImage(midCanvas, 0, 0, target.width, target.height);
      return rgbaToGray(outCtx.getImageData(0, 0, target.width, target.height).data);
    },
  };
}

/** Median runtime (ms) of `runs` conversions of the same frame. */
export async function timeConverter(c: GrayConverter, frame: VideoFrame, runs = 3): Promise<number> {
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    await c.convert(frame);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)]!;
}
