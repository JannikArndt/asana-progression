import { describe, expect, it } from 'vitest';
import { displayCrop, flipbookInterval, hasBothSides, hasReps, holdReps, itemAspect, nextColumns, progressionItems, repLabel, swipeIndex, typicalAspect } from './views';
import type { Asset, Hold, Session } from '../model/types';

const hold = (id: string, sessionId: string, asanaId: string, side: Hold['side'], startS = 0): Hold => ({
  id, sessionId, videoId: 'v', asanaId, side, startS, endS: startS + 10, bestS: startS + 5, clipStartS: startS, clipEndS: startS + 4, crop: {},
});
const asset = (id: string, holdId: string, kind: Asset['kind'], createdAt = '2026-01-01'): Asset => ({
  id, holdId, kind, mime: 'x', width: 1, height: 1, bytes: 1, storageKey: id, createdAt,
});
const sessions: Session[] = [
  { id: 's1', date: '2025-08-28T18:00:00+02:00', note: 'first', videoIds: [] },
  { id: 's2', date: '2026-02-01T07:00:00+01:00', note: '', videoIds: [] },
];

describe('reps', () => {
  // s1: video v2 comes before v1 in the session
  const ses: Session[] = [{ id: 's1', date: '2025-01-01', note: '', videoIds: ['v2', 'v1'] }, { id: 's2', date: '2025-02-01', note: '', videoIds: ['v'] }];
  const h = (id: string, sid: string, vid: string, asanaId: string, startS: number, side: Hold['side'] = null): Hold => ({ ...hold(id, sid, asanaId, side, startS), videoId: vid });
  const holds = [
    h('n3', 's1', 'v1', 'navasana', 10),
    h('n1', 's1', 'v2', 'navasana', 100),
    h('n2', 's1', 'v2', 'navasana', 200),
    h('k', 's1', 'v1', 'kurmasana', 50),
    h('n4', 's1', 'v1', 'navasana', 90),
    h('t1', 's1', 'v1', 'trikonasana', 120, 'R'),
    h('t2', 's1', 'v1', 'trikonasana', 150, 'L'),
    h('m', 's2', 'v', 'navasana', 5),
  ];

  it('numbers consecutive holds of the same asana and side per session', () => {
    const r = holdReps(holds, ses);
    expect(['n1', 'n2', 'n3', 'k', 'n4', 't1', 't2', 'm'].map((id) => `${r.get(id)!.rep}/${r.get(id)!.of}`)).toEqual(['1/3', '2/3', '3/3', '1/1', '1/1', '1/1', '1/1', '1/1']);
  });

  it('filters first and last reps', () => {
    expect(progressionItems('navasana', holds, ses, [], 'both', 'first').map((i) => i.hold.id)).toEqual(['n1', 'n4', 'm']);
    expect(progressionItems('navasana', holds, ses, [], 'both', 'last').map((i) => i.hold.id)).toEqual(['n3', 'n4', 'm']);
    // session order: videos as listed in the session, then time
    expect(progressionItems('navasana', holds, ses, []).map((i) => [i.hold.id, repLabel(i)])).toEqual([
      ['n1', '1/3'],
      ['n2', '2/3'],
      ['n3', '3/3'],
      ['n4', ''],
      ['m', ''],
    ]);
    expect(hasReps('navasana', holds, ses)).toBe(true);
    expect(hasReps('kurmasana', holds, ses)).toBe(false);
  });
});

describe('progressionItems', () => {
  const holds = [
    hold('b', 's2', 'parsvottanasana', 'R'),
    hold('a2', 's1', 'parsvottanasana', 'L', 50),
    hold('a1', 's1', 'parsvottanasana', 'R', 10),
    hold('x', 's1', 'navasana', null),
    hold('orphan', 'gone', 'parsvottanasana', 'R'),
  ];
  const assets = [asset('st-old', 'a1', 'still', '2026-01-01'), asset('st-new', 'a1', 'still', '2026-03-01'), asset('th', 'a1', 'thumb'), asset('cl', 'b', 'clip')];

  it('orders by session date, then position in the video, and joins assets', () => {
    const items = progressionItems('parsvottanasana', holds, sessions, assets);
    expect(items.map((i) => i.hold.id)).toEqual(['orphan', 'a1', 'a2', 'b']);
    const a1 = items.find((i) => i.hold.id === 'a1')!;
    expect(a1.still?.id).toBe('st-new');
    expect(a1.thumb?.id).toBe('th');
    expect(a1.note).toBe('first');
    expect(items.find((i) => i.hold.id === 'b')!.clip?.id).toBe('cl');
    expect(items[0]!.date).toBe('');
  });

  it('filters by side', () => {
    expect(progressionItems('parsvottanasana', holds, sessions, assets, 'L').map((i) => i.hold.id)).toEqual(['a2']);
    expect(progressionItems('navasana', holds, sessions, [], 'R')).toEqual([]);
  });
});

describe('view helpers', () => {
  it('changes grid density on pinch', () => {
    expect(nextColumns(3, 1.3)).toBe(2);
    expect(nextColumns(2, 1.3)).toBe(2);
    expect(nextColumns(3, 0.7)).toBe(4);
    expect(nextColumns(4, 0.7)).toBe(4);
    expect(nextColumns(3, 1)).toBe(3);
  });
  it('swipes by distance or velocity, clamped', () => {
    expect(swipeIndex(1, 3, -100, 300)).toBe(2);
    expect(swipeIndex(1, 3, 100, 300)).toBe(0);
    expect(swipeIndex(1, 3, -10, 300)).toBe(1);
    expect(swipeIndex(1, 3, -10, 300, -1)).toBe(2);
    expect(swipeIndex(1, 3, 10, 300, 1)).toBe(0);
    expect(swipeIndex(2, 3, -200, 300)).toBe(2);
    expect(swipeIndex(0, 3, 200, 300)).toBe(0);
  });
  it('clamps flipbook speed', () => {
    expect(flipbookInterval(4)).toBe(250);
    expect(flipbookInterval(100)).toBeCloseTo(1000 / 24);
    expect(flipbookInterval(0)).toBe(2000);
  });
  it('detects both sides', () => {
    expect(hasBothSides([hold('a', 's', 'p', 'R'), hold('b', 's', 'p', 'L')], 'p')).toBe(true);
    expect(hasBothSides([hold('a', 's', 'p', 'R')], 'p')).toBe(false);
  });
});

describe('crop aspects', () => {
  const still = (w: number, h: number): Asset => ({ ...asset('s', 'h', 'still'), width: w, height: h });
  const item = (crop: Hold['crop'], a?: Asset) => ({ hold: { ...hold('h', 's', 'p', null), crop }, still: a, thumb: undefined });

  it('prefers the manual crop, then the automatic one, then the full frame', () => {
    const auto = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 };
    const manual = { x: 0.2, y: 0.2, w: 0.3, h: 0.6 };
    expect(displayCrop({ crop: { auto, manual } })).toBe(manual);
    expect(displayCrop({ crop: { auto } })).toBe(auto);
    expect(displayCrop({ crop: {} })).toBeNull();
  });

  it('computes the displayed aspect in pixels', () => {
    expect(itemAspect(item({}, still(1920, 1080)))).toBeCloseTo(16 / 9);
    expect(itemAspect(item({ manual: { x: 0, y: 0, w: 0.25, h: 1 } }, still(1920, 1080)))).toBeCloseTo(4 / 9);
    expect(itemAspect({ hold: hold('t', 's', 'p', null), still: undefined, thumb: still(512, 288) })).toBeCloseTo(16 / 9);
    expect(itemAspect(item({}))).toBeNull();
    expect(itemAspect(item({}, still(0, 0)))).toBeNull();
    expect(itemAspect(item({ manual: { x: 0, y: 0, w: 0, h: 1 } }, still(10, 10)))).toBeNull();
  });

  it('takes the clamped median for the tile shape', () => {
    const sq = (w: number) => item({ manual: { x: 0, y: 0, w, h: 1 } }, still(100, 100));
    expect(typicalAspect([])).toBeCloseTo(0.8);
    expect(typicalAspect([sq(0.6), sq(0.9), sq(1)])).toBeCloseTo(0.9);
    expect(typicalAspect([sq(0.6), sq(1)])).toBeCloseTo(0.8);
    expect(typicalAspect([sq(0.1)])).toBe(0.5);
    expect(typicalAspect([item({}, still(400, 100))])).toBe(2);
  });
});
