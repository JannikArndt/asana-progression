import type { ParamGrid } from '../../labeling';
import type { LabProgress, LabReport } from '../research/lab';

export interface AppInfo {
  version: string;
  builtAt: string;
}

export type ResearchRequest =
  | { type: 'export'; jobId: number; cropper: 'mediapipe' | 'none'; baseUrl: string; app: AppInfo }
  | { type: 'lab'; jobId: number; grid: ParamGrid; app: AppInfo }
  | { type: 'cancel' };

export type ResearchEvent =
  | { type: 'export-progress'; jobId: number; phase: 'analyses' | 'poses'; done: number; total: number }
  | { type: 'export-done'; jobId: number; blob: Blob; videos: number; holds: number }
  | { type: 'lab-progress'; jobId: number; progress: LabProgress }
  | { type: 'lab-done'; jobId: number; report: LabReport }
  | { type: 'error'; jobId: number; message: string };
