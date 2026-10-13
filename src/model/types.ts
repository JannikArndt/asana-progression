/**
 * Shared data model (types only). Every module may import this; it imports nothing but the
 * public detection types that analyses contain.
 */
import type { Candidate, DetectionParams } from '../detection/types';

export type Side = 'R' | 'L';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Coarse body orientation; a pose model can classify frames into these (crop module, M3). */
export type PostureClass = 'standing' | 'seated' | 'lying' | 'inverted' | 'arm-balance';

/**
 * Body pose of one frame, compact (research/REPORT.md, B2): the 15 body joints of `POSE_JOINTS` in
 * MediaPipe world coordinates (metres, origin between the hips). Encode and decode with
 * `encodePose` / `decodePose`.
 */
export interface CompactPose {
  v: 1;
  /** x, y, z per joint, float16 little-endian, base64. */
  world: string;
  /** Visibility × 255 per joint, uint8, base64. */
  vis: string;
  posture: PostureClass | null;
}

/** Core entity; lettered variants are separate asanas. */
export interface Asana {
  id: string;
  name: string;
  sided: boolean;
  /** Catalog section for display, e.g. "Standing". */
  group?: string;
  /** Expected posture class (used to sanity-check template suggestions). */
  posture?: PostureClass;
}

/**
 * Lettered variants of one asana shown together ("Supta Padangusthasana" A | B), derived from the
 * names (`asanaFamilies`, never stored). Members stay separate asanas: A is only compared with A.
 */
export interface AsanaFamily {
  /** Shared name without the letter; the asana's own name for a single-member entry. */
  base: string;
  group: string | undefined;
  /** Sorted by letter; one asana for a plain (or lone lettered) asana. */
  members: Asana[];
}

/** Suggestion data only. */
/**
 * One step of a sequence. `reps` = how many holds in a row are usual (default 1, e.g. 5 × Navasana);
 * suggestions also allow fewer or more.
 */
export interface TemplateEntry {
  asanaId: string;
  side?: Side;
  reps?: number;
}

export interface SequenceTemplate {
  id: string;
  name: string;
  entries: TemplateEntry[];
}

export interface Video {
  id: string;
  fingerprint: string;
  fileName: string;
  fileSize: number;
  durationS: number;
  codec: string | null;
  width: number;
  height: number;
  fps: number | null;
  /** ISO 8601, editable. */
  recordedAt: string | null;
  importedAt: string;
  /** Source metadata snapshot for diagnostics (opaque here). */
  meta?: Record<string, unknown>;
}

export interface Session {
  id: string;
  date: string;
  note: string;
  videoIds: string[];
  templateId?: string;
  /** The user chose not to combine this session with its same-day sessions. */
  keepSeparate?: boolean;
  /**
   * Where it was practised: coordinates from the first video that has them (WGS 84 degrees), and a
   * place name the user gave (suggested from named sessions nearby). Both are optional.
   */
  location?: SessionLocation;
}

export interface SessionLocation {
  name?: string;
  lat?: number;
  lon?: number;
}

export interface ProcessingStats {
  decodeWallMs: number;
  framesDecoded: number;
  packetsRead: number;
  packetsSkipped: number;
  convertMs: number;
  /** Media seconds processed per wall-clock second. */
  realtimeFactor: number;
  resumedCount: number;
  skipNonReference: boolean;
  /** Frame → gray implementation and its first-frame benchmark (ms), when known. */
  grayMethod?: 'canvas' | 'luma' | null;
  grayBenchmark?: { canvas: number; luma: number } | null;
  pixelFormat?: string | null;
}

/** A detected (or manually added) hold candidate under review. */
export interface ReviewCandidate extends Candidate {
  /** Set when the candidate is labeled. */
  holdId?: string;
  origin?: 'detected' | 'manual';
}

export interface Analysis {
  videoId: string;
  params: DetectionParams;
  sampleHz: number;
  frameWidth: number;
  frameHeight: number;
  sampleCount: number;
  m: Float32Array;
  C: Float32Array;
  threshold: number;
  singleStill: boolean;
  candidates: ReviewCandidate[];
  preMerge: Candidate[];
  createdAt: string;
  stats: ProcessingStats | null;
  /**
   * Poses of candidates' best frames, by sample index (`poseKey`): a pose belongs to a frame, so it
   * survives edits that keep the frame. Null = no body found there.
   */
  poses?: Record<string, CompactPose | null>;
}

export interface Hold {
  id: string;
  sessionId: string;
  videoId: string;
  asanaId: string;
  side: Side | null;
  startS: number;
  endS: number;
  bestS: number;
  clipStartS: number;
  clipEndS: number;
  templateEntryIndex?: number;
  /** Display crop: `manual` wins over `auto`; `autoVersion` = crop module version that made `auto`. */
  crop: { auto?: Box; manual?: Box; autoVersion?: number };
  /** Pose found on the still (with the automatic crop); null = no body found. */
  pose?: CompactPose | null;
}

export interface Asset {
  id: string;
  holdId: string;
  kind: 'still' | 'thumb' | 'clip';
  mime: string;
  width: number;
  height: number;
  bytes: number;
  /** Path of the file in the asset store (OPFS), e.g. "assets/<id>.jpg". */
  storageKey: string;
  /** Still/thumb: captured frame time; clip: captured range (seconds of the source video). */
  atS?: number;
  startS?: number;
  endS?: number;
  quality?: '720p' | '1080p' | 'original';
  createdAt?: string;
}

/** Resumable processing state (one per video being analysed). */
export interface ProcessingJob {
  videoId: string;
  fingerprint: string;
  fileName: string;
  fileSize: number;
  durationS: number;
  params: DetectionParams;
  skipNonReference: boolean;
  /** Next sample index to decode. */
  nextIndex: number;
  frameWidth: number;
  frameHeight: number;
  /** Detector snapshot (opaque to storage). */
  snapshot: unknown;
  stats: ProcessingStats;
  startedAt: string;
  updatedAt: string;
  status: 'running' | 'interrupted' | 'error';
  error?: string;
}
