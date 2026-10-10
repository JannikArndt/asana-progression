/** Pure decisions for the capture queue (tested; no I/O). */
import type { Asset, Box, Hold } from '../../model';

const TIME_EPS = 0.02;

/** Does this hold need (re-)capturing, given its current assets? */
export function needsCapture(hold: Hold, assets: Asset[]): { still: boolean; clip: boolean } {
  const mine = assets.filter((a) => a.holdId === hold.id);
  const still = mine.find((a) => a.kind === 'still');
  const thumb = mine.find((a) => a.kind === 'thumb');
  const clip = mine.find((a) => a.kind === 'clip');
  const stillStale = !still || !thumb || still.atS === undefined || Math.abs(still.atS - hold.bestS) > TIME_EPS * 10;
  const clipStale =
    !clip ||
    clip.startS === undefined ||
    clip.endS === undefined ||
    clip.startS > hold.clipStartS + TIME_EPS ||
    clip.endS < hold.clipEndS - TIME_EPS ||
    // a stream copy snaps to key frames and may be longer; a much longer clip means the window moved
    clip.endS - clip.startS > hold.clipEndS - hold.clipStartS + 10;
  return { still: stillStale, clip: clipStale };
}

/**
 * Still to crop again: the hold's automatic crop was made by an older crop version (or none ran)
 * and it has a still. Manual crops are kept anyway; the automatic one is still updated.
 */
export function recropStill(hold: Hold, assets: Asset[], version: number): Asset | null {
  if (hold.crop.autoVersion === version) return null;
  return assets.find((a) => a.holdId === hold.id && a.kind === 'still') ?? null;
}

/** Crop after pose detection: the new box (or the old one if none was found) tagged with `version`. */
export function withAutoCrop(crop: Hold['crop'], box: Box | null, version: number | null): Hold['crop'] {
  const { auto, autoVersion: _, ...rest } = crop;
  const next = box ? { x: box.x, y: box.y, w: box.w, h: box.h } : auto;
  return { ...rest, ...(next ? { auto: next } : {}), ...(version !== null ? { autoVersion: version } : {}) };
}

/** Assets of a hold that a fresh capture replaces (same kinds as the new ones). */
export function replacedAssets(holdId: string, existing: Asset[], newKinds: Asset['kind'][]): Asset[] {
  return existing.filter((a) => a.holdId === holdId && newKinds.includes(a.kind));
}

/** The crop to display: manual override, else automatic, else none (full frame). */
export function effectiveCrop(hold: Pick<Hold, 'crop'>): Box | null {
  return hold.crop.manual ?? hold.crop.auto ?? null;
}

/**
 * CSS geometry to show `box` (normalized) of an image of `imgW × imgH` px inside a container:
 * the container gets `aspectRatio`, the image is absolutely positioned with the percentages.
 */
export function cropGeometry(box: Box | null, imgW: number, imgH: number): { aspectRatio: number; width: number; left: number; top: number } {
  const b = box ?? { x: 0, y: 0, w: 1, h: 1 };
  const w = Math.max(1e-3, b.w);
  const h = Math.max(1e-3, b.h);
  return {
    aspectRatio: (w * imgW) / (h * imgH),
    width: 100 / w,
    left: (-b.x / w) * 100,
    top: (-b.y / h) * 100,
  };
}

/** Clamps a crop box into the image (minimum 2 % per side). */
export function normalizeCrop(box: Box): Box {
  const w = Math.min(1, Math.max(0.02, box.w));
  const h = Math.min(1, Math.max(0.02, box.h));
  const x = Math.min(1 - w, Math.max(0, box.x));
  const y = Math.min(1 - h, Math.max(0, box.y));
  return { x, y, w, h };
}

export const FULL_FRAME: Box = { x: 0, y: 0, w: 1, h: 1 };

/**
 * Crop box (normalized) visible through a frame rectangle when the image (natural size imgW×imgH)
 * is drawn at scale `s` with its top-left corner at (tx, ty) — all in viewport pixels.
 */
export function cropFromView(frame: Box, view: { s: number; tx: number; ty: number }, imgW: number, imgH: number): Box {
  return normalizeCrop({
    x: (frame.x - view.tx) / (imgW * view.s),
    y: (frame.y - view.ty) / (imgH * view.s),
    w: frame.w / (imgW * view.s),
    h: frame.h / (imgH * view.s),
  });
}

/** Inverse of cropFromView: the view that shows `crop` exactly inside `frame` (aspect of the frame wins). */
export function viewForCrop(frame: Box, crop: Box, imgW: number, imgH: number): { s: number; tx: number; ty: number } {
  const s = Math.min(frame.w / (crop.w * imgW), frame.h / (crop.h * imgH));
  const cx = (crop.x + crop.w / 2) * imgW * s;
  const cy = (crop.y + crop.h / 2) * imgH * s;
  return { s, tx: frame.x + frame.w / 2 - cx, ty: frame.y + frame.h / 2 - cy };
}

/** Keeps the image covering the frame (no empty area inside the crop) and within zoom limits. */
export function clampView(frame: Box, view: { s: number; tx: number; ty: number }, imgW: number, imgH: number, maxScale: number): { s: number; tx: number; ty: number } {
  const minS = Math.max(frame.w / imgW, frame.h / imgH);
  const s = Math.min(Math.max(view.s, minS), Math.max(minS, maxScale));
  const tx = Math.min(frame.x, Math.max(frame.x + frame.w - imgW * s, view.tx));
  const ty = Math.min(frame.y, Math.max(frame.y + frame.h - imgH * s, view.ty));
  return { s, tx, ty };
}
