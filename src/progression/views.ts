import type { Asset, Box, Hold, Session } from '../model/types';
import type { ProgressionItem, SideFilter } from './types';

/**
 * All holds of one asana with their assets, oldest first (ties: earlier in the video first).
 * Progression only looks at the asana: template, session position and source video don't matter.
 */
export function progressionItems(asanaId: string, holds: Hold[], sessions: Session[], assets: Asset[], side: SideFilter = 'both'): ProgressionItem[] {
  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const byHold = new Map<string, Asset[]>();
  for (const a of assets) {
    const list = byHold.get(a.holdId) ?? [];
    list.push(a);
    byHold.set(a.holdId, list);
  }
  const newest = (list: Asset[] | undefined, kind: Asset['kind']) =>
    list?.filter((a) => a.kind === kind).sort((x, y) => (y.createdAt ?? '').localeCompare(x.createdAt ?? ''))[0];
  return holds
    .filter((h) => h.asanaId === asanaId && (side === 'both' || h.side === side))
    .map((hold) => {
      const s = sessionById.get(hold.sessionId);
      const list = byHold.get(hold.id);
      return {
        hold,
        date: s?.date ?? '',
        note: s?.note ?? '',
        still: newest(list, 'still'),
        thumb: newest(list, 'thumb'),
        clip: newest(list, 'clip'),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.hold.startS - b.hold.startS);
}

/** Grid density after a pinch: spread (scale > 1) shows fewer, bigger tiles. */
export function nextColumns(current: number, scale: number, min = 2, max = 4): number {
  if (scale > 1.15) return Math.max(min, current - 1);
  if (scale < 0.87) return Math.min(max, current + 1);
  return current;
}

/** Index after a horizontal swipe in the viewer (wraps nothing; clamps at the ends). */
export function swipeIndex(index: number, count: number, dxPx: number, widthPx: number, velocityPxPerMs = 0): number {
  const threshold = widthPx * 0.2;
  if (dxPx < -threshold || velocityPxPerMs < -0.4) return Math.min(count - 1, index + 1);
  if (dxPx > threshold || velocityPxPerMs > 0.4) return Math.max(0, index - 1);
  return index;
}

/** Flipbook frame duration (ms) for a speed in frames per second (clamped 0.5–24). */
export function flipbookInterval(fps: number): number {
  const f = Math.min(24, Math.max(0.5, fps));
  return 1000 / f;
}

/** Whether the asana has holds on both sides (to offer the side filter). */
export function hasBothSides(holds: Hold[], asanaId: string): boolean {
  const sides = new Set(holds.filter((h) => h.asanaId === asanaId).map((h) => h.side));
  return sides.has('R') && sides.has('L');
}

/** Crop shown for a hold: manual override, else automatic, else the full frame (null). */
export function displayCrop(hold: Pick<Hold, 'crop'>): Box | null {
  return hold.crop.manual ?? hold.crop.auto ?? null;
}

/** Display aspect (width / height) of an item's cropped still, null without a still or thumbnail. */
export function itemAspect(item: Pick<ProgressionItem, 'hold' | 'still' | 'thumb'>): number | null {
  const a = item.still ?? item.thumb;
  if (!a || a.width <= 0 || a.height <= 0) return null;
  const c = displayCrop(item.hold) ?? { x: 0, y: 0, w: 1, h: 1 };
  if (c.w <= 0 || c.h <= 0) return null;
  return (c.w * a.width) / (c.h * a.height);
}

/** Median item aspect, clamped to [min, max]: one tile shape for the grid and the flipbook. */
export function typicalAspect(items: Array<Pick<ProgressionItem, 'hold' | 'still' | 'thumb'>>, fallback = 4 / 5, min = 0.5, max = 2): number {
  const list = items.map(itemAspect).filter((x): x is number => x !== null).sort((a, b) => a - b);
  if (!list.length) return fallback;
  const mid = list.length >> 1;
  const median = list.length % 2 ? list[mid]! : (list[mid - 1]! + list[mid]!) / 2;
  return Math.min(max, Math.max(min, median));
}
