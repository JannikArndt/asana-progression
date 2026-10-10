import { describe, expect, it } from 'vitest';
import { cropAspect, cropWithAspect, fitFrame, imageRect, inset, intersect, resizeFrame, HANDLES } from './crop-frame';

const bounds = { x: 0, y: 0, w: 400, h: 600 };
const start = { x: 100, y: 100, w: 200, h: 300 };
const free = { bounds, minSize: 60, aspect: null };

function close(a: { x: number; y: number; w: number; h: number }, b: typeof a) {
  for (const k of ['x', 'y', 'w', 'h'] as const) expect(a[k]).toBeCloseTo(b[k], 6);
}

describe('fitFrame', () => {
  it('centres the largest rectangle of the aspect', () => {
    expect(fitFrame({ x: 10, y: 20, w: 300, h: 600 }, 2 / 3)).toEqual({ x: 10, y: 95, w: 300, h: 450 });
    expect(fitFrame({ x: 0, y: 0, w: 300, h: 100 }, 1)).toEqual({ x: 100, y: 0, w: 100, h: 100 });
  });
  it('falls back to square for a bad aspect', () => {
    expect(fitFrame({ x: 0, y: 0, w: 100, h: 100 }, NaN)).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });
});

describe('rect helpers', () => {
  it('insets, intersects and places the image', () => {
    expect(inset({ x: 0, y: 0, w: 100, h: 50 }, 10)).toEqual({ x: 10, y: 10, w: 80, h: 30 });
    expect(inset({ x: 0, y: 0, w: 10, h: 10 }, 10)).toEqual({ x: 10, y: 10, w: 1, h: 1 });
    expect(intersect({ x: 0, y: 0, w: 100, h: 100 }, { x: 50, y: -20, w: 100, h: 60 })).toEqual({ x: 50, y: 0, w: 50, h: 40 });
    expect(intersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 20, w: 5, h: 5 })).toEqual({ x: 20, y: 20, w: 0, h: 0 });
    expect(imageRect({ s: 0.5, tx: -10, ty: 4 }, 1000, 800)).toEqual({ x: -10, y: 4, w: 500, h: 400 });
  });
  it('measures the pixel aspect of a crop', () => {
    expect(cropAspect({ x: 0, y: 0, w: 0.5, h: 1 }, 1920, 1080)).toBeCloseTo(960 / 1080);
  });
});

describe('cropWithAspect', () => {
  it('keeps centre and area', () => {
    const c = cropWithAspect({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, 2 / 3, 1000, 1000);
    expect(cropAspect(c, 1000, 1000)).toBeCloseTo(2 / 3);
    expect(c.w * c.h).toBeCloseTo(0.25);
    expect(c.x + c.w / 2).toBeCloseTo(0.5);
    expect(c.y + c.h / 2).toBeCloseTo(0.5);
  });
  it('shrinks and shifts into the image', () => {
    const c = cropWithAspect({ x: 0, y: 0, w: 1, h: 1 }, 2 / 3, 1600, 900);
    expect(cropAspect(c, 1600, 900)).toBeCloseTo(2 / 3);
    expect(c.h).toBeCloseTo(1);
    expect(c.y).toBe(0);
    const edge = cropWithAspect({ x: 0.9, y: 0.4, w: 0.1, h: 0.2 }, 16 / 9, 1000, 1000);
    expect(edge.x + edge.w).toBeCloseTo(1);
    expect(cropAspect(edge, 1000, 1000)).toBeCloseTo(16 / 9);
  });
});

describe('resizeFrame (free)', () => {
  it('moves only the dragged edges', () => {
    expect(resizeFrame(start, 'e', 50, 999, free)).toEqual({ x: 100, y: 100, w: 250, h: 300 });
    expect(resizeFrame(start, 'n', 999, -40, free)).toEqual({ x: 100, y: 60, w: 200, h: 340 });
    expect(resizeFrame(start, 'sw', -30, 20, free)).toEqual({ x: 70, y: 100, w: 230, h: 320 });
    expect(resizeFrame(start, 'w', 10, 0, free)).toEqual({ x: 110, y: 100, w: 190, h: 300 });
    expect(resizeFrame(start, 's', 0, -10, free)).toEqual({ x: 100, y: 100, w: 200, h: 290 });
  });
  it('stays inside the bounds', () => {
    expect(resizeFrame(start, 'nw', -500, -500, free)).toEqual({ x: 0, y: 0, w: 300, h: 400 });
    expect(resizeFrame(start, 'se', 500, 500, free)).toEqual({ x: 100, y: 100, w: 300, h: 500 });
  });
  it('keeps the minimum size', () => {
    expect(resizeFrame(start, 'ne', -500, 500, free)).toEqual({ x: 100, y: 340, w: 60, h: 60 });
  });
  it('never exceeds bounds smaller than the minimum', () => {
    const tiny = { bounds: { x: 0, y: 0, w: 40, h: 40 }, minSize: 60, aspect: null };
    const r = resizeFrame({ x: 0, y: 0, w: 40, h: 40 }, 'se', -100, -100, tiny);
    expect(r).toEqual({ x: 0, y: 0, w: 40, h: 40 });
  });
});

describe('resizeFrame (aspect locked)', () => {
  const locked = { bounds, minSize: 60, aspect: 2 / 3 };
  it('keeps the aspect for every handle', () => {
    for (const h of HANDLES) {
      for (const [dx, dy] of [[30, 10], [-25, -40], [5, 60]] as const) {
        const r = resizeFrame(start, h, dx, dy, locked);
        expect(r.w / r.h).toBeCloseTo(2 / 3, 6);
        expect(r.x).toBeGreaterThanOrEqual(-1e-9);
        expect(r.y).toBeGreaterThanOrEqual(-1e-9);
        expect(r.x + r.w).toBeLessThanOrEqual(400 + 1e-9);
        expect(r.y + r.h).toBeLessThanOrEqual(600 + 1e-9);
      }
    }
  });
  it('scales corners about the opposite corner along the diagonal', () => {
    // Dragging the SE corner along its diagonal by 10 %.
    close(resizeFrame(start, 'se', 20, 30, locked), { x: 100, y: 100, w: 220, h: 330 });
    // Perpendicular movement does not change the size.
    close(resizeFrame(start, 'se', 30, -20, locked), start);
    close(resizeFrame(start, 'nw', -20, -30, locked), { x: 80, y: 70, w: 220, h: 330 });
  });
  it('scales edges about the middle of the opposite edge', () => {
    close(resizeFrame(start, 'e', 20, 0, locked), { x: 100, y: 85, w: 220, h: 330 });
    close(resizeFrame(start, 'w', 20, 0, locked), { x: 120, y: 115, w: 180, h: 270 });
    close(resizeFrame(start, 's', 0, 30, locked), { x: 90, y: 100, w: 220, h: 330 });
    close(resizeFrame(start, 'n', 0, 30, locked), { x: 110, y: 130, w: 180, h: 270 });
  });
  it('is limited by the bounds and the minimum size', () => {
    // East edge: the height may only grow symmetrically around y = 250 → up to 500.
    close(resizeFrame(start, 'e', 1000, 0, locked), { x: 100, y: 25, w: 300, h: 450 });
    close(resizeFrame(start, 'se', 1000, 1000, locked), { x: 100, y: 100, w: 300, h: 450 });
    close(resizeFrame(start, 'n', 0, -1000, locked), { x: 66.6666667, y: 0, w: 266.6666667, h: 400 });
    const small = resizeFrame(start, 'nw', 1000, 1000, locked);
    expect(small.w).toBeCloseTo(60);
    expect(small.h).toBeCloseTo(90);
    expect(small.x + small.w).toBeCloseTo(300);
    expect(resizeFrame(start, 's', 0, -1000, locked).w).toBeCloseTo(60);
  });
});
