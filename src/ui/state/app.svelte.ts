import { DEFAULT_PARAMS, normalizeParams, type DetectionParams } from '../../detection';
import { openMetadataStore, type MetadataStore } from '../../storage';
import type { Analysis, ProcessingJob, Video } from '../../model';
import { openVideo, type VideoSource } from '../../source';
import { SvelteMap } from 'svelte/reactivity';

export interface AnalysisSummary {
  videoId: string;
  candidates: number;
  sampleCount: number;
  createdAt: string;
}

/** App-wide state: the metadata store, lists for the home screen, session-only file handles. */
class AppState {
  store: MetadataStore | null = null;
  ready = $state(false);
  error = $state<string | null>(null);
  videos = $state<Video[]>([]);
  summaries = $state<Record<string, AnalysisSummary>>({});
  jobs = $state<ProcessingJob[]>([]);
  params = $state<DetectionParams>({ ...DEFAULT_PARAMS });
  skipNonReference = $state(true);
  /** Files picked in this browser session, by video id (needed for exact frames). */
  files = new SvelteMap<string, File>();
  private sources = new Map<string, Promise<VideoSource>>();

  async init() {
    try {
      this.store = await openMetadataStore();
      const [params, skip] = await Promise.all([
        this.store.settings.get<Partial<DetectionParams>>('detectionParams'),
        this.store.settings.get<boolean>('skipNonReference'),
      ]);
      this.params = normalizeParams(params);
      this.skipNonReference = skip ?? true;
      await this.refresh();
      this.ready = true;
    } catch (e) {
      this.error = `Storage is not available: ${String(e)}`;
    }
  }

  get db(): MetadataStore {
    if (!this.store) throw new Error('Store not ready');
    return this.store;
  }

  async refresh() {
    const db = this.db;
    const [videos, analyses, jobs] = await Promise.all([db.videos.all(), db.analyses.all(), db.jobs.all()]);
    videos.sort((a, b) => (b.recordedAt ?? b.importedAt).localeCompare(a.recordedAt ?? a.importedAt));
    this.videos = videos;
    const summaries: Record<string, AnalysisSummary> = {};
    for (const a of analyses) summaries[a.videoId] = summarize(a);
    this.summaries = summaries;
    this.jobs = jobs;
  }

  async saveParams(p: DetectionParams) {
    this.params = normalizeParams(p);
    await this.db.settings.set('detectionParams', $state.snapshot(this.params));
  }

  async setSkipNonReference(v: boolean) {
    this.skipNonReference = v;
    await this.db.settings.set('skipNonReference', v);
  }

  /** Opened source for a video whose file was picked in this session (cached). */
  source(videoId: string): Promise<VideoSource> | null {
    const file = this.files.get(videoId);
    if (!file) return null;
    let s = this.sources.get(videoId);
    if (!s) {
      s = openVideo(file);
      this.sources.set(videoId, s);
      s.catch(() => this.sources.delete(videoId));
    }
    return s;
  }

  attachFile(videoId: string, file: File) {
    if (this.files.get(videoId) !== file) {
      this.files.set(videoId, file);
      const old = this.sources.get(videoId);
      this.sources.delete(videoId);
      void old?.then((s) => s.close()).catch(() => {});
    }
  }
}

export function summarize(a: Analysis): AnalysisSummary {
  return { videoId: a.videoId, candidates: a.candidates.length, sampleCount: a.sampleCount, createdAt: a.createdAt };
}

export const app = new AppState();
