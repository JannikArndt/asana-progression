/**
 * Public contract of the capture module: turns a hold's time span into image/video assets using
 * a VideoSource. It does not know about the UI or how assets are stored.
 */
import type { VideoSource } from '../source/types';

export type ClipQuality = '720p' | '1080p' | 'original';

/** What a capture needs from a hold (times in seconds of the source video). */
export interface HoldSpan {
  id: string;
  bestS: number;
  clipStartS: number;
  clipEndS: number;
}

export interface CapturedAsset {
  kind: 'still' | 'thumb' | 'clip';
  mime: string;
  width: number;
  height: number;
  blob: Blob;
  /** Still/thumb: the frame time actually captured. */
  atS?: number;
  /** Clip: the range actually captured (snapped to key frames for 'original'). */
  startS?: number;
  endS?: number;
  /** Clip: the quality that was produced (may fall back to 'original' if encoding is unsupported). */
  quality?: ClipQuality;
}

export interface CaptureOptions {
  clipQuality: ClipQuality;
  /** JPEG quality of the full-resolution still (default 0.9). */
  stillQuality?: number;
  /** Long side of the thumbnail in pixels (default 512). */
  thumbLongSide?: number;
  signal?: AbortSignal;
}

/** Result of a still capture, plus a small bitmap for analysis (pose/crop). Caller closes `preview`. */
export interface StillCapture {
  assets: CapturedAsset[];
  preview: ImageBitmap | null;
}

export interface CaptureStrategy {
  readonly kind: 'still' | 'clip';
  capture(hold: HoldSpan, source: VideoSource, opts: CaptureOptions): Promise<CapturedAsset[]>;
}
