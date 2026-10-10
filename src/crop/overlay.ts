/**
 * Pose overlay geometry (pure): BlazePose landmarks of a still → skeleton lines, dots and the body
 * box in the pixel space of a view that shows a crop of the still.
 */
import type { Box } from '../model/types';
import type { Landmark } from './types';

/** BlazePose skeleton (pairs of landmark indices), as drawn by MediaPipe's POSE_CONNECTIONS. */
export const BLAZEPOSE_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  // face
  [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8], [9, 10],
  // torso
  [11, 12], [11, 23], [12, 24], [23, 24],
  // arms and hands
  [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
  // legs and feet
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31],
  [24, 26], [26, 28], [28, 30], [30, 32], [28, 32],
];

/** Landmarks below this visibility are drawn dimmed. */
export const OVERLAY_MIN_VISIBILITY = 0.3;

export interface OverlayPoint {
  x: number;
  y: number;
  /** Visibility below the threshold (or not finite): draw dimmed. */
  dim: boolean;
}

export interface OverlayLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  dim: boolean;
}

export interface PoseOverlay {
  points: OverlayPoint[];
  lines: OverlayLine[];
  /** Body box in view pixels. */
  box: Box | null;
}

/** A normalized image point → pixels of a `width × height` view showing `crop` (null = full frame). */
export function toView(p: { x: number; y: number }, crop: Box | null, width: number, height: number): { x: number; y: number } {
  const c = crop ?? { x: 0, y: 0, w: 1, h: 1 };
  return { x: ((p.x - c.x) / Math.max(1e-6, c.w)) * width, y: ((p.y - c.y) / Math.max(1e-6, c.h)) * height };
}

/** A normalized image box → pixels of the view (see toView). */
export function boxToView(b: Box, crop: Box | null, width: number, height: number): Box {
  const a = toView(b, crop, width, height);
  const z = toView({ x: b.x + b.w, y: b.y + b.h }, crop, width, height);
  return { x: a.x, y: a.y, w: z.x - a.x, h: z.y - a.y };
}

function dim(l: Landmark, minVisibility: number): boolean {
  return l.visibility !== undefined && !(l.visibility >= minVisibility);
}

/**
 * Overlay of a detection in a view that shows `crop` of the still at `width × height` px.
 * Points outside the crop keep their coordinates (the view clips them); landmarks that are not
 * finite are left out with their lines.
 */
export function poseOverlay(d: { landmarks: Landmark[]; box: Box | null }, crop: Box | null, width: number, height: number, minVisibility = OVERLAY_MIN_VISIBILITY): PoseOverlay {
  const mapped = d.landmarks.map((l) => (Number.isFinite(l.x) && Number.isFinite(l.y) ? { ...toView(l, crop, width, height), dim: dim(l, minVisibility) } : null));
  const lines: OverlayLine[] = [];
  for (const [i, j] of BLAZEPOSE_CONNECTIONS) {
    const a = mapped[i];
    const b = mapped[j];
    if (a && b) lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, dim: a.dim || b.dim });
  }
  return {
    points: mapped.filter((p): p is OverlayPoint => !!p),
    lines,
    box: d.box ? boxToView(d.box, crop, width, height) : null,
  };
}
