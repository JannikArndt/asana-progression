/**
 * Loads the research export (research/data/research.json) and the lab run for the scripts in
 * research/. Sessions are labelled S1, S2, … in date order (ids stay in the data).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DetectionParams, Signals } from '../../src/detection';
import { decodeFloat16 } from '../../src/ui/research/float16';
import type { ResearchAnalysis, ResearchExport, ResearchHold } from '../../src/ui/research/export';
import type { LabReport } from '../../src/ui/research/lab';

export const DATA_DIR = join(import.meta.dirname, '..', 'data');

export interface VideoData {
  videoId: string;
  sessionId: string;
  session: string;
  /** Position of the video in its session (0-based). */
  order: number;
  durationS: number;
  width: number;
  height: number;
  analysis: ResearchAnalysis;
  signals: Signals;
  /** Labeled holds of this video, by start. */
  holds: ResearchHold[];
}

export interface SessionData {
  id: string;
  label: string;
  date: string;
  templateId: string | null;
  videos: VideoData[];
  /** Holds of the session in order (videos in session order, then start). */
  holds: ResearchHold[];
}

export interface Dataset {
  raw: ResearchExport;
  sessions: SessionData[];
  videos: VideoData[];
  name(asanaId: string): string;
  label(h: Pick<ResearchHold, 'asanaId' | 'side'>): string;
}

export function loadResearch(file = 'research.json'): Dataset {
  const raw = JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8')) as ResearchExport;
  const names = new Map(raw.catalog.map((a) => [a.id, a.name]));
  const sessionsSorted = [...raw.sessions].sort((a, b) => a.date.localeCompare(b.date));
  const sessions: SessionData[] = [];
  const videos: VideoData[] = [];
  sessionsSorted.forEach((s, si) => {
    const sd: SessionData = { id: s.id, label: `S${si + 1}`, date: s.date, templateId: s.templateId, videos: [], holds: [] };
    s.videoIds.forEach((videoId, order) => {
      const a = raw.analyses.find((x) => x.videoId === videoId);
      const v = raw.videos.find((x) => x.id === videoId);
      if (!a || !v || !a.signals) return;
      const holds = raw.holds.filter((h) => h.videoId === videoId).sort((x, y) => x.startS - y.startS);
      const vd: VideoData = {
        videoId,
        sessionId: s.id,
        session: sd.label,
        order,
        durationS: v.durationS,
        width: v.width,
        height: v.height,
        analysis: a,
        signals: { sampleHz: a.sampleHz, m: decodeFloat16(a.signals.m), C: decodeFloat16(a.signals.C) },
        holds,
      };
      sd.videos.push(vd);
      videos.push(vd);
      sd.holds.push(...holds);
    });
    sessions.push(sd);
  });
  return {
    raw,
    sessions,
    videos,
    name: (id) => names.get(id) ?? id,
    label: (h) => `${names.get(h.asanaId) ?? h.asanaId}${h.side ? ` ${h.side}` : ''}`,
  };
}

export function loadLab(file: string): LabReport {
  return JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8')) as LabReport;
}

export type { DetectionParams };

/** Markdown table. */
export function table(head: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const cell = (v: string | number | null | undefined) => (v === null || v === undefined ? '–' : String(v));
  return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');
}

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)} %` : '–');

/**
 * Frame access for replays without frames: the similar-merge's distances come from the exported
 * merge inputs, keyed by the sample indices of the fresh pre-merge best frames. Exact as long as
 * the pre-merge runs are the defaults' (only merge parameters vary); throws for an unknown pair.
 * With `nearest`, an unknown frame maps to the best frame of the default pre-merge run that holds it
 * (or the nearest) — an estimate for screening run changes, never for decisions.
 */
export function exportedFrames(v: VideoData, opts: { nearest?: boolean } = {}): import('../../src/detection').FrameAccess & { misses: number } {
  const f = v.analysis.fresh!;
  const hz = v.signals.sampleHz;
  const best = f.preMerge.map((p) => Math.round(p.bestS * hz));
  const pieceOf = new Map(best.map((b, i) => [b, i]));
  const dist = new Map<string, number>();
  for (const mi of f.mergeInputs) {
    dist.set(`${best[mi.a]}:${best[mi.b]}`, mi.diff);
    dist.set(`${best[mi.b]}:${best[mi.a]}`, mi.diff);
  }
  const nearestPiece = (i: number) => {
    let bi = 0;
    let bd = Infinity;
    f.preMerge.forEach((p, k) => {
      const s = Math.round(p.startS * hz);
      const e = Math.round(p.endS * hz);
      const d = i < s ? s - i : i >= e ? i - e + 1 : 0;
      if (d < bd) ((bd = d), (bi = k));
    });
    return bi;
  };
  const access = {
    misses: 0,
    frame(): Uint8Array {
      throw new Error('Frames are not part of the research export');
    },
    distance(a: number, b: number): number {
      if (a === b) return 0;
      const known = dist.get(`${a}:${b}`);
      if (known !== undefined) return known;
      if (!opts.nearest) throw new Error(`No exported distance for samples ${a} and ${b}`);
      access.misses++;
      const pa = pieceOf.get(a) ?? nearestPiece(a);
      const pb = pieceOf.get(b) ?? nearestPiece(b);
      if (pa === pb) return 0;
      return dist.get(`${best[pa]}:${best[pb]}`) ?? Infinity;
    },
  };
  return access;
}
