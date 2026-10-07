import type { DetectionParams, SignalChunk } from '../../detection';
import type { QuotaProbeResult } from '../../storage';
import type { SamplerStats, VideoMeta } from '../../source';

export type WorkerRequest =
  | {
      type: 'analyze';
      jobId: number;
      file: File;
      videoId: string;
      fingerprint: string;
      params: DetectionParams;
      skipNonReference: boolean;
      resume: boolean;
      /** Debug/testing: artificial delay per sample (ms) and checkpoint interval override. */
      debug?: { sampleDelayMs?: number; checkpointMs?: number; grayMethod?: 'canvas' | 'luma' };
    }
  | { type: 'reanalyze'; jobId: number; videoId: string; params: DetectionParams }
  | { type: 'probe-quota'; jobId: number; capBytes: number }
  | { type: 'cancel' };

export type WorkerEvent =
  | {
      type: 'started';
      jobId: number;
      meta: VideoMeta;
      totalSamples: number;
      startIndex: number;
      frameWidth: number;
      frameHeight: number;
      opfs: boolean;
      /** C values restored from a checkpoint (resume). */
      restored: SignalChunk | null;
    }
  | { type: 'progress'; jobId: number; index: number; mediaTimeS: number; sampler: SamplerStats | null; chunk: SignalChunk }
  | { type: 'reanalyze-progress'; jobId: number; done: number; total: number }
  | { type: 'done'; jobId: number; videoId: string; candidates: number }
  | { type: 'cancelled'; jobId: number }
  | { type: 'error'; jobId: number; message: string; stage: string; progressed: boolean }
  | { type: 'quota-progress'; jobId: number; bytes: number }
  | { type: 'quota-result'; jobId: number; result: QuotaProbeResult };
