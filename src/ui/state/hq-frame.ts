import { drawRotated, rotatedSize } from '../../source';
import { app } from './app.svelte';

let chain: Promise<unknown> = Promise.resolve();

/**
 * The exact video frame at `t` as a canvas (long side at most `longSide` px), decoded from the file
 * picked in this page session; null without the file or when no frame is there. Requests run one
 * after another (one decoder per source); `wanted` is asked again right before decoding, so a
 * request superseded while it waited (the slider moved on) costs nothing.
 */
export function hqFrame(videoId: string, t: number, longSide = 1600, wanted: () => boolean = () => true): Promise<HTMLCanvasElement | null> {
  const run = async (): Promise<HTMLCanvasElement | null> => {
    if (!wanted()) return null;
    const src = app.source(videoId);
    if (!src) return null;
    const ef = await (await src).frameAt(t);
    if (!ef) return null;
    try {
      const r = rotatedSize(ef.frame.displayWidth, ef.frame.displayHeight, ef.rotation);
      const k = Math.min(1, longSide / Math.max(r.width, r.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(r.width * k);
      canvas.height = Math.round(r.height * k);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      drawRotated(ctx, ef.frame, ef.rotation, canvas.width, canvas.height);
      return canvas;
    } finally {
      ef.frame.close();
    }
  };
  const p = chain.then(run, run);
  chain = p.catch(() => undefined);
  return p;
}
