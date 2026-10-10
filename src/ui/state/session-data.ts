/** Pure helpers joining sessions, videos, analyses and holds (tested; no I/O). */
import type { HistoryEntry, ReviewItem } from '../../labeling';
import type { Analysis, Hold, ReviewCandidate, Session, Video } from '../../model';

export function dayOf(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : '';
}

/** Session of a video, if any. */
export function sessionOfVideo(sessions: Session[], videoId: string): Session | undefined {
  return sessions.find((s) => s.videoIds.includes(videoId));
}

export function itemKey(videoId: string, candidateId: string): string {
  return `${videoId}/${candidateId}`;
}

export function parseItemKey(key: string): { videoId: string; candidateId: string } {
  const i = key.indexOf('/');
  return { videoId: key.slice(0, i), candidateId: key.slice(i + 1) };
}

export interface SessionEntry {
  key: string;
  videoId: string;
  candidate: ReviewCandidate;
  hold: Hold | undefined;
}

/** Candidates of a session in review order: videos in session order, then by start time. */
export function sessionEntries(session: Session, analyses: Record<string, Analysis | undefined>, holds: Hold[]): SessionEntry[] {
  const byId = new Map(holds.map((h) => [h.id, h]));
  const out: SessionEntry[] = [];
  for (const videoId of session.videoIds) {
    const a = analyses[videoId];
    if (!a) continue;
    const sorted = [...a.candidates].sort((x, y) => x.startS - y.startS);
    for (const c of sorted) out.push({ key: itemKey(videoId, c.id), videoId, candidate: c, hold: c.holdId ? byId.get(c.holdId) : undefined });
  }
  return out;
}

export function toReviewItems(entries: SessionEntry[]): ReviewItem[] {
  return entries.map(({ key, candidate, hold }) => {
    if (candidate.status === 'labeled' && hold) {
      return {
        key,
        status: 'labeled',
        label: {
          asanaId: hold.asanaId,
          side: hold.side,
          ...(hold.templateEntryIndex !== undefined ? { templateEntryIndex: hold.templateEntryIndex } : {}),
        },
      };
    }
    return { key, status: candidate.status === 'dismissed' ? 'dismissed' : 'open' };
  });
}

/** Holds of all sessions except `excludeSessionId`, as suggestion history. */
export function historyFrom(sessions: Session[], holds: Hold[], excludeSessionId: string): HistoryEntry[] {
  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const out: HistoryEntry[] = [];
  const bySession = new Map<string, Hold[]>();
  for (const h of holds) {
    if (h.sessionId === excludeSessionId || !sessionById.has(h.sessionId)) continue;
    const list = bySession.get(h.sessionId) ?? [];
    list.push(h);
    bySession.set(h.sessionId, list);
  }
  for (const [sid, list] of bySession) {
    const s = sessionById.get(sid)!;
    list.sort((a, b) => s.videoIds.indexOf(a.videoId) - s.videoIds.indexOf(b.videoId) || a.startS - b.startS);
    list.forEach((h, order) => out.push({ asanaId: h.asanaId, side: h.side, date: s.date, sessionId: sid, order }));
  }
  return out;
}

export interface AsanaStats {
  count: number;
  /** Distinct practice days (session dates). */
  days: number;
  latest: Hold | null;
  latestDate: string | null;
  /** Newest hold with a captured image (`captured`), else the newest hold: the list's preview. */
  preview: Hold | null;
}

/**
 * Hold count, practice days and newest hold per asana (newest by session date, then best time).
 * `captured` = ids of holds with a captured still or thumbnail.
 */
export function asanaStats(sessions: Session[], holds: Hold[], captured: ReadonlySet<string> = new Set()): Map<string, AsanaStats> {
  const dateOf = new Map(sessions.map((s) => [s.id, s.date]));
  const newer = (h: Hold, d: string, than: Hold | null, thanDate: string) => !than || d > thanDate || (d === thanDate && h.bestS > than.bestS);
  const out = new Map<string, AsanaStats>();
  const days = new Map<string, Set<string>>();
  const previewDate = new Map<string, string>();
  for (const h of holds) {
    const d = dateOf.get(h.sessionId) ?? '';
    const cur = out.get(h.asanaId) ?? { count: 0, days: 0, latest: null, latestDate: null, preview: null };
    cur.count++;
    if (newer(h, d, cur.latest, cur.latestDate ?? '')) {
      cur.latest = h;
      cur.latestDate = d;
    }
    if (captured.has(h.id) && newer(h, d, cur.preview, previewDate.get(h.asanaId) ?? '')) {
      cur.preview = h;
      previewDate.set(h.asanaId, d);
    }
    const set = days.get(h.asanaId) ?? new Set<string>();
    set.add(dayOf(d));
    days.set(h.asanaId, set);
    out.set(h.asanaId, cur);
  }
  for (const [id, st] of out) {
    st.days = days.get(id)!.size;
    st.preview ??= st.latest;
  }
  return out;
}

export interface SessionSummary {
  durationS: number;
  labeled: number;
  open: number;
  dismissed: number;
}

export function summarizeSession(session: Session, videos: Video[], analyses: Record<string, { candidates: ReviewCandidate[] } | undefined>): SessionSummary {
  const out: SessionSummary = { durationS: 0, labeled: 0, open: 0, dismissed: 0 };
  for (const id of session.videoIds) {
    out.durationS += videos.find((v) => v.id === id)?.durationS ?? 0;
    for (const c of analyses[id]?.candidates ?? []) out[c.status === 'labeled' ? 'labeled' : c.status === 'dismissed' ? 'dismissed' : 'open']++;
  }
  return out;
}

/** Sessions to create for videos that are in no session (data from milestone 1). */
export function orphanVideos(sessions: Session[], videos: Video[]): Video[] {
  const inSession = new Set(sessions.flatMap((s) => s.videoIds));
  return videos.filter((v) => !inSession.has(v.id));
}

/** Videos shorter than this default to no template (single-asana clips). */
export const SHORT_CLIP_S = 5 * 60;

/** Video order inside a session: recording time, then file name with numeric awareness ("4 …" < "10 …"). */
export function compareVideos(a: Video, b: Video): number {
  return (a.recordedAt ?? '').localeCompare(b.recordedAt ?? '') || a.fileName.localeCompare(b.fileName, undefined, { numeric: true });
}

/** Session video ids in recording order (clips "4 …" before "10 …"); unknown ids keep their place at the end. */
export function orderVideoIds(ids: string[], videos: Video[]): string[] {
  const byId = new Map(videos.map((v) => [v.id, v]));
  const known = ids.filter((id) => byId.has(id)).sort((a, b) => compareVideos(byId.get(a)!, byId.get(b)!));
  return [...new Set([...known, ...ids.filter((id) => !byId.has(id))])];
}

/** Groups videos by recording day (videos without a date use their import day). */
export function groupByDay(videos: Video[]): Map<string, Video[]> {
  const out = new Map<string, Video[]>();
  for (const v of [...videos].sort(compareVideos)) {
    const d = dayOf(v.recordedAt ?? v.importedAt);
    const list = out.get(d) ?? [];
    list.push(v);
    out.set(d, list);
  }
  return out;
}

/** Other sessions recorded on the same day as `session`. */
export function sameDaySessions(sessions: Session[], session: Session): Session[] {
  const d = dayOf(session.date);
  return sessions.filter((s) => s.id !== session.id && dayOf(s.date) === d);
}

/**
 * Combines sessions into `target`: video ids are merged and ordered, holds move to the target.
 * Returns the updated target, the holds to rewrite and the session ids to delete.
 */
export function combineSessions(
  target: Session,
  others: Session[],
  videos: Video[],
  holds: Hold[],
): { session: Session; holds: Hold[]; deleteIds: string[] } {
  const ids = new Set([...target.videoIds, ...others.flatMap((s) => s.videoIds)]);
  const ordered = videos.filter((v) => ids.has(v.id)).sort(compareVideos).map((v) => v.id);
  const missing = [...ids].filter((id) => !ordered.includes(id));
  const otherIds = new Set(others.map((s) => s.id));
  const notes = [target.note, ...others.map((s) => s.note)].filter(Boolean);
  return {
    session: { ...target, videoIds: [...ordered, ...missing], note: [...new Set(notes)].join(' · ') },
    holds: holds.filter((h) => otherIds.has(h.sessionId)).map((h) => ({ ...h, sessionId: target.id })),
    deleteIds: [...otherIds],
  };
}

/**
 * Which uncovered stretches get a row between the review cards. A gap always counts from
 * `GAP_ALWAYS_S`; shorter ones (down to `GAP_MIN_S`) only when they are clearly longer than the
 * usual way from one hold to the next in this video (`GAP_TYPICAL_FACTOR` × the median gap).
 * In the labeled 67 min primary series the median gap is 19 s (vinyasas), so 10 s would show a
 * row after most cards; a missed hold leaves a gap of two transitions plus the hold (≥ ~40 s).
 */
export const GAP_MIN_S = 10;
export const GAP_ALWAYS_S = 30;
export const GAP_TYPICAL_FACTOR = 1.5;

/** Minimum length of a noteworthy gap for these spans (start order), see `GAP_MIN_S`. */
export function gapThreshold(spans: ReadonlyArray<{ startS: number; endS: number }>): number {
  const gaps: number[] = [];
  let covered = -Infinity;
  for (const s of spans) {
    if (s.startS > covered && covered > -Infinity) gaps.push(s.startS - covered);
    covered = Math.max(covered, s.endS);
  }
  if (gaps.length < 5) return GAP_MIN_S;
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)]!;
  return Math.min(GAP_ALWAYS_S, Math.max(GAP_MIN_S, GAP_TYPICAL_FACTOR * median));
}

export interface CoverageGap {
  startS: number;
  endS: number;
  /** Index of the span that follows the gap (`spans.length` after the last one). */
  beforeIndex: number;
}

/**
 * Stretches of a video (0…durationS) covered by no span, at least `minS` long (default:
 * `gapThreshold`). `spans` are in
 * start order (as `sessionEntries`). Callers pass every candidate, dismissed ones included: the
 * user has looked at those, so they count as covered.
 */
export function coverageGaps(spans: ReadonlyArray<{ startS: number; endS: number }>, durationS: number, minS = gapThreshold(spans)): CoverageGap[] {
  const out: CoverageGap[] = [];
  let covered = 0;
  spans.forEach((s, i) => {
    if (s.startS - covered >= minS) out.push({ startS: covered, endS: s.startS, beforeIndex: i });
    covered = Math.max(covered, s.endS);
  });
  if (durationS - covered >= minS) out.push({ startS: covered, endS: durationS, beforeIndex: spans.length });
  return out;
}
