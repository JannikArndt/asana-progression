import type { VideoSource } from '../source/types';
import { ClipStrategy } from './clip';
import { StillStrategy } from './still';
import type { CaptureOptions, HoldSpan, StillCapture } from './types';

/** Captures still + thumbnail, then the clip. The caller closes `preview`. */
export async function captureHold(hold: HoldSpan, source: VideoSource, opts: CaptureOptions): Promise<StillCapture> {
  const still = await new StillStrategy().captureWithPreview(hold, source, opts);
  try {
    const clip = await new ClipStrategy().capture(hold, source, opts);
    return { assets: [...still.assets, ...clip], preview: still.preview };
  } catch (e) {
    still.preview?.close();
    throw e;
  }
}
