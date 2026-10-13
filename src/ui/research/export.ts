/**
 * Research export (Settings → Diagnostics → "Export research data"): one JSON with everything needed
 * to study hold finding, asana naming and the automatic crop offline, and nothing personal or
 * visual — no file names, notes, places or coordinates, no images and no analysis frames.
 */
import {
  DEFAULT_PARAMS,
  SIGNAL_PARAM_KEYS,
  findCandidates,
  meanAbsDiff,
  normalizeParams,
  reanalyze,
  type Candidate,
  type DetectionParams,
  type FrameAccess,
  type Signals,
} from '../../detection';
import { addScores, scoreDetection, summarizeScore, type DetectionScore, type ScoreSummary } from '../../labeling';
import { holdReps } from '../../progression';
import { boxFromLandmarks, type BodyBox, type Landmark, type PoseDetection } from '../../crop';
import type { Analysis, Asana, Asset, Box, Hold, PostureClass, SequenceTemplate, Session, Video } from '../../model';
import { encodeFloat16 } from './float16';

export const RESEARCH_FORMAT = 'asana-progression/research';
export const RESEARCH_VERSION = 1;
/** Pairs of fresh pre-merge candidates up to this far apart get merge inputs (the similar-merge's largest max gap). */
export const MERGE_INPUT_MAX_GAP_S = 120;

/** Landmark as [x, y, z, visibility] (4 decimals; z and visibility null when unknown). */
export type LandmarkRow = [number, number, number | null, number | null];

export interface ResearchCandidate {
  id: string;
  status: Candidate['status'];
  origin: 'detected' | 'manual' | null;
  holdId: string | null;
  startS: number;
  endS: number;
  bestS: number;
  alternatesS: number[];
  clipStartS: number;
  clipEndS: number;
}

export type Span = Pick<Candidate, 'startS' | 'endS' | 'bestS' | 'alternatesS' | 'clipStartS' | 'clipEndS'>;

export interface ResearchAnalysis {
  videoId: string;
  sessionId: string | null;
  /** No open candidates and at least one labeled hold: every hold is labeled, "Not a pose" = false detection. */
  fullyLabeled: boolean;
  /** Parameters of the stored analysis (its candidates and preMerge). */
  params: DetectionParams;
  sampleHz: number;
  frameWidth: number;
  frameHeight: number;
  sampleCount: number;
  threshold: number;
  singleStill: boolean;
  /**
   * m(t) and C(t) with the default signal parameters (stored ones when the analysis used them, else
   * recomputed from the stored frames): little-endian float16, base64 (see float16.ts).
   */
  signals: { encoding: 'float16-le-base64'; from: 'stored' | 'recomputed'; m: string; C: string } | null;
  /** Review state: the candidates after every edit. */
  candidates: ResearchCandidate[];
  /** Candidates of the stored analysis before the similar-merge. */
  preMerge: Span[];
  /** Detection re-run with the current defaults on the stored frames (what a new import would get). */
  fresh: {
    threshold: number;
    singleStill: boolean;
    candidates: Span[];
    preMerge: Span[];
    /**
     * Inputs of the similar-merge that need the frames: for pre-merge candidates a < b at most
     * MERGE_INPUT_MAX_GAP_S apart, the mean absolute difference of their best frames and the largest
     * m between them (null when they touch).
     */
    mergeInputs: Array<{ a: number; b: number; diff: number; gapMaxM: number | null }>;
  } | null;
  /** Why `fresh` (and `signals` when recomputing was needed) is missing, e.g. no stored frames. */
  freshError?: string;
}

export interface ResearchPose {
  /** Size of the image the pose model saw (the still scaled to a long side of 640). */
  preview: { width: number; height: number };
  posture: PostureClass | null;
  /** The automatic crop's body box (as stored when the crop is current). */
  box: BodyBox;
  /** The same box built from every landmark, whatever its visibility. */
  boxAll: BodyBox | null;
  landmarks: LandmarkRow[];
  world: LandmarkRow[] | null;
}

export interface ResearchHold {
  id: string;
  sessionId: string;
  videoId: string;
  asanaId: string;
  side: 'R' | 'L' | null;
  startS: number;
  endS: number;
  bestS: number;
  clipStartS: number;
  clipEndS: number;
  templateEntryIndex: number | null;
  /** Position in its run of consecutive holds of the same asana and side (progression.holdReps). */
  rep: number;
  reps: number;
  crop: { auto: Box | null; manual: Box | null; autoVersion: number | null };
  still: { width: number; height: number; atS: number | null } | null;
  pose: ResearchPose | null;
  poseStatus: 'ok' | 'no-still' | 'no-body' | 'no-model' | 'error';
}

export interface VideoSummary {
  videoId: string;
  sessionId: string | null;
  fullyLabeled: boolean;
  /** Fresh detection with the defaults scored against the labeled holds; null without `fresh`. */
  defaults: ScoreSummary | null;
}

export interface ResearchExport {
  format: typeof RESEARCH_FORMAT;
  version: typeof RESEARCH_VERSION;
  exportedAt: string;
  app: { version: string; builtAt: string } | null;
  defaults: DetectionParams;
  cropper: string;
  catalog: Array<Pick<Asana, 'id' | 'name' | 'sided'> & { group: string | null; posture: PostureClass | null }>;
  templates: SequenceTemplate[];
  sessions: Array<{ id: string; date: string; templateId: string | null; videoIds: string[]; fullyLabeled: boolean }>;
  videos: Array<Pick<Video, 'id' | 'durationS' | 'width' | 'height' | 'fps' | 'codec' | 'recordedAt'>>;
  analyses: ResearchAnalysis[];
  holds: ResearchHold[];
  summary: { videos: VideoSummary[]; fullyLabeled: ScoreSummary | null };
}

export interface ResearchSource {
  asanas: Asana[];
  templates: SequenceTemplate[];
  sessions: Session[];
  videos: Video[];
  analyses: Analysis[];
  holds: Hold[];
  assets: Asset[];
}

/** Stored pooled frames of one video. */
export interface StoredFrames extends FrameAccess {
  count: number;
}

export interface PoseResult {
  detection: PoseDetection | null;
  /** Size of the image the model saw. */
  width: number;
  height: number;
  /** Name of the cropper ('none' = no pose model). */
  cropper: string;
}

export interface ResearchDeps {
  /** Frames of an analysis (null when its sample file is missing). */
  frames(analysis: Analysis): Promise<StoredFrames | null>;
  /** Pose of a stored still, run like capture does (preview of the still). Throws on failure. */
  pose(still: Asset): Promise<PoseResult>;
  app?: { version: string; builtAt: string };
  now?: Date;
  onProgress?(phase: 'analyses' | 'poses', done: number, total: number): void;
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const r4n = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? null : r4(v));
const box4 = (b: Box): Box => ({ x: r4(b.x), y: r4(b.y), w: r4(b.w), h: r4(b.h) });
const bodyBox4 = (b: BodyBox): BodyBox => ({ ...box4(b), score: r4(b.score) });
const row = (l: Landmark): LandmarkRow => [r4(l.x), r4(l.y), r4n(l.z), r4n(l.visibility)];

function span(c: Candidate): Span {
  return { startS: c.startS, endS: c.endS, bestS: c.bestS, alternatesS: c.alternatesS, clipStartS: c.clipStartS, clipEndS: c.clipEndS };
}

/** Day of an ISO date ("2025-04-03T07:12:00+02:00" → "2025-04-03"). */
function day(iso: string): string {
  return iso.slice(0, 10);
}

/** No open candidates and at least one labeled. */
export function isFullyLabeled(a: Pick<Analysis, 'candidates'>): boolean {
  return a.candidates.length > 0 && a.candidates.every((c) => c.status !== 'open') && a.candidates.some((c) => c.status === 'labeled');
}

function sameSignalParams(a: DetectionParams, b: DetectionParams): boolean {
  return SIGNAL_PARAM_KEYS.every((k) => a[k] === b[k]) && a.sampleHz === b.sampleHz;
}

/** The newest asset of a kind for a hold. */
function newest(assets: Asset[], kind: Asset['kind']): Asset | undefined {
  return assets.filter((a) => a.kind === kind).sort((x, y) => (y.createdAt ?? '').localeCompare(x.createdAt ?? ''))[0];
}

async function freshDetection(
  a: Analysis,
  frames: StoredFrames,
): Promise<{ signals: Signals; from: 'stored' | 'recomputed'; fresh: NonNullable<ResearchAnalysis['fresh']> }> {
  const params: DetectionParams = { ...DEFAULT_PARAMS, sampleHz: a.sampleHz };
  let signals: Signals;
  let from: 'stored' | 'recomputed';
  if (sameSignalParams(a.params, params)) {
    signals = { sampleHz: a.sampleHz, m: a.m, C: a.C };
    from = 'stored';
  } else {
    signals = (await reanalyze(Math.min(a.sampleCount, frames.count), a.frameWidth, a.frameHeight, frames, params)).signals;
    from = 'recomputed';
  }
  const r = await findCandidates(signals, frames, params);
  const hz = a.sampleHz;
  const mergeInputs: NonNullable<ResearchAnalysis['fresh']>['mergeInputs'] = [];
  for (let i = 0; i < r.preMerge.length; i++) {
    for (let j = i + 1; j < r.preMerge.length; j++) {
      const x = r.preMerge[i]!;
      const y = r.preMerge[j]!;
      if (y.startS - x.endS > MERGE_INPUT_MAX_GAP_S) break;
      const diff = meanAbsDiff(await frames.frame(Math.round(x.bestS * hz)), await frames.frame(Math.round(y.bestS * hz)));
      let gapMaxM = -Infinity;
      for (let k = Math.round(x.endS * hz); k < Math.round(y.startS * hz); k++) if (signals.m[k]! > gapMaxM) gapMaxM = signals.m[k]!;
      mergeInputs.push({ a: i, b: j, diff: r4(diff), gapMaxM: Number.isFinite(gapMaxM) ? r4(gapMaxM) : null });
    }
  }
  return {
    signals,
    from,
    fresh: { threshold: r.threshold, singleStill: r.singleStill, candidates: r.candidates.map(span), preMerge: r.preMerge.map(span), mergeInputs },
  };
}

async function holdPose(still: Asset | undefined, deps: ResearchDeps): Promise<{ pose: ResearchPose | null; status: ResearchHold['poseStatus']; cropper?: string }> {
  if (!still) return { pose: null, status: 'no-still' };
  let res: PoseResult;
  try {
    res = await deps.pose(still);
  } catch {
    return { pose: null, status: 'error' };
  }
  if (res.cropper === 'none') return { pose: null, status: 'no-model', cropper: res.cropper };
  const d = res.detection;
  if (!d) return { pose: null, status: 'no-body', cropper: res.cropper };
  const aspect = res.height > 0 ? res.width / res.height : 1;
  const all = boxFromLandmarks(d.landmarks, { aspect, minVisibility: 0 });
  return {
    status: 'ok',
    cropper: res.cropper,
    pose: {
      preview: { width: res.width, height: res.height },
      posture: d.posture,
      box: bodyBox4(d.box),
      boxAll: all ? bodyBox4(all) : null,
      landmarks: d.landmarks.map(row),
      world: d.worldLandmarks ? d.worldLandmarks.map(row) : null,
    },
  };
}

export async function buildResearchExport(src: ResearchSource, deps: ResearchDeps): Promise<ResearchExport> {
  const sessionOfVideo = new Map<string, string>();
  for (const s of src.sessions) for (const v of s.videoIds) sessionOfVideo.set(v, s.id);
  const analysisOf = new Map(src.analyses.map((a) => [a.videoId, a]));
  const holdsOfVideo = new Map<string, Hold[]>();
  for (const h of src.holds) holdsOfVideo.set(h.videoId, [...(holdsOfVideo.get(h.videoId) ?? []), h]);

  const analyses: ResearchAnalysis[] = [];
  const summaries: VideoSummary[] = [];
  const fullScores: DetectionScore[] = [];
  let done = 0;
  for (const a of src.analyses) {
    deps.onProgress?.('analyses', done++, src.analyses.length);
    const full = isFullyLabeled(a);
    const sessionId = sessionOfVideo.get(a.videoId) ?? null;
    const out: ResearchAnalysis = {
      videoId: a.videoId,
      sessionId,
      fullyLabeled: full,
      params: normalizeParams(a.params),
      sampleHz: a.sampleHz,
      frameWidth: a.frameWidth,
      frameHeight: a.frameHeight,
      sampleCount: a.sampleCount,
      threshold: a.threshold,
      singleStill: a.singleStill,
      signals: null,
      candidates: a.candidates.map((c) => ({
        id: c.id,
        status: c.status,
        origin: c.origin ?? null,
        holdId: c.holdId ?? null,
        ...span(c),
      })),
      preMerge: a.preMerge.map(span),
      fresh: null,
    };
    const stored = sameSignalParams(a.params, { ...DEFAULT_PARAMS, sampleHz: a.sampleHz });
    let frames: StoredFrames | null = null;
    try {
      frames = await deps.frames(a);
    } catch {
      frames = null;
    }
    if (frames) {
      try {
        const f = await freshDetection(a, frames);
        out.fresh = f.fresh;
        out.signals = { encoding: 'float16-le-base64', from: f.from, m: encodeFloat16(f.signals.m), C: encodeFloat16(f.signals.C) };
      } catch (e) {
        out.freshError = e instanceof Error ? e.message : String(e);
      }
    } else {
      out.freshError = 'The analysis frames are not stored on this device.';
    }
    if (!out.signals && stored) out.signals = { encoding: 'float16-le-base64', from: 'stored', m: encodeFloat16(a.m), C: encodeFloat16(a.C) };
    analyses.push(out);
    let defaults: ScoreSummary | null = null;
    if (out.fresh) {
      const s = scoreDetection(out.fresh.candidates, holdsOfVideo.get(a.videoId) ?? []);
      defaults = summarizeScore(s);
      if (full) fullScores.push(s);
    }
    summaries.push({ videoId: a.videoId, sessionId, fullyLabeled: full, defaults });
  }
  deps.onProgress?.('analyses', done, src.analyses.length);

  const reps = holdReps(src.holds, src.sessions);
  const assetsOf = new Map<string, Asset[]>();
  for (const x of src.assets) assetsOf.set(x.holdId, [...(assetsOf.get(x.holdId) ?? []), x]);
  const holds: ResearchHold[] = [];
  let cropper = 'none';
  for (const [i, h] of src.holds.entries()) {
    deps.onProgress?.('poses', i, src.holds.length);
    const still = newest(assetsOf.get(h.id) ?? [], 'still');
    const p = await holdPose(still, deps);
    if (p.cropper && p.cropper !== 'none') cropper = p.cropper;
    const r = reps.get(h.id) ?? { rep: 1, of: 1 };
    holds.push({
      id: h.id,
      sessionId: h.sessionId,
      videoId: h.videoId,
      asanaId: h.asanaId,
      side: h.side,
      startS: h.startS,
      endS: h.endS,
      bestS: h.bestS,
      clipStartS: h.clipStartS,
      clipEndS: h.clipEndS,
      templateEntryIndex: h.templateEntryIndex ?? null,
      rep: r.rep,
      reps: r.of,
      crop: {
        auto: h.crop.auto ? box4(h.crop.auto) : null,
        manual: h.crop.manual ? box4(h.crop.manual) : null,
        autoVersion: h.crop.autoVersion ?? null,
      },
      still: still ? { width: still.width, height: still.height, atS: still.atS ?? null } : null,
      pose: p.pose,
      poseStatus: p.status,
    });
  }
  deps.onProgress?.('poses', src.holds.length, src.holds.length);

  const fullSessions = new Set(
    src.sessions
      .filter((s) => {
        const list = s.videoIds.map((v) => analysisOf.get(v)).filter((a): a is Analysis => !!a);
        return list.length > 0 && list.every(isFullyLabeled);
      })
      .map((s) => s.id),
  );
  return {
    format: RESEARCH_FORMAT,
    version: RESEARCH_VERSION,
    exportedAt: (deps.now ?? new Date()).toISOString(),
    app: deps.app ?? null,
    defaults: { ...DEFAULT_PARAMS },
    cropper,
    catalog: src.asanas.map((a) => ({ id: a.id, name: a.name, sided: a.sided, group: a.group ?? null, posture: a.posture ?? null })),
    templates: src.templates.map((t) => ({ id: t.id, name: t.name, entries: t.entries.map((e) => ({ ...e })) })),
    sessions: src.sessions.map((s) => ({ id: s.id, date: day(s.date), templateId: s.templateId ?? null, videoIds: [...s.videoIds], fullyLabeled: fullSessions.has(s.id) })),
    videos: src.videos.map((v) => ({ id: v.id, durationS: v.durationS, width: v.width, height: v.height, fps: v.fps, codec: v.codec, recordedAt: v.recordedAt })),
    analyses,
    holds,
    summary: { videos: summaries, fullyLabeled: fullScores.length ? summarizeScore(addScores(...fullScores)) : null },
  };
}
