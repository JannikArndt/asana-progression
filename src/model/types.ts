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

/** Core entity; lettered variants are separate asanas. */
export interface Asana {
  id: string;
  name: string;
  sided: boolean;
}

/** Suggestion data only. */
export interface SequenceTemplate {
  id: string;
  name: string;
  entries: Array<{ asanaId: string; side?: Side }>;
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
  candidates: Candidate[];
  preMerge: Candidate[];
  createdAt: string;
  stats: ProcessingStats | null;
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
  crop: { auto?: Box; manual?: Box };
}

export interface Asset {
  id: string;
  holdId: string;
  kind: 'still' | 'thumb' | 'clip';
  mime: string;
  width: number;
  height: number;
  bytes: number;
  storageKey: string;
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
