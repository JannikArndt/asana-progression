/** Pure decisions for swipe-to-dismiss on bottom sheets (Sheet.svelte). Distances in px, time in ms. */

/** Movement before a press counts as a drag, so taps on buttons in the sheet stay taps. */
export const DRAG_SLOP = 6;
/** Released lower than this fraction of the sheet's height → dismiss. */
export const DISMISS_FRACTION = 0.3;
/** A flick at least this fast (px/ms) dismisses (down) or keeps the sheet (up), whatever the distance. */
export const FLICK_VELOCITY = 0.5;
/** Release velocity is measured over the last samples within this window. */
export const VELOCITY_WINDOW_MS = 80;
/** Dragging up past the resting position gives at most this much (rubber band). */
export const OVERDRAG_PX = 24;

/** Where the press started: grabber/header always drag; content only from its scroll top, downwards. */
export type DragZone = 'handle' | 'content';

/**
 * Whether a press that has moved by (dx, dy) drags the sheet: null = undecided (within the slop),
 * false = leave the gesture to the browser (scrolling, sliders, horizontal strips).
 */
export function startsDrag(zone: DragZone, dx: number, dy: number, scrollTop: number): boolean | null {
  if (Math.hypot(dx, dy) < DRAG_SLOP) return null;
  if (Math.abs(dy) <= Math.abs(dx)) return false;
  if (zone === 'handle') return true;
  return dy > 0 && scrollTop <= 0;
}

/** Sheet offset for a finger offset: follows downwards, resists upwards (asymptotically OVERDRAG_PX). */
export function dragOffset(dy: number): number {
  if (dy >= 0) return dy;
  return -OVERDRAG_PX * (1 - 1 / (1 + -dy / OVERDRAG_PX / 2));
}

export interface DragSample {
  t: number;
  y: number;
}

/** Velocity (px/ms, positive = down) over the samples in the last VELOCITY_WINDOW_MS. */
export function releaseVelocity(samples: DragSample[]): number {
  const last = samples[samples.length - 1];
  if (!last) return 0;
  const first = samples.find((s) => last.t - s.t <= VELOCITY_WINDOW_MS) ?? last;
  const dt = last.t - first.t;
  return dt > 0 ? (last.y - first.y) / dt : 0;
}

/** What a released drag does: a flick decides by its direction, otherwise the distance. */
export function releaseAction(dy: number, height: number, velocity: number): 'dismiss' | 'snap' {
  if (dy <= 0) return 'snap';
  if (velocity >= FLICK_VELOCITY) return 'dismiss';
  if (velocity <= -FLICK_VELOCITY) return 'snap';
  return dy >= DISMISS_FRACTION * height ? 'dismiss' : 'snap';
}

/** Duration of the dismiss animation: keeps a flick's speed, never slower than `base`. */
export function settleMs(distance: number, velocity: number, base: number): number {
  if (velocity <= 0 || distance <= 0) return base;
  return Math.round(Math.min(base, Math.max(100, distance / velocity)));
}
