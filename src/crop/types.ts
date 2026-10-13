/**
 * Public contract of the crop module: finds the body in a still. Crops are display metadata only;
 * stored assets are never cropped.
 */
import type { Box, PostureClass } from '../model/types';

/** Normalized (0–1) body box with a confidence score. */
export interface BodyBox extends Box {
  score: number;
}

export interface PoseDetection {
  box: BodyBox;
  /** Coarse posture from the landmarks (feeds label suggestions), null if unclear. */
  posture: PostureClass | null;
  /** The 33 BlazePose landmarks the box and posture came from (display only; not stored). */
  landmarks: Landmark[];
  /** The same 33 landmarks in metres, origin between the hips (research export only). */
  worldLandmarks?: Landmark[];
}

export type CropperInput = ImageBitmap | OffscreenCanvas | ImageData;

export interface Cropper {
  readonly name: string;
  detect(image: CropperInput): Promise<PoseDetection | null>;
  close(): void;
}

/**
 * A landmark in normalized image coordinates (y grows downwards; z = depth relative to the hips, in
 * about the scale of x), or in metres for world landmarks.
 */
export interface Landmark {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}
