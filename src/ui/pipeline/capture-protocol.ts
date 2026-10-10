import type { ClipQuality, HoldSpan } from '../../capture';
import type { BodyBox } from '../../crop';
import type { Asset, PostureClass } from '../../model';

export type CaptureRequest =
  | {
      type: 'capture';
      jobId: number;
      file: File;
      videoId: string;
      holds: Array<HoldSpan & { still: boolean; clip: boolean }>;
      quality: ClipQuality;
      cropper: 'mediapipe' | 'none';
      baseUrl: string;
    }
  | {
      /** Pose detection again on stored stills (no video file needed). */
      type: 'recrop';
      jobId: number;
      holds: Array<{ id: string; stillKey: string }>;
      cropper: 'mediapipe' | 'none';
      baseUrl: string;
    }
  | { type: 'cancel' };

export type CaptureEvent =
  | { type: 'hold-start'; jobId: number; holdId: string }
  | {
      type: 'hold-done';
      jobId: number;
      holdId: string;
      /** Asset records whose files are already written to the asset store. */
      assets: Asset[];
      crop: BodyBox | null;
      posture: PostureClass | null;
      /** Name of the cropper that ran ("mediapipe-pose" or "none"). */
      cropper: string;
    }
  | { type: 'recrop-done'; jobId: number; holdId: string; crop: BodyBox | null; cropper: string }
  | { type: 'hold-error'; jobId: number; holdId: string; message: string }
  | { type: 'done'; jobId: number; cropper: string }
  | { type: 'error'; jobId: number; message: string };
