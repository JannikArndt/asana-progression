import type { ClipQuality, HoldSpan } from '../../capture';
import type { BodyBox, PoseDetection } from '../../crop';
import type { Asset, CompactPose, PostureClass } from '../../model';

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
  | {
      /** Poses of exact frames (review candidates' best frames), by key; runs beside a capture. */
      type: 'frame-poses';
      jobId: number;
      file: File;
      videoId: string;
      frames: Array<{ key: string; atS: number }>;
      cropper: 'mediapipe' | 'none';
      baseUrl: string;
    }
  | {
      /** Pose landmarks of one stored still, for the overlay in the hold viewer (runs beside a capture). */
      type: 'pose';
      jobId: number;
      stillKey: string;
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
      /** Compact pose of the still (null: no body found; undefined: no pose model). */
      pose?: CompactPose | null;
      /** Name of the cropper that ran ("mediapipe-pose" or "none"). */
      cropper: string;
    }
  | { type: 'recrop-done'; jobId: number; holdId: string; crop: BodyBox | null; pose?: CompactPose | null; cropper: string }
  | { type: 'frame-pose'; jobId: number; videoId: string; key: string; pose: CompactPose | null }
  | { type: 'frame-poses-done'; jobId: number; videoId: string; message?: string }
  | { type: 'hold-error'; jobId: number; holdId: string; message: string }
  | { type: 'pose-done'; jobId: number; detection: PoseDetection | null; cropper: string; message?: string }
  | { type: 'done'; jobId: number; cropper: string }
  | { type: 'error'; jobId: number; message: string };
