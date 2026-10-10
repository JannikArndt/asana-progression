import { describe, expect, it } from 'vitest';
import { BLAZEPOSE_CONNECTIONS, boxToView, poseOverlay, toView } from './overlay';
import { BLAZEPOSE_COUNT } from './landmarks';
import type { Landmark } from './types';

describe('toView / boxToView', () => {
  it('maps the full frame to the view size', () => {
    expect(toView({ x: 0.5, y: 0.25 }, null, 200, 400)).toEqual({ x: 100, y: 100 });
  });
  it('maps through a crop', () => {
    const crop = { x: 0.2, y: 0.1, w: 0.5, h: 0.8 };
    expect(toView({ x: 0.2, y: 0.1 }, crop, 100, 160)).toEqual({ x: 0, y: 0 });
    const end = toView({ x: 0.7, y: 0.9 }, crop, 100, 160);
    expect(end.x).toBeCloseTo(100);
    expect(end.y).toBeCloseTo(160);
    // Outside the crop: negative or beyond the view (the view clips it).
    expect(toView({ x: 0.1, y: 1 }, crop, 100, 160).x).toBeCloseTo(-20);
    const b = boxToView({ x: 0.3, y: 0.3, w: 0.2, h: 0.4 }, crop, 100, 160);
    expect(b.x).toBeCloseTo(20);
    expect(b.y).toBeCloseTo(40);
    expect(b.w).toBeCloseTo(40);
    expect(b.h).toBeCloseTo(80);
  });
  it('survives a degenerate crop', () => {
    expect(Number.isFinite(toView({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5, w: 0, h: 0 }, 10, 10).x)).toBe(true);
  });
});

describe('poseOverlay', () => {
  const pose = (visibility?: number): Landmark[] =>
    Array.from({ length: BLAZEPOSE_COUNT }, (_, i) => ({ x: i / 40, y: 1 - i / 40, ...(visibility !== undefined ? { visibility } : {}) }));

  it('draws every BlazePose connection and landmark', () => {
    const o = poseOverlay({ landmarks: pose(0.9), box: { x: 0, y: 0, w: 0.5, h: 0.5 } }, null, 400, 400);
    expect(o.points).toHaveLength(BLAZEPOSE_COUNT);
    expect(o.lines).toHaveLength(BLAZEPOSE_CONNECTIONS.length);
    expect(o.points.every((p) => !p.dim)).toBe(true);
    expect(o.points[10]).toEqual({ x: 100, y: 300, dim: false });
    expect(o.box).toEqual({ x: 0, y: 0, w: 200, h: 200 });
    const [i, j] = BLAZEPOSE_CONNECTIONS[0]!;
    expect(o.lines[0]).toEqual({ x1: o.points[i]!.x, y1: o.points[i]!.y, x2: o.points[j]!.x, y2: o.points[j]!.y, dim: false });
  });

  it('dims landmarks with low visibility and their lines', () => {
    const lm = pose(0.9);
    lm[15] = { ...lm[15]!, visibility: 0.1 };
    const o = poseOverlay({ landmarks: lm, box: null }, null, 100, 100);
    expect(o.points[15]!.dim).toBe(true);
    expect(o.points[13]!.dim).toBe(false);
    const wristLines = o.lines.filter((_, k) => BLAZEPOSE_CONNECTIONS[k]!.includes(15));
    expect(wristLines.length).toBeGreaterThan(0);
    expect(wristLines.every((l) => l.dim)).toBe(true);
    expect(o.box).toBeNull();
  });

  it('treats a missing visibility as visible and skips non-finite landmarks', () => {
    const lm = pose();
    lm[0] = { x: NaN, y: 0.5 };
    const o = poseOverlay({ landmarks: lm, box: null }, { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, 100, 100, 0.5);
    expect(o.points).toHaveLength(BLAZEPOSE_COUNT - 1);
    expect(o.points.every((p) => !p.dim)).toBe(true);
    expect(o.lines.length).toBe(BLAZEPOSE_CONNECTIONS.filter(([a, b]) => a !== 0 && b !== 0).length);
  });

  it('respects the crop of the view', () => {
    const lm = pose(1);
    const o = poseOverlay({ landmarks: lm, box: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } }, { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, 300, 300);
    expect(o.box).toEqual({ x: 0, y: 0, w: 300, h: 300 });
    expect(o.points[10]!.x).toBeCloseTo(0);
    expect(o.points[10]!.y).toBeCloseTo(300);
  });
});
