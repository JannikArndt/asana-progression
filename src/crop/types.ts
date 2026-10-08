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
}

export type CropperInput = ImageBitmap | OffscreenCanvas | ImageData;

export interface Cropper {
  readonly name: string;
  detect(image: CropperInput): Promise<PoseDetection | null>;
  close(): void;
}

/** A 2D landmark in normalized image coordinates (y grows downwards). */
export interface Landmark {
  x: number;
  y: number;
  visibility?: number;
}
