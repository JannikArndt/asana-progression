/**
 * Pure geometry of the crop editor's frame (tested; no DOM). All rectangles are in stage pixels
 * unless they are called crops (normalized to the image, 0–1).
 */
import type { Box } from '../../model';

/** Frame handles: edges (n, e, s, w) and corners. */
export type Handle = 'n' | 'e' | 's' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export interface ResizeOptions {
  /** The frame never leaves this rectangle (the stage area that the image covers). */
  bounds: Box;
  /** Minimum width and height in px. */
  minSize: number;
  /** Width / height to keep, or null for a free frame. */
  aspect: number | null;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** Largest rectangle of `aspect` (width / height) centred in `area`. */
export function fitFrame(area: Box, aspect: number): Box {
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  const w = Math.max(1, Math.min(area.w, area.h * a));
  const h = w / a;
  return { x: area.x + (area.w - w) / 2, y: area.y + (area.h - h) / 2, w, h };
}

/** `box` shrunk by `m` on every side. */
export function inset(box: Box, m: number): Box {
  return { x: box.x + m, y: box.y + m, w: Math.max(1, box.w - 2 * m), h: Math.max(1, box.h - 2 * m) };
}

/** Overlap of two rectangles (zero size when they do not overlap). */
export function intersect(a: Box, b: Box): Box {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return { x, y, w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x), h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y) };
}

/** Where the image (natural size imgW × imgH) is drawn at scale s with its top-left at (tx, ty). */
export function imageRect(view: { s: number; tx: number; ty: number }, imgW: number, imgH: number): Box {
  return { x: view.tx, y: view.ty, w: imgW * view.s, h: imgH * view.s };
}

/** Pixel aspect (width / height) of a normalized crop of an imgW × imgH image. */
export function cropAspect(crop: Box, imgW: number, imgH: number): number {
  return (Math.max(1e-6, crop.w) * imgW) / (Math.max(1e-6, crop.h) * imgH);
}

/**
 * The crop with pixel aspect `aspect` around the same centre and with the same area as `crop`,
 * shrunk and shifted to stay inside the image (switching an aspect preset).
 */
export function cropWithAspect(crop: Box, aspect: number, imgW: number, imgH: number): Box {
  const area = crop.w * imgW * crop.h * imgH;
  let w = Math.sqrt(area * aspect);
  let h = w / aspect;
  const k = Math.min(1, imgW / w, imgH / h);
  w = (w * k) / imgW;
  h = (h * k) / imgH;
  const cx = crop.x + crop.w / 2;
  const cy = crop.y + crop.h / 2;
  return { x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h), w, h };
}

/**
 * The frame after dragging `handle` by (dx, dy) from `start`. A free frame moves only the dragged
 * edges; with an aspect, corners scale about the opposite corner (pointer projected onto the
 * diagonal) and edges about the middle of the opposite edge. The result stays inside `bounds` and
 * at least `minSize` (unless the bounds are smaller).
 */
export function resizeFrame(start: Box, handle: Handle, dx: number, dy: number, opts: ResizeOptions): Box {
  const { bounds: b, aspect } = opts;
  const min = Math.max(1, Math.min(opts.minSize, b.w, b.h));
  const right = start.x + start.w;
  const bottom = start.y + start.h;
  const bRight = b.x + b.w;
  const bBottom = b.y + b.h;
  const east = handle.includes('e');
  const west = handle.includes('w');
  const south = handle.includes('s');
  const north = handle.includes('n');

  if (aspect === null) {
    const l = west ? clamp(start.x + dx, b.x, right - min) : start.x;
    const r = east ? clamp(right + dx, start.x + min, bRight) : right;
    const t = north ? clamp(start.y + dy, b.y, bottom - min) : start.y;
    const btm = south ? clamp(bottom + dy, start.y + min, bBottom) : bottom;
    return { x: l, y: t, w: r - l, h: btm - t };
  }

  const wMin = Math.max(min, min * aspect);
  if ((east || west) && (north || south)) {
    // Corner: scale about the opposite corner.
    const ax = east ? start.x : right;
    const ay = south ? start.y : bottom;
    const sx = east ? 1 : -1;
    const sy = south ? 1 : -1;
    const px = (east ? right : start.x) + dx - ax;
    const py = (south ? bottom : start.y) + dy - ay;
    const t = (px * sx * start.w + py * sy * start.h) / (start.w * start.w + start.h * start.h);
    const availW = east ? bRight - ax : ax - b.x;
    const availH = south ? bBottom - ay : ay - b.y;
    const w = clamp(t * start.w, wMin, Math.min(availW, availH * aspect));
    const h = w / aspect;
    return { x: east ? ax : ax - w, y: south ? ay : ay - h, w, h };
  }
  if (east || west) {
    // Side edge: the opposite edge stays, the height follows about the vertical centre.
    const ax = east ? start.x : right;
    const cy = start.y + start.h / 2;
    const availW = east ? bRight - ax : ax - b.x;
    const availH = 2 * Math.min(cy - b.y, bBottom - cy);
    const w = clamp(start.w + (east ? dx : -dx), wMin, Math.min(availW, availH * aspect));
    const h = w / aspect;
    return { x: east ? ax : ax - w, y: cy - h / 2, w, h };
  }
  // Top or bottom edge: the width follows about the horizontal centre.
  const ay = south ? start.y : bottom;
  const cx = start.x + start.w / 2;
  const availH = south ? bBottom - ay : ay - b.y;
  const availW = 2 * Math.min(cx - b.x, bRight - cx);
  const h = clamp(start.h + (south ? dy : -dy), wMin / aspect, Math.min(availH, availW / aspect));
  const w = h * aspect;
  return { x: cx - w / 2, y: south ? ay : ay - h, w, h };
}
