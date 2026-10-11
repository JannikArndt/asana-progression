import { describe, expect, it } from 'vitest';
import {
  asanaStats,
  combineSessions,
  compareVideos,
  coverageGaps,
  GAP_ALWAYS_S,
  GAP_MIN_S,
  gapThreshold,
  orderVideoIds,
  dayOf,
  groupByDay,
  historyFrom,
  itemKey,
  orphanVideos,
  parseItemKey,
  sameDaySessions,
  sessionEntries,
  sessionOfVideo,
  summarizeSession,
  toReviewItems,
  sessionSpanS,
  videoLocation,
  distanceM,
  placeNameNear,
  unnamedNear,
  withPlaceName,
  withCoords,
  placeNames,
  formatCoords,
  placeLabel,
  sessionCoords,
  sessionPreview,
  sessionTinyFrame,
} from './session-data';
import type { Analysis, Hold, ReviewCandidate, Session, Video } from '../../model';
import { DEFAULT_PARAMS } from '../../detection';

const cand = (id: string, startS: number, status: ReviewCandidate['status'] = 'open', holdId?: string): ReviewCandidate => ({
  id, startS, endS: startS + 10, bestS: startS + 5, alternatesS: [], clipStartS: startS, clipEndS: startS + 4, status, ...(holdId ? { holdId } : {}),
});
const analysis = (videoId: string, candidates: ReviewCandidate[]): Analysis => ({
  videoId, params: { ...DEFAULT_PARAMS }, sampleHz: 4, frameWidth: 8, frameHeight: 4, sampleCount: 1, m: new Float32Array(1), C: new Float32Array(1),
  threshold: 1, singleStill: false, candidates, preMerge: [], createdAt: '', stats: null,
});
const hold = (id: string, sessionId: string, videoId: string, asanaId: string, startS: number, side: Hold['side'] = null, templateEntryIndex?: number): Hold => ({
  id, sessionId, videoId, asanaId, side, startS, endS: startS + 10, bestS: startS + 5, clipStartS: startS, clipEndS: startS + 4, crop: {},
  ...(templateEntryIndex !== undefined ? { templateEntryIndex } : {}),
});
const video = (id: string, durationS: number): Video => ({ id, fingerprint: id, fileName: id, fileSize: 1, durationS, codec: null, width: 1, height: 1, fps: null, recordedAt: null, importedAt: '' });

const s1: Session = { id: 's1', date: '2026-10-01T07:00:00+02:00', note: '', videoIds: ['v1', 'v2'] };
const s2: Session = { id: 's2', date: '2026-10-05T07:00:00+02:00', note: '', videoIds: ['v3'] };

describe('session data', () => {
  it('orders entries by video then time and joins holds', () => {
    const analyses = {
      v1: analysis('v1', [cand('b', 50), cand('a', 10, 'labeled', 'h1')]),
      v2: analysis('v2', [cand('c', 5, 'dismissed')]),
    };
    const holds = [hold('h1', 's1', 'v1', 'navasana', 10, null, 40)];
    const entries = sessionEntries(s1, analyses, holds);
    expect(entries.map((e) => e.key)).toEqual(['v1/a', 'v1/b', 'v2/c']);
    expect(entries[0]!.hold?.id).toBe('h1');
    const items = toReviewItems(entries);
    expect(items).toEqual([
      { key: 'v1/a', status: 'labeled', label: { asanaId: 'navasana', side: null, templateEntryIndex: 40 } },
      { key: 'v1/b', status: 'open' },
      { key: 'v2/c', status: 'dismissed' },
    ]);
    // labeled without a hold record is treated as open
    expect(toReviewItems(sessionEntries(s1, { v1: analysis('v1', [cand('x', 1, 'labeled', 'missing')]) }, []))[0]!.status).toBe('open');
    expect(toReviewItems([{ key: 'k', videoId: 'v', candidate: cand('y', 1, 'labeled', 'h'), hold: hold('h', 's', 'v', 'a', 1) }])[0]!.label).toEqual({ asanaId: 'a', side: null });
  });

  it('builds history from other sessions in order', () => {
    const holds = [hold('h2', 's1', 'v2', 'balasana', 1), hold('h1', 's1', 'v1', 'sirsasana-a', 100), hold('h3', 's2', 'v3', 'navasana', 1), hold('hx', 'gone', 'v9', 'x', 1)];
    const h = historyFrom([s1, s2], holds, 's2');
    expect(h.map((e) => [e.asanaId, e.order, e.date])).toEqual([
      ['sirsasana-a', 0, s1.date],
      ['balasana', 1, s1.date],
    ]);
  });

  it('computes asana stats with the newest hold', () => {
    const holds = [hold('a', 's1', 'v1', 'navasana', 1), hold('b', 's2', 'v3', 'navasana', 1), hold('c', 's2', 'v3', 'navasana', 50), hold('d', 's1', 'v1', 'balasana', 1)];
    const st = asanaStats([s1, s2], holds);
    expect(st.get('navasana')).toMatchObject({ count: 3, latestDate: s2.date });
    expect(st.get('navasana')!.latest!.id).toBe('c');
    expect(st.get('balasana')!.count).toBe(1);
    expect(asanaStats([], [hold('z', 'nope', 'v', 'q', 1)]).get('q')!.latestDate).toBe('');
  });

  it('counts practice days and previews the newest captured hold', () => {
    const sameDay: Session = { ...s1, id: 's3', date: '2026-10-01T18:00:00+02:00' };
    const holds = [
      hold('a', 's1', 'v1', 'navasana', 1),
      hold('b', 's3', 'v4', 'navasana', 1),
      hold('c', 's2', 'v3', 'navasana', 50),
      hold('e', 's2', 'v3', 'navasana', 10),
      hold('d', 's1', 'v1', 'balasana', 1),
      hold('f', 's1', 'v1', 'balasana', 9),
    ];
    const st = asanaStats([s1, s2, sameDay], holds, new Set(['a', 'b', 'e']));
    expect(st.get('navasana')).toMatchObject({ count: 4, days: 2 });
    // The newest hold ('c') has no image yet: the newest one that has wins.
    expect(st.get('navasana')!.latest!.id).toBe('c');
    expect(st.get('navasana')!.preview!.id).toBe('e');
    // Nothing captured: the newest hold (its analysis frame).
    expect(st.get('balasana')).toMatchObject({ count: 2, days: 1 });
    expect(st.get('balasana')!.preview!.id).toBe('f');
    expect(asanaStats([s1, s2, sameDay], holds, new Set(['a', 'b'])).get('navasana')!.preview!.id).toBe('b');
  });

  it('summarizes sessions and finds orphans', () => {
    const sum = summarizeSession(s1, [video('v1', 100), video('v2', 50)], { v1: { candidates: [cand('a', 1, 'labeled'), cand('b', 2)] }, v2: { candidates: [cand('c', 1, 'dismissed')] } });
    expect(sum).toEqual({ durationS: 150, labeled: 1, open: 1, dismissed: 1 });
    expect(summarizeSession(s2, [], {})).toEqual({ durationS: 0, labeled: 0, open: 0, dismissed: 0 });
    expect(orphanVideos([s1], [video('v1', 1), video('v9', 1)]).map((v) => v.id)).toEqual(['v9']);
  });

  it('small helpers', () => {
    expect(dayOf('2026-10-05T07:00:00+02:00')).toBe('2026-10-05');
    expect(dayOf(null)).toBe('');
    expect(parseItemKey(itemKey('vid_1', 'cand-12'))).toEqual({ videoId: 'vid_1', candidateId: 'cand-12' });
    expect(sessionOfVideo([s1, s2], 'v3')?.id).toBe('s2');
  });
});

describe('same-day sessions', () => {
  const v = (id: string, fileName: string, recordedAt: string | null, importedAt = '2026-10-07T10:00:00Z'): Video => ({
    ...video(id, 10),
    fileName,
    recordedAt,
    importedAt,
  });
  const clips = [
    v('a', '7 Sarvangasana.mp4', '2025-08-28T18:04:43+02:00'),
    v('b', '4 Ubhaya.mp4', '2025-08-28T18:04:43+02:00'),
    v('c', '10 Savasana.mp4', '2025-08-28T18:04:43+02:00'),
    v('d', 'other.mp4', '2025-08-29T07:00:00+02:00'),
    v('e', 'nodate.mp4', null, '2026-01-02T03:04:05Z'),
  ];

  it('orders videos by time, then numerically by name', () => {
    expect([...clips].sort(compareVideos).map((x) => x.id)).toEqual(['e', 'b', 'a', 'c', 'd']);
  });

  it('groups by recording day', () => {
    const g = groupByDay(clips);
    expect(g.get('2025-08-28')!.map((x) => x.id)).toEqual(['b', 'a', 'c']);
    expect(g.get('2026-01-02')!.map((x) => x.id)).toEqual(['e']);
  });

  it('finds and combines same-day sessions', () => {
    const t: Session = { id: 't', date: '2025-08-28T18:04:43+02:00', note: 'warm', videoIds: ['a'], templateId: 'primary-series' };
    const o1: Session = { id: 'o1', date: '2025-08-28T18:04:43+02:00', note: '', videoIds: ['b'] };
    const o2: Session = { id: 'o2', date: '2025-08-28T19:00:00+02:00', note: 'tired', videoIds: ['c', 'zz'] };
    const other: Session = { id: 'x', date: '2025-08-29T07:00:00+02:00', note: '', videoIds: ['d'] };
    expect(sameDaySessions([t, o1, o2, other], t).map((s) => s.id)).toEqual(['o1', 'o2']);
    const holds = [hold('h1', 'o1', 'b', 'ubhaya-padangusthasana', 1), hold('h2', 't', 'a', 'salamba-sarvangasana', 1), hold('h3', 'x', 'd', 'navasana', 1)];
    const r = combineSessions(t, [o1, o2], clips, holds);
    expect(r.session).toMatchObject({ id: 't', videoIds: ['b', 'a', 'c', 'zz'], note: 'warm · tired', templateId: 'primary-series' });
    expect(r.holds).toEqual([{ ...holds[0], sessionId: 't' }]);
    expect(r.deleteIds).toEqual(['o1', 'o2']);
  });

  it('keeps a place when combining', () => {
    const t: Session = { id: 't', date: '', note: '', videoIds: [] };
    const o: Session = { id: 'o', date: '', note: '', videoIds: [], location: { name: 'Park', lat: 1, lon: 2 } };
    expect(combineSessions(t, [o], [], []).session.location).toEqual({ name: 'Park', lat: 1, lon: 2 });
    expect(combineSessions({ ...t, location: { lat: 3, lon: 4 } }, [o], [], []).session.location).toEqual({ lat: 3, lon: 4 });
    expect(combineSessions({ ...t, location: { name: 'Home' } }, [{ ...o, location: { name: 'Park' } }], [], []).session.location).toEqual({ name: 'Home' });
    expect('location' in combineSessions(t, [], [], []).session).toBe(false);
  });
});

describe('orderVideoIds', () => {
  it('sorts by recording time, then numeric file name, keeping unknown ids last', () => {
    const v = (id: string, fileName: string, recordedAt = '2025-08-28T18:04:43+02:00') =>
      ({ id, fileName, recordedAt, fingerprint: id, fileSize: 1, durationS: 1, codec: null, width: 1, height: 1, fps: null, importedAt: '' }) as Video;
    const videos = [v('a', '10 Savasana.mp4'), v('b', '4 Ubhaya.mp4'), v('c', '7 Sarvangasana.mp4')];
    expect(orderVideoIds(['a', 'x', 'c', 'b'], videos)).toEqual(['b', 'c', 'a', 'x']);
    expect(orderVideoIds(['b', 'b'], videos)).toEqual(['b']);
  });
});

describe('coverageGaps', () => {
  const span = (startS: number, endS: number) => ({ startS, endS });
  it('lists uncovered stretches before, between and after the spans', () => {
    expect(coverageGaps([span(12, 40), span(45, 80), span(95, 120)], 150)).toEqual([
      { startS: 0, endS: 12, beforeIndex: 0 },
      { startS: 80, endS: 95, beforeIndex: 2 },
      { startS: 120, endS: 150, beforeIndex: 3 },
    ]);
  });
  it('skips short gaps and handles overlapping spans', () => {
    expect(GAP_MIN_S).toBe(10);
    // The second span lies inside the first: coverage continues to 60.
    expect(coverageGaps([span(5, 60), span(10, 20), span(65, 100)], 104)).toEqual([]);
    expect(coverageGaps([span(5, 60), span(10, 20), span(75, 100)], 104)).toEqual([{ startS: 60, endS: 75, beforeIndex: 2 }]);
    expect(coverageGaps([span(0, 30)], 45, 15)).toEqual([{ startS: 30, endS: 45, beforeIndex: 1 }]);
  });
  it('adapts the threshold to the usual gap between holds', () => {
    // Five 20 s gaps: only gaps of at least 30 s count.
    const spans = [0, 50, 100, 150, 200, 250].map((t) => span(t, t + 30));
    expect(gapThreshold(spans)).toBe(GAP_ALWAYS_S);
    expect(coverageGaps(spans, 300)).toEqual([]);
    expect(coverageGaps([...spans, span(330, 340)], 340)).toEqual([{ startS: 280, endS: 330, beforeIndex: 6 }]);
    // Short gaps (4 s): the 10 s floor.
    expect(gapThreshold([0, 10, 20, 30, 40, 50].map((t) => span(t, t + 6)))).toBe(GAP_MIN_S);
    // In between: 1.5 × the median (12 s → 18 s); overlapping spans add no gap.
    expect(gapThreshold([0, 20, 40, 60, 80, 100].map((t) => span(t, t + 8)).concat(span(101, 105)))).toBe(18);
    expect(gapThreshold([span(0, 10)])).toBe(GAP_MIN_S);
  });
  it('is the whole video without spans', () => {
    expect(coverageGaps([], 30)).toEqual([{ startS: 0, endS: 30, beforeIndex: 0 }]);
    expect(coverageGaps([], 5)).toEqual([]);
  });
});

describe('sessionSpanS', () => {
  const at = (id: string, durationS: number, recordedAt: string | null): Video => ({ ...video(id, durationS), recordedAt });
  const ses = (...ids: string[]): Session => ({ id: 's', date: '', note: '', videoIds: ids });

  it('is a single video’s duration, or 0 without videos', () => {
    expect(sessionSpanS(ses('a'), [at('a', 90, '2026-10-01T07:00:00+02:00')])).toBe(90);
    expect(sessionSpanS(ses('x'), [])).toBe(0);
  });

  it('runs from the first start to the last end (pauses count, offsets respected)', () => {
    const vs = [at('a', 600, '2026-10-01T07:00:00+02:00'), at('b', 300, '2026-10-01T05:15:00Z')];
    expect(sessionSpanS(ses('a', 'b'), vs)).toBe(20 * 60);
    expect(summarizeSession(ses('a', 'b'), vs, {}).durationS).toBe(20 * 60);
  });

  it('falls back to the sum for missing or implausible recording times', () => {
    expect(sessionSpanS(ses('a', 'b'), [at('a', 600, '2026-10-01T07:00:00Z'), at('b', 300, null)])).toBe(900);
    expect(sessionSpanS(ses('a', 'b'), [at('a', 600, '2026-10-01T07:00:00Z'), at('b', 300, 'garbage')])).toBe(900);
    // Overlapping (export times a few seconds apart): shorter than the videos.
    expect(sessionSpanS(ses('a', 'b'), [at('a', 600, '2026-10-01T07:00:00Z'), at('b', 300, '2026-10-01T07:00:05Z')])).toBe(900);
    // A file date days later.
    expect(sessionSpanS(ses('a', 'b'), [at('a', 600, '2026-10-01T07:00:00Z'), at('b', 300, '2026-10-03T07:00:00Z')])).toBe(900);
    // Back to back within a second is fine.
    expect(sessionSpanS(ses('a', 'b'), [at('a', 600, '2026-10-01T07:00:00Z'), at('b', 300, '2026-10-01T07:09:59.500Z')])).toBe(899.5);
  });
});

describe('places', () => {
  const berlin = { lat: 52.52, lon: 13.405 };
  const placed = (id: string, location?: Session['location']): Session => ({ id, date: '', note: '', videoIds: [], ...(location ? { location } : {}) });
  // ≈ 111.2 km per degree of latitude.
  const north = (m: number) => ({ lat: berlin.lat + m / 111_195, lon: berlin.lon });

  it('reads video locations defensively', () => {
    expect(videoLocation({})).toBeUndefined();
    expect(videoLocation({ meta: { fileName: 'x' } })).toBeUndefined();
    expect(videoLocation({ meta: { location: null } })).toBeNull();
    expect(videoLocation({ meta: { location: { lat: '1', lon: 2 } } })).toBeNull();
    expect(videoLocation({ meta: { location: 'present' } })).toBeNull();
    expect(videoLocation({ meta: { location: { lat: 1, lon: 2 } } })).toEqual({ lat: 1, lon: 2, altM: null });
    expect(videoLocation({ meta: { location: { lat: 1, lon: 2, altM: 30 } } })).toEqual({ lat: 1, lon: 2, altM: 30 });
  });

  it('measures distances', () => {
    expect(distanceM(berlin, berlin)).toBe(0);
    expect(distanceM(berlin, north(250))).toBeCloseTo(250, 0);
    // Berlin → Paris ≈ 878 km
    expect(distanceM(berlin, { lat: 48.8566, lon: 2.3522 }) / 1000).toBeCloseTo(878, -1);
  });

  it('finds the nearest named session within the radius', () => {
    const sessions = [placed('a', { name: 'Park', ...north(200) }), placed('b', { name: 'Shala', ...north(50) }), placed('c', { ...north(10) }), placed('d', { name: 'No coords' })];
    expect(placeNameNear(sessions, berlin.lat, berlin.lon)).toBe('Shala');
    expect(placeNameNear(sessions, north(450).lat, berlin.lon)).toBe('Park');
    expect(placeNameNear(sessions, north(800).lat, berlin.lon)).toBeUndefined();
    expect(placeNameNear(sessions, north(800).lat, berlin.lon, 1000)).toBe('Park');
  });

  it('lists unnamed sessions nearby', () => {
    const me = placed('me', { name: 'Park', ...berlin });
    const sessions = [me, placed('a', north(100)), placed('b', { name: 'X', ...north(100) }), placed('c', north(500)), placed('d')];
    expect(unnamedNear(sessions, me).map((s) => s.id)).toEqual(['a']);
    expect(unnamedNear(sessions, placed('nowhere'))).toEqual([]);
  });

  it('sets and removes place names, keeping coordinates', () => {
    const s = placed('s', { ...berlin });
    expect(withPlaceName(s, '  Park ').location).toEqual({ ...berlin, name: 'Park' });
    expect(withPlaceName(withPlaceName(s, 'Park'), '').location).toEqual(berlin);
    expect('location' in withPlaceName(placed('n', { name: 'Old' }), ' ')).toBe(false);
    expect(withPlaceName(placed('n'), 'New').location).toEqual({ name: 'New' });
  });

  it('adds coordinates once, with a nearby name', () => {
    const named = placed('a', { name: 'Park', ...north(100) });
    const s = placed('s');
    const located = withCoords(s, berlin, [named]);
    expect(located.location).toEqual({ name: 'Park', ...berlin });
    expect(withCoords(located, north(5000), [named])).toBe(located);
    expect(withCoords(placed('s', { name: 'Home' }), berlin, [named]).location).toEqual({ name: 'Home', ...berlin });
    expect(withCoords(s, north(5000), [named]).location).toEqual(north(5000));
  });

  it('suggests place names: nearest first, else most used', () => {
    const sessions = [
      placed('a', { name: 'Park', ...north(2000) }),
      placed('b', { name: 'Shala', ...north(100) }),
      placed('c', { name: 'Park', ...north(3000) }),
      placed('d', { name: 'Beach' }),
      placed('e', north(10)),
    ];
    expect(placeNames(sessions)).toEqual(['Park', 'Beach', 'Shala']);
    expect(placeNames(sessions, berlin)).toEqual(['Shala', 'Park', 'Beach']);
    expect(placeNames([])).toEqual([]);
  });

  it('formats coordinates and labels', () => {
    expect(formatCoords(52.52, 13.405)).toBe('52.5200° N, 13.4050° E');
    expect(formatCoords(-33.8688, -70.1)).toBe('33.8688° S, 70.1000° W');
    expect(placeLabel(placed('a', { name: 'Park', ...berlin }))).toBe('Park');
    expect(placeLabel(placed('a', berlin))).toBe('52.5200° N, 13.4050° E');
    expect(placeLabel(placed('a'))).toBeNull();
    expect(sessionCoords(placed('a', { lat: 1 }))).toBeNull();
  });
});

describe('session previews', () => {
  const ses: Session = { id: 's', date: '', note: '', videoIds: ['v1', 'v2'] };
  const holds = [
    hold('h4', 's', 'v2', 'x', 50),
    hold('h1', 's', 'v1', 'x', 10),
    hold('h3', 's', 'v2', 'x', 5),
    hold('h2', 's', 'v1', 'x', 300),
    hold('h5', 's', 'v2', 'x', 90),
    hold('other', 'o', 'v1', 'x', 100),
  ];

  it('picks the captured hold nearest the middle of the session', () => {
    // Session order: h1 h2 h3 h4 h5 → middle h3.
    expect(sessionPreview(ses, holds, new Set(['h1', 'h2', 'h3', 'h4', 'h5']))?.id).toBe('h3');
    expect(sessionPreview(ses, holds, new Set(['h1', 'h4', 'h5']))?.id).toBe('h4');
    expect(sessionPreview(ses, holds, new Set(['h1', 'h2', 'h4']))?.id).toBe('h2');
    expect(sessionPreview(ses, holds, new Set(['other']))).toBeNull();
    expect(sessionPreview(ses, [hold('x', 's', 'v9', 'x', 1), hold('y', 's', 'v2', 'x', 1)], new Set(['x']))?.id).toBe('x');
  });

  it('falls back to the middle frame of the longest analysed video', () => {
    expect(sessionTinyFrame(ses, { v1: { sampleCount: 100 }, v2: { sampleCount: 401 } })).toEqual({ videoId: 'v2', index: 200 });
    expect(sessionTinyFrame(ses, { v1: { sampleCount: 10 } })).toEqual({ videoId: 'v1', index: 5 });
    expect(sessionTinyFrame(ses, {})).toBeNull();
  });
});
