/**
 * Public contract of the labeling module: candidates + catalog + optional template → labeled
 * holds, and the suggestion engine. It works on labels and time spans; it never sees pixels and
 * does not know how anything is stored.
 */
import type { CompactPose, PostureClass, Side } from '../model/types';

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
  /** Pose of the item's best frame (open items) or its still (labeled), when known. */
  pose?: CompactPose | null;
  /** Video of the item: a change of video between items may be a break in the recording. */
  videoId?: string;
}

export interface Suggestion extends Label {
  /** `rep`: another hold of the previous entry beyond its usual count; `pose`: whole-session alignment with poses. */
  reason: 'template' | 'lookahead' | 'rep' | 'history' | 'pose';
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
  /** Pose of the hold's still, when known (examples for the pose classes). */
  pose?: CompactPose | null;
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
/** A time range in seconds (`toS` may be Infinity: open end). */
export interface TimeRange {
  fromS: number;
  toS: number;
}

export interface SignalView {
  sampleHz: number;
  m: ArrayLike<number>;
  C: ArrayLike<number>;
  durationS: number;
  bestFrameMiddle: number;
  clipWindowS: number;
}
