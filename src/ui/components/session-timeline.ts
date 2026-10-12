/**
 * Pure maths of the sticky session timeline: the overview strip (labeled holds grouped by their
 * catalog group) and the detail window that follows the scroll position of the card list. A
 * session's videos are one timeline: placed back to back in session order (`videoOffsets`).
 */

export interface Range {
  startS: number;
  endS: number;
}

/** Length of the detail window for long sessions. */
export const DETAIL_WINDOW_S = 10 * 60;
/** Sessions up to this long are shown whole in the detail graph. */
export const WHOLE_VIDEO_MAX_S = 12 * 60;
/** The window only moves once the current time leaves this middle share of it (no jitter). */
export const FOLLOW_BAND = 0.5;

/** Visible length of the detail graph for a session (or video) of `durationS`. */
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

// ----- one timeline for all videos of a session -----

/**
 * Start of each video on the session timeline: the videos back to back in session order. Pauses
 * between clips are left out (recording times can be export times; the order is the user's).
 */
export function videoOffsets(videos: ReadonlyArray<{ id: string; durationS: number }>): Map<string, number> {
  const out = new Map<string, number>();
  let t = 0;
  for (const v of videos) {
    out.set(v.id, t);
    t += Math.max(0, v.durationS);
  }
  return out;
}

export interface SignalPart {
  offsetS: number;
  durationS: number;
  sampleHz: number;
  /** C(t) of the video. */
  values: Float32Array;
  /** Still threshold of the video; C is divided by it so every part's threshold is 1. */
  threshold: number;
}

/**
 * C(t) of all videos on the session timeline at `sampleHz`: each part divided by its own threshold
 * (videos differ in light and framing, so their raw C is not comparable), nearest sample. Time not
 * covered by a part (and a part's first and last second, where C is NaN) stays NaN, so the line
 * breaks between videos.
 */
export function combinedSignal(parts: readonly SignalPart[], totalS: number, sampleHz: number): Float32Array {
  const out = new Float32Array(Math.max(0, Math.ceil(totalS * sampleHz))).fill(NaN);
  for (const p of parts) {
    const scale = p.threshold > 0 && Number.isFinite(p.threshold) ? 1 / p.threshold : 1;
    const from = Math.max(0, Math.ceil(p.offsetS * sampleHz - 1e-6));
    const to = Math.min(out.length, Math.ceil((p.offsetS + p.durationS) * sampleHz - 1e-6));
    for (let i = from; i < to; i++) {
      const j = Math.round((i / sampleHz - p.offsetS) * p.sampleHz);
      const c = p.values[j];
      if (c !== undefined) out[i] = c * scale;
    }
  }
  return out;
}
