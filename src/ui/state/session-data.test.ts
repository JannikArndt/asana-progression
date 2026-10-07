import { describe, expect, it } from 'vitest';
import {
  asanaStats,
  combineSessions,
  compareVideos,
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
});
