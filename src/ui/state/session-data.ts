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
  latest: Hold | null;
  latestDate: string | null;
}

/** Hold count and newest hold per asana (newest by session date, then best time). */
export function asanaStats(sessions: Session[], holds: Hold[]): Map<string, AsanaStats> {
  const dateOf = new Map(sessions.map((s) => [s.id, s.date]));
  const out = new Map<string, AsanaStats>();
  for (const h of holds) {
    const d = dateOf.get(h.sessionId) ?? '';
    const cur = out.get(h.asanaId) ?? { count: 0, latest: null, latestDate: null };
    cur.count++;
    if (!cur.latest || d > (cur.latestDate ?? '') || (d === cur.latestDate && h.bestS > cur.latest.bestS)) {
      cur.latest = h;
      cur.latestDate = d;
    }
    out.set(h.asanaId, cur);
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
