/**
 * Public contract of the labeling module: candidates + catalog + optional template → labeled
 * holds, and the suggestion engine. It works on labels and time spans; it never sees pixels and
 * does not know how anything is stored.
 */
import type { PostureClass, Side } from '../model/types';

export interface Label {
  asanaId: string;
  side: Side | null;
  /** Index into the session's template entries, when the label came from (or matches) one. */
  templateEntryIndex?: number;
}

/** One candidate in session order (videos in session order, then by start time). */
export interface ReviewItem {
  key: string;
  status: 'open' | 'labeled' | 'dismissed';
  /** Present when labeled. */
  label?: Label;
  /** Optional posture class from a pose model. */
  postureClass?: PostureClass;
}

export interface Suggestion extends Label {
  /** `rep`: another hold of the previous entry beyond its usual count. */
  reason: 'template' | 'lookahead' | 'rep' | 'history';
}

/** A past hold, for suggestions without a template. */
export interface HistoryEntry {
  asanaId: string;
  side: Side | null;
  /** ISO date of the session. */
  date: string;
  sessionId: string;
  /** Position within its session. */
  order: number;
}

export interface SuggestionOptions {
  /** Number of suggestions per item (default 3). */
  limit?: number;
  /** How far to look ahead when the posture class contradicts the next entry (default 5). */
  lookahead?: number;
  /** "Now" for recency weighting (ISO). */
  now?: string;
}

/** Signals needed to (re)compute best frame and clip window of edited spans. */
export interface SignalView {
  sampleHz: number;
  m: ArrayLike<number>;
  C: ArrayLike<number>;
  durationS: number;
  bestFrameMiddle: number;
  clipWindowS: number;
}
