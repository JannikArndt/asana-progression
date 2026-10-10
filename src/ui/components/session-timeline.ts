/**
 * Pure maths of the sticky session timeline: the overview strip (labeled holds grouped by their
 * catalog group) and the detail window that follows the scroll position of the card list.
 */

export interface Range {
  startS: number;
  endS: number;
}

/** Length of the detail window for long videos. */
export const DETAIL_WINDOW_S = 20 * 60;
/** Videos up to this long are shown whole in the detail graph. */
export const WHOLE_VIDEO_MAX_S = 25 * 60;
/** The window only moves once the current time leaves this middle share of it (no jitter). */
export const FOLLOW_BAND = 0.5;

/** Visible length of the detail graph for a video. */
export function detailLength(durationS: number): number {
  return durationS <= WHOLE_VIDEO_MAX_S ? durationS : DETAIL_WINDOW_S;
}

/** A window of `lengthS` centred on `t`, shifted to stay inside 0…durationS. */
export function windowAround(t: number, lengthS: number, durationS: number): Range {
  const len = Math.min(lengthS, durationS);
  const startS = Math.min(Math.max(0, t - len / 2), Math.max(0, durationS - len));
  return { startS, endS: startS + len };
}

/**
 * The detail window for the current time `t`: unchanged (same object) while `t` is inside the
 * middle `band` of `current`, otherwise re-centred on `t` with the same length. Moving in steps
 * keeps the graph calm while the list scrolls.
 */
export function followWindow(current: Range, t: number, durationS: number, band = FOLLOW_BAND): Range {
  const len = current.endS - current.startS;
  const margin = (len * (1 - band)) / 2;
  const lo = current.startS + margin;
  const hi = current.endS - margin;
  // At the video edges the window cannot centre: t near 0 or the end is fine where it is.
  const atStart = current.startS <= 0 && t <= hi;
  const atEnd = current.endS >= durationS && t >= lo;
  if ((t >= lo && t <= hi) || atStart || atEnd) return current;
  return windowAround(t, len, durationS);
}

export interface OverviewSpan {
  startS: number;
  endS: number;
  status: 'open' | 'labeled' | 'dismissed';
  /** Catalog group of the label's asana (labeled spans only). */
  group?: string | undefined;
}

export interface OverviewSegment {
  startS: number;
  endS: number;
  /** Catalog group ('' = ungrouped). */
  group: string;
  /** Short display name. */
  label: string;
  holds: number;
}

/** Short names of the seed groups for the narrow overview strip. */
const SHORT_GROUP: Record<string, string> = {
  'Surya Namaskara': 'Sun',
  Backbending: 'Backbends',
};

export function shortGroup(group: string): string {
  return group ? (SHORT_GROUP[group] ?? group) : 'Other';
}

/**
 * Runs of consecutive labeled holds with the same catalog group, as one segment each (first
 * start → last end). Open and dismissed candidates do not break a run: they are drawn separately.
 */
export function groupSegments(spans: readonly OverviewSpan[]): OverviewSegment[] {
  const out: OverviewSegment[] = [];
  for (const s of spans) {
    if (s.status !== 'labeled') continue;
    const group = s.group ?? '';
    const last = out[out.length - 1];
    if (last && last.group === group) {
      last.endS = Math.max(last.endS, s.endS);
      last.holds++;
    } else {
      out.push({ startS: s.startS, endS: s.endS, group, label: shortGroup(group), holds: 1 });
    }
  }
  return out;
}

/**
 * Index of the first of `n` vertically ordered items whose bottom edge is below `y` (binary
 * search; `n` if none). Used to find the card right under the sticky header.
 */
export function firstBelow(n: number, bottomOf: (i: number) => number, y: number): number {
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bottomOf(mid) > y) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}
