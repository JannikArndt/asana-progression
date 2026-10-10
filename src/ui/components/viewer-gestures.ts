/** Gesture decisions of the hold viewer (pure, tested): swipe between holds, swipe down to close, tap. */

export type Axis = 'x' | 'y';

/** Movement (px) before a drag picks its axis; below it a release is a tap. */
export const GESTURE_SLOP = 10;

/** The drag's axis once it moved `slop` px: the dominant one (ties go to x, the swipe between holds). */
export function gestureAxis(dx: number, dy: number, slop = GESTURE_SLOP): Axis | null {
  if (Math.hypot(dx, dy) < slop) return null;
  return Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
}

/** A short press that hardly moved. */
export function isTap(moved: number, durationMs: number, slop = GESTURE_SLOP): boolean {
  return moved < slop && durationMs < 350;
}

/** Vertical offset while dragging: follows the finger down, resists upwards. */
export function dismissOffset(dy: number): number {
  return dy >= 0 ? dy : dy / 4;
}

/** 0 → 1 as the image is pulled down (fades the backdrop). */
export function dismissProgress(dy: number, height: number): number {
  return height > 0 ? Math.min(1, Math.max(0, dy / (height * 0.5))) : 0;
}

/**
 * Close after a vertical drag: pulled down past `fraction` of the stage height, or flicked down
 * (velocity in px/ms) a little way. Otherwise it snaps back.
 */
export function shouldDismiss(dy: number, vy: number, height: number, fraction = 0.2, flick = 0.5): boolean {
  if (dy <= 0) return false;
  return dy > height * fraction || (vy > flick && dy > 2 * GESTURE_SLOP);
}
