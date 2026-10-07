/**
 * Public contract of the storage module: metadata repositories (IndexedDB), sample files and
 * assets (OPFS), quota. It stores records and bytes; it does not know how they were produced.
 */
import type { Analysis, Asana, Asset, Hold, ProcessingJob, SequenceTemplate, Session, Video } from '../model/types';

export interface Repository<T, K extends IDBValidKey = string> {
  get(key: K): Promise<T | undefined>;
  put(value: T): Promise<void>;
  delete(key: K): Promise<void>;
  all(): Promise<T[]>;
  /** Records whose `index` equals `value`. */
  findBy(index: string, value: IDBValidKey): Promise<T[]>;
}

export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface MetadataStore {
  asanas: Repository<Asana>;
  templates: Repository<SequenceTemplate>;
  sessions: Repository<Session>;
  videos: Repository<Video>;
  analyses: Repository<Analysis>;
  holds: Repository<Hold>;
  assets: Repository<Asset>;
  jobs: Repository<ProcessingJob>;
  settings: KeyValueStore;
  close(): void;
}

/**
 * Fixed-size records addressed by index (pooled analysis frames). Synchronous where the platform
 * allows (OPFS sync access handles in workers); reads may be async on the main thread.
 */
export interface SampleWriter {
  readonly recordBytes: number;
  write(index: number, data: Uint8Array): void;
  read(index: number): Uint8Array;
  /** Number of complete records. */
  count(): number;
  truncate(records: number): void;
  flush(): void;
  close(): void;
}

export interface SampleReader {
  readonly recordBytes: number;
  count(): Promise<number>;
  read(index: number): Promise<Uint8Array>;
  /** Reads records [from, to) in one go. */
  readRange(from: number, to: number): Promise<Uint8Array>;
}

export interface StorageEstimateInfo {
  quota: number | null;
  usage: number | null;
  persisted: boolean | null;
}

export interface QuotaProbeResult {
  bytesWritten: number;
  stoppedBy: 'cap' | 'error';
  error?: string;
  ms: number;
}
