import type { Asset, Box, Hold, Session } from '../model/types';
import type { ProgressionItem, RepFilter, RepInfo, SideFilter } from './types';

/**
 * Reps: consecutive holds of the same asana and side within a session (in session order: videos
 * as listed in the session, then time) are reps 1…n of one run, e.g. 5 × Navasana. Another asana
 * in between starts a new run.
 */
export function holdReps(holds: Hold[], sessions: Session[]): Map<string, RepInfo> {
  const videoOrder = new Map<string, number>();
  for (const s of sessions) s.videoIds.forEach((v, i) => videoOrder.set(`${s.id}/${v}`, i));
  const bySession = new Map<string, Hold[]>();
  for (const h of holds) {
    const list = bySession.get(h.sessionId) ?? [];
    list.push(h);
    bySession.set(h.sessionId, list);
  }
  const out = new Map<string, RepInfo>();
  for (const [sid, list] of bySession) {
    const pos = (h: Hold) => videoOrder.get(`${sid}/${h.videoId}`) ?? Infinity;
    list.sort((a, b) => pos(a) - pos(b) || a.startS - b.startS);
    let run: Hold[] = [];
    const flush = () => run.forEach((h, i) => out.set(h.id, { rep: i + 1, of: run.length }));
    for (const h of list) {
      const last = run[run.length - 1];
      if (last && (last.asanaId !== h.asanaId || last.side !== h.side)) {
        flush();
        run = [];
      }
      run.push(h);
    }
    flush();
  }
  return out;
}

/**
 * All holds of one asana with their assets, oldest first (ties: session order — videos as listed
 * in the session, then earlier in the video first).
 * Progression only looks at the asana: template, session position and source video don't matter.
 * `holds` must contain the whole sessions (reps are counted among all their holds).
 */
export function progressionItems(
  asanaId: string,
  holds: Hold[],
  sessions: Session[],
  assets: Asset[],
  side: SideFilter = 'both',
  reps: RepFilter = 'all',
): ProgressionItem[] {
  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const repOf = holdReps(holds, sessions);
  const videoPos = (h: Hold) => sessionById.get(h.sessionId)?.videoIds.indexOf(h.videoId) ?? -1;
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
      const r = repOf.get(hold.id) ?? { rep: 1, of: 1 };
      return {
        hold,
        date: s?.date ?? '',
        note: s?.note ?? '',
        still: newest(list, 'still'),
        thumb: newest(list, 'thumb'),
        clip: newest(list, 'clip'),
        rep: r.rep,
        reps: r.of,
      };
    })
    .filter((it) => reps === 'all' || (reps === 'first' ? it.rep === 1 : it.rep === it.reps))
    .sort((a, b) => a.date.localeCompare(b.date) || videoPos(a.hold) - videoPos(b.hold) || a.hold.startS - b.hold.startS);
}

/** Whether any session has more than one rep of the asana in a row (to offer the rep filter). */
export function hasReps(asanaId: string, holds: Hold[], sessions: Session[]): boolean {
  const reps = holdReps(holds, sessions);
  return holds.some((h) => h.asanaId === asanaId && (reps.get(h.id)?.of ?? 1) > 1);
}

/** Short caption for a rep, e.g. "2/5"; empty for a single hold. */
export function repLabel(item: Pick<ProgressionItem, 'rep' | 'reps'>): string {
  return item.reps > 1 ? `${item.rep}/${item.reps}` : '';
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
