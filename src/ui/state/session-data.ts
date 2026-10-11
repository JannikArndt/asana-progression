/** Pure helpers joining sessions, videos, analyses and holds (tested; no I/O). */
import type { HistoryEntry, ReviewItem } from '../../labeling';
import type { Analysis, Hold, ReviewCandidate, Session, SessionLocation, Video } from '../../model';
import type { GeoLocation } from '../../source';

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

/** Length (`sessionSpanS`) and candidate counts of a session. */
export function summarizeSession(session: Session, videos: Video[], analyses: Record<string, { candidates: ReviewCandidate[] } | undefined>): SessionSummary {
  const out: SessionSummary = { durationS: sessionSpanS(session, videos), labeled: 0, open: 0, dismissed: 0 };
  for (const id of session.videoIds) {
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
  const location = sessionCoords(target) ? target.location : (others.find((o) => sessionCoords(o))?.location ?? target.location);
  return {
    session: { ...target, videoIds: [...ordered, ...missing], note: [...new Set(notes)].join(' · '), ...(location ? { location } : {}) },
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

// ----- session length, place and preview -----

/** Longest plausible pause between the clips of one practice (beyond it, a recording time is wrong). */
export const SPAN_MAX_EXTRA_S = 4 * 3600;

/**
 * Length of a session from the start of its first video to the end of its last one (pauses
 * between clips count). Falls back to the sum of the video durations when a recording time is
 * missing or implausible (an export time or file date: the span is shorter than the videos, or
 * more than `SPAN_MAX_EXTRA_S` longer).
 */
export function sessionSpanS(session: Session, videos: Video[]): number {
  const byId = new Map(videos.map((v) => [v.id, v]));
  const list = session.videoIds.map((id) => byId.get(id)).filter((v): v is Video => !!v);
  const sum = list.reduce((s, v) => s + v.durationS, 0);
  if (list.length < 2) return sum;
  let start = Infinity;
  let end = -Infinity;
  for (const v of list) {
    const t = v.recordedAt ? Date.parse(v.recordedAt) : NaN;
    if (!Number.isFinite(t)) return sum;
    start = Math.min(start, t / 1000);
    end = Math.max(end, t / 1000 + v.durationS);
  }
  const span = end - start;
  return span >= sum - 1 && span <= sum + SPAN_MAX_EXTRA_S ? span : sum;
}

export interface LatLon {
  lat: number;
  lon: number;
}

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/**
 * Recording location from a video's metadata snapshot: `undefined` when it was never read (videos
 * imported before locations were), `null` when the file has none.
 */
export function videoLocation(video: Pick<Video, 'meta'>): GeoLocation | null | undefined {
  const meta = video.meta;
  if (!meta || !('location' in meta)) return undefined;
  const l = meta['location'] as Partial<Record<keyof GeoLocation, unknown>> | null;
  if (!l || typeof l !== 'object' || !isNum(l.lat) || !isNum(l.lon)) return null;
  return { lat: l.lat, lon: l.lon, altM: isNum(l.altM) ? l.altM : null };
}

/** Coordinates of a session, null when it has none. */
export function sessionCoords(session: Session): LatLon | null {
  const l = session.location;
  return l && isNum(l.lat) && isNum(l.lon) ? { lat: l.lat, lon: l.lon } : null;
}

/** Great-circle distance in metres (haversine, mean earth radius). */
export function distanceM(a: LatLon, b: LatLon): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Sessions closer than this were practised at the same place (a park, a shala; GPS indoors drifts). */
export const PLACE_RADIUS_M = 300;

/** Name of the nearest session with a name within `radiusM`, if any. */
export function placeNameNear(sessions: Session[], lat: number, lon: number, radiusM = PLACE_RADIUS_M): string | undefined {
  let best: { name: string; d: number } | undefined;
  for (const s of sessions) {
    const c = sessionCoords(s);
    const name = s.location?.name;
    if (!c || !name) continue;
    const d = distanceM(c, { lat, lon });
    if (d <= radiusM && (!best || d < best.d)) best = { name, d };
  }
  return best?.name;
}

/** Other sessions within `radiusM` of `session` that have coordinates but no name (a name given here applies to them too). */
export function unnamedNear(sessions: Session[], session: Session, radiusM = PLACE_RADIUS_M): Session[] {
  const c = sessionCoords(session);
  if (!c) return [];
  return sessions.filter((s) => {
    const o = sessionCoords(s);
    return s.id !== session.id && !s.location?.name && !!o && distanceM(c, o) <= radiusM;
  });
}

/** The session with this place name (trimmed; empty removes the name, coordinates stay). */
export function withPlaceName(session: Session, name: string): Session {
  const { location, ...rest } = session;
  const { name: _, ...coords } = location ?? {};
  const n = name.trim();
  const next: SessionLocation = n ? { ...coords, name: n } : coords;
  return Object.keys(next).length ? { ...rest, location: next } : rest;
}

/**
 * The session with coordinates from one of its videos, when it has none yet; without a name it
 * also gets the name of the nearest named session. Returns the same object when nothing changes.
 */
export function withCoords(session: Session, at: LatLon, sessions: Session[]): Session {
  if (sessionCoords(session)) return session;
  const name = session.location?.name ?? placeNameNear(sessions, at.lat, at.lon);
  return { ...session, location: { ...(name ? { name } : {}), lat: at.lat, lon: at.lon } };
}

/** Distinct place names for suggestions: nearest first when coordinates are given, else most used first. */
export function placeNames(sessions: Session[], near?: LatLon | null): string[] {
  const stats = new Map<string, { count: number; d: number }>();
  for (const s of sessions) {
    const name = s.location?.name;
    if (!name) continue;
    const c = sessionCoords(s);
    const cur = stats.get(name) ?? { count: 0, d: Infinity };
    stats.set(name, { count: cur.count + 1, d: Math.min(cur.d, near && c ? distanceM(near, c) : Infinity) });
  }
  const byDistance = (a: { d: number }, b: { d: number }) => (a.d === b.d ? 0 : a.d - b.d);
  return [...stats]
    .sort(([an, a], [bn, b]) => (near ? byDistance(a, b) : 0) || b.count - a.count || an.localeCompare(bn))
    .map(([name]) => name);
}

/** "52.5200° N, 13.4050° E" */
export function formatCoords(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(4)}° ${lat < 0 ? 'S' : 'N'}, ${Math.abs(lon).toFixed(4)}° ${lon < 0 ? 'W' : 'E'}`;
}

/** How a session's place reads: its name, else its coordinates; null when unknown. */
export function placeLabel(session: Session): string | null {
  if (session.location?.name) return session.location.name;
  const c = sessionCoords(session);
  return c ? formatCoords(c.lat, c.lon) : null;
}

/**
 * The session's picture in the list: of its holds with a captured image (`captured`), the one
 * nearest the middle of the session (session order: video order, then best frame). Null if none.
 */
export function sessionPreview(session: Session, holds: Hold[], captured: ReadonlySet<string>): Hold | null {
  const order = new Map(session.videoIds.map((id, i) => [id, i]));
  const list = holds
    .filter((h) => h.sessionId === session.id)
    .sort((a, b) => (order.get(a.videoId) ?? order.size) - (order.get(b.videoId) ?? order.size) || a.bestS - b.bestS);
  const middle = (list.length - 1) / 2;
  let best: Hold | null = null;
  let bestD = Infinity;
  list.forEach((h, i) => {
    const d = Math.abs(i - middle);
    if (captured.has(h.id) && d < bestD) {
      best = h;
      bestD = d;
    }
  });
  return best;
}

/** Fallback picture without captured images: the analysis frame in the middle of the session's longest analysed video. */
export function sessionTinyFrame(session: Session, summaries: Record<string, { sampleCount: number } | undefined>): { videoId: string; index: number } | null {
  let best: { videoId: string; count: number } | null = null;
  for (const id of session.videoIds) {
    const n = summaries[id]?.sampleCount ?? 0;
    if (n > 0 && (!best || n > best.count)) best = { videoId: id, count: n };
  }
  return best ? { videoId: best.videoId, index: Math.floor(best.count / 2) } : null;
}
