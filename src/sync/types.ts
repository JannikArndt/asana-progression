/**
 * Public contract of the sync module: moves records and files between this device's storage and
 * the server. The device stays the working copy (analysis, offline use); the server is where
 * every device and share link reads from.
 */
import type { SyncedStore } from '../storage/types';

/** One record write for the server: the record itself, or its deletion. */
export type PushOp = { store: SyncedStore; key: string; body: unknown } | { store: SyncedStore; key: string; deleted: true };

export interface PulledRecord {
  store: SyncedStore;
  key: string;
  rev: number;
  deleted?: boolean;
  body?: unknown;
}

export interface PullPage {
  records: PulledRecord[];
  /** Revision of the last record in this page (pass as `since` for the next one). */
  rev: number;
  /** Latest revision on the server. */
  latest: number;
  more: boolean;
}

export interface RemoteFile {
  key: string;
  bytes: number;
  /** Uncompressed size (analysis frames are stored gzipped). */
  rawBytes: number | null;
}

export interface ServerStatus {
  rev: number;
  records: Record<string, number>;
  files: Record<string, { count: number; bytes: number }>;
}

/** The server's sync endpoints. */
export interface SyncApi {
  status(): Promise<ServerStatus>;
  push(ops: PushOp[]): Promise<number>;
  pull(since: number): Promise<PullPage>;
  listFiles(prefix: string): Promise<RemoteFile[]>;
  putFile(key: string, data: Blob, rawBytes?: number): Promise<void>;
  /** Null when the server does not have it. */
  getFile(key: string): Promise<Blob | null>;
}

/** Which optional files go to the server (records, stills and thumbnails always do). */
export interface FileOptions {
  clips: boolean;
  /** The pooled analysis frames (`samples-<videoId>.bin`, gzipped on the way). */
  frames: boolean;
}

export interface SyncProgress {
  phase: 'files' | 'records' | 'pull';
  done: number;
  total: number;
  bytesDone: number;
  bytesTotal: number;
}

export interface LocalSizes {
  records: number;
  /** Stills and thumbnails. */
  images: { count: number; bytes: number };
  clips: { count: number; bytes: number };
  frames: { count: number; bytes: number };
}

export class SyncError extends Error {
  override name = 'SyncError';
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
