import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { encodePose, decodePose, type Asana, type CompactPose, type SequenceTemplate } from '../model';
import type { ResearchExport } from '../ui/research/export';
import { alignSlots, ALIGN_COSTS, type AlignSlot } from './align';
import { classKey, PoseClassifier, poseDistance, poseFeatures } from './pose';
import { planSession, POSE_ALIGNMENT, suggest } from './suggest';
import type { HistoryEntry, ReviewItem } from './types';

type P3 = [number, number, number];

/** 33 world landmarks from the 15 body joints (others at the nose). */
function world(j: Record<'nose' | 'ls' | 'rs' | 'le' | 're' | 'lw' | 'rw' | 'lh' | 'rh' | 'lk' | 'rk' | 'la' | 'ra' | 'lf' | 'rf', P3>) {
  const at: Record<number, P3> = { 0: j.nose, 11: j.ls, 12: j.rs, 13: j.le, 14: j.re, 15: j.lw, 16: j.rw, 23: j.lh, 24: j.rh, 25: j.lk, 26: j.rk, 27: j.la, 28: j.ra, 31: j.lf, 32: j.rf };
  return Array.from({ length: 33 }, (_, i) => {
    const p = at[i] ?? j.nose;
    return { x: p[0], y: p[1], z: p[2], visibility: 0.9 };
  });
}

/** A few distinct poses (y points down, metres). */
const POSES = {
  standing: world({ nose: [0, -0.7, 0], ls: [0.2, -0.5, 0], rs: [-0.2, -0.5, 0], le: [0.25, -0.25, 0], re: [-0.25, -0.25, 0], lw: [0.25, 0, 0], rw: [-0.25, 0, 0], lh: [0.1, 0, 0], rh: [-0.1, 0, 0], lk: [0.1, 0.45, 0], rk: [-0.1, 0.45, 0], la: [0.1, 0.9, 0], ra: [-0.1, 0.9, 0], lf: [0.1, 0.92, -0.15], rf: [-0.1, 0.92, -0.15] }),
  armsUp: world({ nose: [0, -0.7, 0], ls: [0.2, -0.5, 0], rs: [-0.2, -0.5, 0], le: [0.25, -0.8, 0], re: [-0.25, -0.8, 0], lw: [0.25, -1.1, 0], rw: [-0.25, -1.1, 0], lh: [0.1, 0, 0], rh: [-0.1, 0, 0], lk: [0.1, 0.45, 0], rk: [-0.1, 0.45, 0], la: [0.1, 0.9, 0], ra: [-0.1, 0.9, 0], lf: [0.1, 0.92, -0.15], rf: [-0.1, 0.92, -0.15] }),
  seated: world({ nose: [0, -0.7, 0], ls: [0.2, -0.5, 0], rs: [-0.2, -0.5, 0], le: [0.25, -0.25, -0.2], re: [-0.25, -0.25, -0.2], lw: [0.2, 0, -0.4], rw: [-0.2, 0, -0.4], lh: [0.1, 0, 0], rh: [-0.1, 0, 0], lk: [0.1, 0, -0.45], rk: [-0.1, 0, -0.45], la: [0.1, 0, -0.9], ra: [-0.1, 0, -0.9], lf: [0.1, -0.15, -0.95], rf: [-0.1, -0.15, -0.95] }),
  /** One leg raised to the front on the left; mirrored = on the right. */
  legUp: world({ nose: [0, -0.7, 0], ls: [0.2, -0.5, 0], rs: [-0.2, -0.5, 0], le: [0.25, -0.25, -0.1], re: [-0.25, -0.25, 0], lw: [0.15, -0.1, -0.6], rw: [-0.25, 0, 0], lh: [0.1, 0, 0], rh: [-0.1, 0, 0], lk: [0.1, -0.05, -0.45], rk: [-0.1, 0.45, 0], la: [0.1, -0.1, -0.9], ra: [-0.1, 0.9, 0], lf: [0.1, -0.25, -0.95], rf: [-0.1, 0.92, -0.15] }),
};
const pose = (w: ReturnType<typeof world>) => encodePose(w, null)!;
const mirrored = (w: ReturnType<typeof world>) => {
  const swap = (i: number) => (i >= 11 ? (i % 2 ? i + 1 : i - 1) : i);
  return w.map((_, i) => ({ ...w[swap(i)]!, x: -w[swap(i)]!.x }));
};

describe('pose features', () => {
  const f = (w: ReturnType<typeof world>, mirror = false) => poseFeatures(decodePose(pose(w))!, mirror);

  it('ignore position, size and facing (rotation about the vertical axis)', () => {
    const a = f(POSES.armsUp);
    const moved = POSES.armsUp.map((l) => ({ ...l, x: 2 * l.x + 0.3, y: 2 * l.y - 0.1, z: 2 * l.z + 0.5 }));
    const turn = (deg: number) => POSES.armsUp.map((l) => {
      const r = (deg * Math.PI) / 180;
      return { ...l, x: l.x * Math.cos(r) - l.z * Math.sin(r), z: l.x * Math.sin(r) + l.z * Math.cos(r) };
    });
    expect(poseDistance(a, f(moved))).toBeLessThan(0.01);
    expect(poseDistance(a, f(turn(70)))).toBeLessThan(0.01);
    expect(poseDistance(a, f(POSES.standing))).toBeGreaterThan(0.3);
    expect(a.angles.length).toBe(9);
  });

  it('mirror swaps left and right', () => {
    const left = f(POSES.legUp);
    const right = f(mirrored(POSES.legUp));
    expect(poseDistance(left, right)).toBeGreaterThan(0.1);
    expect(poseDistance(f(POSES.legUp, true), right)).toBeLessThan(0.01);
  });

  it('handles degenerate joints', () => {
    const flat = POSES.standing.map(() => ({ x: 0, y: 0, z: 0, visibility: 1 }));
    const g = f(flat);
    expect(g.points.every((p) => p.every((v) => v === 0))).toBe(true);
    expect(g.angles.every((x) => x === 0 || Number.isFinite(x))).toBe(true);
  });
});

describe('PoseClassifier', () => {
  it('learns classes from examples, the other side from mirrored sided examples', () => {
    const c = new PoseClassifier([
      { asanaId: 'tadasana', side: null, pose: pose(POSES.standing) },
      { asanaId: 'urdhva', side: null, pose: pose(POSES.armsUp) },
      { asanaId: 'uhp', side: 'L', pose: pose(POSES.legUp) },
      { asanaId: 'none', side: null, pose: null },
    ]);
    expect([...c.classes].sort()).toEqual([classKey('tadasana', null), classKey('uhp', 'L'), classKey('uhp', 'R'), classKey('urdhva', null)].sort());
    expect(c.size).toBe(4);
    const d = c.distances(pose(mirrored(POSES.legUp)))!;
    expect(d.get(classKey('uhp', 'R'))).toBeLessThan(d.get(classKey('uhp', 'L'))!);
    expect(c.distances(null)).toBeNull();
    expect(new PoseClassifier([]).distances(pose(POSES.standing))).toBeNull();
  });
});

describe('alignSlots', () => {
  const t: SequenceTemplate = { id: 't', name: 'T', entries: [{ asanaId: 'a' }, { asanaId: 'b', reps: 2 }, { asanaId: 'c' }, { asanaId: 'd' }] };
  const open = (pref?: number, newVideo = false): AlignSlot => ({ kind: 'open', newVideo, emission: (k) => (pref === undefined ? 0 : k === pref ? 0 : 5) });

  it('follows the template, including reps', () => {
    const r = alignSlots([open(), open(), open(), open(), open()], t);
    expect(r.path).toEqual([0, 1, 1, 2, 3]);
    const m = r.marginals[0]!;
    expect(m.entries[0]).toBeLessThan(m.entries[1]!);
    expect(m.noHold).toBeGreaterThan(m.entries[0]!);
  });

  it('skips entries the evidence says were left out, and calls an outlier no hold', () => {
    expect(alignSlots([open(0), open(3)], t).path).toEqual([0, 3]);
    // Evidence for an entry far back after d: cheaper as no hold than going back.
    const r = alignSlots([open(0), open(1), open(1), open(2), open(3), { kind: 'open', newVideo: false, emission: () => 2 }], t);
    expect(r.path).toEqual([0, 1, 1, 2, 3, -1]);
  });

  it('pins labeled items and passes labels outside the template', () => {
    const r = alignSlots([{ kind: 'entry', entry: 2, newVideo: false }, { kind: 'other', newVideo: false }, open()], t);
    expect(r.path).toEqual([2, -1, 3]);
    expect(r.marginals[0]).toBeNull();
    expect(r.marginals[1]).toBeNull();
  });

  it('makes skips after a new video cheap', () => {
    const late = alignSlots([open(0), open(3, true)], t, { ...ALIGN_COSTS, skip: 100 });
    expect(late.path).toEqual([0, 3]);
    const sameVideo = alignSlots([open(0), { kind: 'open', newVideo: false, emission: (k) => (k === 3 ? 0 : 0.5) }], t, { ...ALIGN_COSTS, skip: 100 });
    expect(sameVideo.path).toEqual([0, 1]);
  });

  it('takes an item against the order for no hold, or, if that costs more, goes back', () => {
    const pinned: AlignSlot = { kind: 'entry', entry: 2, newVideo: false };
    const strong: AlignSlot = { kind: 'open', newVideo: false, emission: (k) => (k === 0 ? 0 : 20) };
    // "No hold" (3) is cheaper than going back (4): the item stays open in "confirm all".
    expect(alignSlots([pinned, strong], t).path).toEqual([2, -1]);
    expect(alignSlots([pinned, strong], t, { ...ALIGN_COSTS, noHold: 10 }).path).toEqual([2, 0]);
  });
});

describe('planSession', () => {
  const catalog: Asana[] = [
    { id: 'tadasana', name: 'Tadasana', sided: false },
    { id: 'urdhva', name: 'Urdhva', sided: false },
    { id: 'seated', name: 'Seated', sided: false },
    { id: 'uhp', name: 'UHP', sided: true },
  ];
  const t: SequenceTemplate = { id: 't', name: 'T', entries: [{ asanaId: 'tadasana' }, { asanaId: 'urdhva' }, { asanaId: 'uhp', side: 'R' }, { asanaId: 'uhp', side: 'L' }, { asanaId: 'seated' }] };
  const history: HistoryEntry[] = [
    { asanaId: 'tadasana', side: null, date: '2026-01-01', sessionId: 'old', order: 0, pose: pose(POSES.standing) },
    { asanaId: 'urdhva', side: null, date: '2026-01-01', sessionId: 'old', order: 1, pose: pose(POSES.armsUp) },
    { asanaId: 'uhp', side: 'L', date: '2026-01-01', sessionId: 'old', order: 2, pose: pose(POSES.legUp) },
    { asanaId: 'seated', side: null, date: '2026-01-01', sessionId: 'old', order: 3, pose: pose(POSES.seated) },
  ];
  const item = (key: string, p: ReturnType<typeof world> | null, extra: Partial<ReviewItem> = {}): ReviewItem => ({ key, status: 'open', pose: p ? pose(p) : null, videoId: 'v', ...extra });

  it('follows the poses where the practice leaves out an entry', () => {
    const short: SequenceTemplate = { id: 's', name: 'S', entries: [{ asanaId: 'tadasana' }, { asanaId: 'urdhva' }, { asanaId: 'seated' }] };
    // Urdhva is left out: template order alone suggests it for the second item.
    const items = [item('1', POSES.standing), item('2', POSES.seated)];
    expect(suggest(items, catalog, short, [])['2']![0]!.asanaId).toBe('urdhva');
    const plan = planSession(items, catalog, short, history);
    expect(plan.suggestions['2']![0]).toMatchObject({ asanaId: 'seated', reason: 'pose' });
    expect(plan.confirmAll!.map((c) => [c.key, c.label.asanaId])).toEqual([
      ['1', 'tadasana'],
      ['2', 'seated'],
    ]);
    expect(new Set(plan.suggestions['1']!.map((x) => x.asanaId)).size).toBe(plan.suggestions['1']!.length);
  });

  it('tells the sides apart with mirrored examples', () => {
    const sides: SequenceTemplate = { id: 's', name: 'S', entries: [{ asanaId: 'uhp', side: 'R' }, { asanaId: 'uhp', side: 'L' }] };
    // Left first this time, then right (the template says R then L).
    const plan = planSession([item('1', POSES.legUp), item('2', mirrored(POSES.legUp))], catalog, sides, history.slice(2, 3));
    expect(plan.suggestions['1']![0]).toMatchObject({ asanaId: 'uhp', side: 'L' });
  });

  it('keeps labeled items and leaves items without a pose out of "confirm all"', () => {
    const items: ReviewItem[] = [
      { key: '1', status: 'labeled', label: { asanaId: 'tadasana', side: null, templateEntryIndex: 0 }, pose: pose(POSES.standing), videoId: 'v' },
      item('2', null),
      item('3', POSES.seated, { videoId: 'w' }),
      { key: '4', status: 'dismissed', videoId: 'w' },
    ];
    const plan = planSession(items, catalog, t, history);
    expect(plan.suggestions['1']).toBeUndefined();
    expect(plan.suggestions['2']![0]!.reason).toBe('pose');
    expect(plan.confirmAll!.map((c) => c.key)).toEqual(['3']);
  });

  it('falls back to template order without enough poses', () => {
    const items = [item('1', POSES.standing)];
    expect(planSession(items, catalog, t, history.slice(0, 1)).confirmAll).toBeNull();
    expect(planSession([item('1', null)], catalog, t, history).confirmAll).toBeNull();
    expect(planSession(items, catalog, null, history).confirmAll).toBeNull();
    expect(planSession(items, catalog, { ...t, entries: [] }, history).confirmAll).toBeNull();
    expect(planSession(items, catalog, t, history.slice(0, 1)).suggestions['1']![0]!.reason).toBe('template');
    expect(POSE_ALIGNMENT.minCoverage).toBeGreaterThan(0);
  });
});

/**
 * The user's three labeled sessions (research/data/research.json): every hold open, the other
 * sessions' poses as examples; research/REPORT.md, B2 measured 89 % right with zero corrections.
 */
describe('on the research data', () => {
  const x = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'research', 'data', 'research.json'), 'utf8')) as ResearchExport;
  const catalog: Asana[] = x.catalog.map((a) => ({ id: a.id, name: a.name, sided: a.sided }));
  const poseOf = (h: ResearchExport['holds'][number]): CompactPose | null =>
    h.pose?.world ? encodePose(h.pose.world.map(([px, py, pz, v]) => ({ x: px, y: py, z: pz ?? 0, visibility: v ?? 1 })), h.pose.posture) : null;
  const sessions = x.sessions.map((s) => ({ ...s, holds: s.videoIds.flatMap((v) => x.holds.filter((h) => h.videoId === v).sort((a, b) => a.startS - b.startS)) }));

  it('labels at least 85 % of the holds right with zero corrections', () => {
    let right = 0;
    let n = 0;
    for (const s of sessions) {
      const history = sessions
        .filter((o) => o.id !== s.id)
        .flatMap((o) => o.holds.map((h, order) => ({ asanaId: h.asanaId, side: h.side, date: o.date, sessionId: o.id, order, pose: poseOf(h) })));
      const items: ReviewItem[] = s.holds.map((h) => ({ key: h.id, status: 'open', pose: poseOf(h), videoId: h.videoId }));
      const plan = planSession(items, catalog, x.templates.find((t) => t.id === s.templateId)!, history);
      const label = new Map(plan.confirmAll!.map((c) => [c.key, c.label]));
      right += s.holds.filter((h) => label.get(h.id)?.asanaId === h.asanaId && (label.get(h.id)?.side ?? null) === h.side).length;
      n += s.holds.length;
    }
    expect(n).toBe(244);
    expect(right / n).toBeGreaterThanOrEqual(0.85);
  });
});
