import { DEFAULT_PARAMS, normalizeParams, type DetectionParams } from '../../detection';
import { openMetadataStore, type MetadataStore } from '../../storage';
import {
  newId,
  primarySeriesTemplate,
  SEED_ADDED,
  withSunSalutations,
  withReps,
  PRIMARY_SERIES_ID,
  SEED_ASANAS,
  sortCatalog,
  type Analysis,
  type Asana,
  type Asset,
  type Hold,
  type ProcessingJob,
  type SequenceTemplate,
  type Session,
  type Video,
} from '../../model';
import { openVideo, type VideoSource } from '../../source';
import { SvelteMap } from 'svelte/reactivity';
import { dayOf, groupByDay, orderVideoIds, orphanVideos, SHORT_CLIP_S } from './session-data';

export interface AnalysisSummary {
  videoId: string;
  candidates: Analysis['candidates'];
  sampleCount: number;
  sampleHz: number;
  frameWidth: number;
  frameHeight: number;
  createdAt: string;
}

const CATALOG_VERSION = 3;

/** App-wide state: the metadata store, lists for the home screen, session-only file handles. */
class AppState {
  store: MetadataStore | null = null;
  ready = $state(false);
  error = $state<string | null>(null);
  videos = $state.raw<Video[]>([]);
  sessions = $state.raw<Session[]>([]);
  holds = $state.raw<Hold[]>([]);
  asanas = $state.raw<Asana[]>([]);
  templates = $state.raw<SequenceTemplate[]>([]);
  summaries = $state.raw<Record<string, AnalysisSummary>>({});
  jobs = $state.raw<ProcessingJob[]>([]);
  assets = $state.raw<Asset[]>([]);
  clipQuality = $state<'720p' | '1080p' | 'original'>('1080p');
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
      this.clipQuality = (await this.store.settings.get<'720p' | '1080p' | 'original'>('clipQuality')) ?? '1080p';
      await this.seedCatalog();
      await this.migrate();
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

  /** Seeds the asana catalog and the Primary series template on first run; upgrades older seeds. */
  private async seedCatalog() {
    const db = this.db;
    const version = (await db.settings.get<number>('catalogVersion')) ?? 0;
    if (version >= CATALOG_VERSION) return;
    const asanas = await db.asanas.all();
    if (asanas.length === 0) for (const a of SEED_ASANAS) await db.asanas.put({ ...a });
    else {
      const have = new Set(asanas.map((a) => a.id));
      for (let v = version + 1; v <= CATALOG_VERSION; v++) {
        for (const id of SEED_ADDED[v] ?? []) {
          const a = SEED_ASANAS.find((x) => x.id === id);
          if (a && !have.has(id)) await db.asanas.put({ ...a });
        }
      }
    }
    const primary = await db.templates.get(PRIMARY_SERIES_ID);
    // A template the user deleted stays deleted.
    if (!primary && version === 0) await db.templates.put(primarySeriesTemplate());
    else if (primary && version < 3) await db.templates.put(withReps(version < 2 ? withSunSalutations(primary) : primary));
    await db.settings.set('catalogVersion', CATALOG_VERSION);
  }

  /** Videos without a session (milestone-1 data): one session per recording day. */
  private async migrate() {
    const db = this.db;
    const [sessions, videos] = await Promise.all([db.sessions.all(), db.videos.all()]);
    for (const [day, list] of groupByDay(orphanVideos(sessions, videos))) {
      const existing = sessions.find((s) => dayOf(s.date) === day);
      if (existing) {
        existing.videoIds = orderVideoIds([...existing.videoIds, ...list.map((v) => v.id)], videos);
        await db.sessions.put(existing);
        continue;
      }
      const first = list[0]!;
      const total = list.reduce((s, v) => s + v.durationS, 0);
      await db.sessions.put({
        id: newId('ses'),
        date: first.recordedAt ?? first.importedAt,
        note: '',
        videoIds: list.map((v) => v.id),
        ...(total >= SHORT_CLIP_S ? { templateId: PRIMARY_SERIES_ID } : {}),
      });
    }
  }

  async refresh() {
    const db = this.db;
    const [videos, analyses, jobs, sessions, holds, asanas, templates, assets] = await Promise.all([
      db.videos.all(),
      db.analyses.all(),
      db.jobs.all(),
      db.sessions.all(),
      db.holds.all(),
      db.asanas.all(),
      db.templates.all(),
      db.assets.all(),
    ]);
    videos.sort((a, b) => (b.recordedAt ?? b.importedAt).localeCompare(a.recordedAt ?? a.importedAt));
    sessions.sort((a, b) => b.date.localeCompare(a.date));
    this.videos = videos;
    const summaries: Record<string, AnalysisSummary> = {};
    for (const a of analyses) summaries[a.videoId] = summarize(a);
    this.summaries = summaries;
    this.jobs = jobs;
    this.sessions = sessions;
    this.holds = holds;
    this.asanas = sortCatalog(asanas);
    this.templates = templates.sort((a, b) => a.name.localeCompare(b.name));
    this.assets = assets;
  }

  /** Reloads catalog and templates after an edit. */
  async refreshCatalog() {
    const [asanas, templates] = await Promise.all([this.db.asanas.all(), this.db.templates.all()]);
    this.asanas = sortCatalog(asanas);
    this.templates = templates.sort((a, b) => a.name.localeCompare(b.name));
  }

  async setClipQuality(q: '720p' | '1080p' | 'original') {
    this.clipQuality = q;
    await this.db.settings.set('clipQuality', q);
  }

  addAssets(list: Asset[]) {
    const ids = new Set(list.map((a) => a.id));
    this.assets = [...this.assets.filter((a) => !ids.has(a.id)), ...list];
  }

  removeAssets(ids: string[]) {
    const drop = new Set(ids);
    this.assets = this.assets.filter((a) => !drop.has(a.id));
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

  /** Incremental updates after review edits (avoid reloading everything). */
  upsertHold(h: Hold) {
    this.holds = [...this.holds.filter((x) => x.id !== h.id), h];
  }

  removeHold(id: string) {
    this.holds = this.holds.filter((x) => x.id !== id);
  }

  setCandidates(videoId: string, candidates: Analysis['candidates']) {
    const s = this.summaries[videoId];
    if (s) this.summaries = { ...this.summaries, [videoId]: { ...s, candidates } };
  }

  upsertSession(session: Session) {
    this.sessions = [...this.sessions.filter((x) => x.id !== session.id), session].sort((a, b) => b.date.localeCompare(a.date));
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
  return {
    videoId: a.videoId,
    candidates: a.candidates,
    sampleCount: a.sampleCount,
    sampleHz: a.sampleHz,
    frameWidth: a.frameWidth,
    frameHeight: a.frameHeight,
    createdAt: a.createdAt,
  };
}

export const app = new AppState();
