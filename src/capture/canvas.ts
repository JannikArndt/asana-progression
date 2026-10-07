import { halvingSteps, type Size } from './sizes';

export interface Canvas2D {
  canvas: OffscreenCanvas;
  ctx: OffscreenCanvasRenderingContext2D;
}

export function canvas2d(width: number, height: number): Canvas2D {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2D is not available');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { canvas, ctx };
}

/** Frees canvas memory right away (iOS limits the total canvas memory per page). */
export function release(...canvases: OffscreenCanvas[]): void {
  for (const c of canvases) {
    c.width = 0;
    c.height = 0;
  }
}

/** Downscales `src` to `to` in halving steps (limits aliasing on large reductions). */
export function downscale(src: OffscreenCanvas, to: Size): OffscreenCanvas {
  let cur = src;
  for (const step of [...halvingSteps(src, to), to]) {
    const next = canvas2d(step.width, step.height);
    next.ctx.drawImage(cur, 0, 0, step.width, step.height);
    if (cur !== src) release(cur);
    cur = next.canvas;
  }
  return cur;
}
