import { drawRotated, rotatedSize } from '../source';
import type { VideoSource } from '../source/types';
import { canvas2d, downscale, release } from './canvas';
import { thumbSize } from './sizes';
import type { CaptureOptions, CaptureStrategy, CapturedAsset, HoldSpan, StillCapture } from './types';

const JPEG = 'image/jpeg';
const STILL_QUALITY = 0.9;
const THUMB_QUALITY = 0.85;
const THUMB_LONG_SIDE = 512;
const PREVIEW_LONG_SIDE = 640;

/** Small bitmap (long side ≤ 640, like the capture preview) of a stored still, for pose detection again. */
export async function previewFromStill(still: Blob): Promise<ImageBitmap> {
  const full = await createImageBitmap(still);
  const c = canvas2d(full.width, full.height);
  c.ctx.drawImage(full, 0, 0);
  full.close();
  const preview = downscale(c.canvas, thumbSize(c.canvas.width, c.canvas.height, PREVIEW_LONG_SIDE));
  try {
    return await createImageBitmap(preview);
  } finally {
    release(c.canvas, preview);
  }
}

/** Full-resolution JPEG of the hold's best frame (display orientation) plus a thumbnail. */
export class StillStrategy implements CaptureStrategy {
  readonly kind = 'still' as const;

  async capture(hold: HoldSpan, source: VideoSource, opts: CaptureOptions): Promise<CapturedAsset[]> {
    return (await this.render(hold, source, opts, false)).assets;
  }

  /** Like capture(), plus a small bitmap (long side ≤ 640) for pose detection. Caller closes it. */
  captureWithPreview(hold: HoldSpan, source: VideoSource, opts: CaptureOptions): Promise<StillCapture> {
    return this.render(hold, source, opts, true);
  }

  private async render(hold: HoldSpan, source: VideoSource, opts: CaptureOptions, withPreview: boolean): Promise<StillCapture> {
    opts.signal?.throwIfAborted();
    const exact = await source.frameAt(hold.bestS);
    if (!exact) throw new Error(`No video frame at ${hold.bestS.toFixed(2)} s`);
    let full: OffscreenCanvas;
    try {
      const size = rotatedSize(exact.frame.displayWidth, exact.frame.displayHeight, exact.rotation);
      const c = canvas2d(size.width, size.height);
      drawRotated(c.ctx, exact.frame, exact.rotation, size.width, size.height);
      full = c.canvas;
    } finally {
      exact.frame.close();
    }
    const canvases = [full];
    try {
      const thumb = downscale(full, thumbSize(full.width, full.height, opts.thumbLongSide ?? THUMB_LONG_SIDE));
      canvases.push(thumb);
      opts.signal?.throwIfAborted();
      const [still, small] = await Promise.all([
        full.convertToBlob({ type: JPEG, quality: opts.stillQuality ?? STILL_QUALITY }),
        thumb.convertToBlob({ type: JPEG, quality: THUMB_QUALITY }),
      ]);
      const atS = exact.timestampS;
      const assets: CapturedAsset[] = [
        { kind: 'still', mime: still.type || JPEG, width: full.width, height: full.height, blob: still, atS },
        { kind: 'thumb', mime: small.type || JPEG, width: thumb.width, height: thumb.height, blob: small, atS },
      ];
      if (!withPreview) return { assets, preview: null };
      const preview = downscale(full, thumbSize(full.width, full.height, PREVIEW_LONG_SIDE));
      canvases.push(preview);
      return { assets, preview: await createImageBitmap(preview) };
    } finally {
      release(...canvases);
    }
  }
}
