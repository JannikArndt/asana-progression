/**
 * Public contract of the detection module.
 *
 * Detection is a pure streaming algorithm: it consumes tiny grayscale frames sampled at a
 * fixed rate and produces two signals (short-lag motion m(t) and posture change C(t)) plus
 * hold candidates. It knows nothing about video APIs, asanas, storage or UI.
 */

/** All tunable thresholds. Editable in the debug panel. */
export interface DetectionParams {
  /** Sampling rate of the input frames (Hz). Changing it requires re-decoding the video. */
  sampleHz: number;
  /** Long side (px) of the grayscale frames produced by the source. Requires re-decoding. */
  sampleLongSide: number;
  /** Average-pool factor applied to the sampled frames before analysis. Requires re-decoding. */
  pool: number;
  /** Median filter length (samples) applied to the raw short-lag motion. */
  motionMedianWindow: number;
  /** Half window (seconds) of the posture-change signal C(t). */
  changeWindowS: number;
  /** Minimum length (seconds) of a truncated C window at the start/end of the video. */
  edgeWindowMinS: number;
  /** Samples with C at or below this percentile of the video's C are "still". */
  stillPercentile: number;
  /** Still runs separated by gaps shorter than this (seconds) are joined. */
  gapMergeS: number;
  /** Still runs shorter than this (seconds) are dropped. */
  minHoldS: number;
  /** Fraction of the run (centred) in which the best frame is searched. */
  bestFrameMiddle: number;
  /** Length (seconds) of the clip window chosen inside a hold. */
  clipWindowS: number;
  /**
   * Adjacent candidates are merged when the mean absolute difference of their best frames is
   * below `similarMergeFactor × max(stillThreshold, m(bestA), m(bestB))`, capped at
   * `similarMergeRelative × median distance of adjacent candidates` (see below).
   */
  similarMergeFactor: number;
  /**
   * Cap for the merge distance relative to the median best-frame distance of adjacent pre-merge
   * candidates with a clear posture change between them (C peak ≥ `similarMergeRefPeak` ×
   * threshold), i.e. how different two poses look in this video. Applied with at least
   * `similarMergeMinPairs` such pairs.
   */
  similarMergeRelative: number;
  similarMergeRefPeak: number;
  similarMergeMinPairs: number;
  /** Only candidates separated by at most this gap (seconds) are considered for merging. */
  similarMergeMaxGapS: number;
  /**
   * Only merge fragments: the highest m between the two candidates must be at most this × the
   * 90th percentile of m inside them. Moving out of a pose and back in (reps, e.g. Navasana ×5)
   * moves more than the sway inside a hold; noise-split holds do not.
   */
  similarMergeMotion: number;
  /**
   * If p99(C) ≤ singleStillMaxSpread × p50(C), the video has no clear posture changes and is
   * treated as one single hold (single-asana clip). Only for videos up to `singleStillMaxS`.
   */
  singleStillMaxSpread: number;
  singleStillMaxS: number;
}

/** A pooled grayscale frame (row-major, one byte per pixel). */
export interface GrayFrame {
  width: number;
  height: number;
  data: Uint8Array;
}

export type CandidateStatus = 'open' | 'labeled' | 'dismissed';

export interface Candidate {
  id: string;
  startS: number;
  endS: number;
  bestS: number;
  /** Best frames of pieces that were merged into this candidate. */
  alternatesS: number[];
  /** Suggested clip window (lowest summed motion). */
  clipStartS: number;
  clipEndS: number;
  status: CandidateStatus;
}

/** Random access to the pooled frames of the analysed video, by sample index. */
export interface FrameAccess {
  frame(index: number): Uint8Array | Promise<Uint8Array>;
}

export interface Signals {
  sampleHz: number;
  /** Median-filtered short-lag motion, one value per sample. */
  m: Float32Array;
  /** Posture change, one value per sample; NaN where undefined (very start/end). */
  C: Float32Array;
}

export interface CandidateResult {
  /** C value at `stillPercentile`. */
  threshold: number;
  /** True if the special single-still-run case applied. */
  singleStill: boolean;
  candidates: Candidate[];
  /** Candidates before the similar-best-frame merge (for debugging and fixtures). */
  preMerge: Candidate[];
}

/** Values appended to the live signals since the previous drain. */
export interface SignalChunk {
  /** Sample index of C[0] in `C`. */
  from: number;
  C: Float32Array;
}

/** Serializable detector state for resuming after the tab was killed. */
export interface DetectorSnapshot {
  version: 1;
  count: number;
  width: number;
  height: number;
  /** Frames still needed by the C(t) windows, oldest first. */
  ring: Uint8Array[];
  rawMotion: Float32Array;
  C: Float32Array;
}
