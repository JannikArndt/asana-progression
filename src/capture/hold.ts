import type { VideoSource } from '../source/types';
import { ClipStrategy } from './clip';
import { StillStrategy } from './still';
import type { CaptureOptions, HoldSpan, StillCapture } from './types';

/**
 * Captures still + thumbnail, then the clip (`clip: false` skips it). A failing clip never costs
 * the still: its error is returned as `clipError`. The caller closes `preview`.
 */
export async function captureHold(hold: HoldSpan, source: VideoSource, opts: CaptureOptions & { clip?: boolean }): Promise<StillCapture & { clipError?: string }> {
  const still = await new StillStrategy().captureWithPreview(hold, source, opts);
  if (opts.clip === false) return still;
  try {
    const clip = await new ClipStrategy().capture(hold, source, opts);
    return { assets: [...still.assets, ...clip], preview: still.preview };
  } catch (e) {
    if (opts.signal?.aborted) {
      still.preview?.close();
      throw e;
    }
    return { ...still, clipError: e instanceof Error ? e.message : String(e) };
  }
}
