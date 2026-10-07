import type { Rotation } from './types';

/** RGBA → 8-bit luma (BT.601 weights, integer arithmetic). */
export function rgbaToGray(rgba: Uint8ClampedArray | Uint8Array, out?: Uint8Array): Uint8Array {
  const n = rgba.length >> 2;
  const g = out ?? new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    g[i] = (77 * rgba[j]! + 150 * rgba[j + 1]! + 29 * rgba[j + 2]! + 128) >> 8;
  }
  return g;
}

/** Target size for a frame whose displayed (rotated) size is dw × dh, scaled to `longSide`. */
export function targetSize(dw: number, dh: number, longSide: number): { width: number; height: number } {
  const s = longSide / Math.max(dw, dh, 1);
  return { width: Math.max(1, Math.round(dw * s)), height: Math.max(1, Math.round(dh * s)) };
}

/** Display size after rotation. */
export function rotatedSize(w: number, h: number, rotation: Rotation): { width: number; height: number } {
  return rotation === 90 || rotation === 270 ? { width: h, height: w } : { width: w, height: h };
}

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Draws `image` rotated clockwise by `rotation` into a target of tw × th (already rotated size).
 */
export function drawRotated(ctx: Ctx2D, image: CanvasImageSource, rotation: Rotation, tw: number, th: number): void {
  ctx.save();
  switch (rotation) {
    case 90:
      ctx.translate(tw, 0);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(image, 0, 0, th, tw);
      break;
    case 180:
      ctx.translate(tw, th);
      ctx.rotate(Math.PI);
      ctx.drawImage(image, 0, 0, tw, th);
      break;
    case 270:
      ctx.translate(0, th);
      ctx.rotate(-Math.PI / 2);
      ctx.drawImage(image, 0, 0, th, tw);
      break;
    default:
      ctx.drawImage(image, 0, 0, tw, th);
  }
  ctx.restore();
}
