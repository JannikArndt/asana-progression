import { describe, expect, it } from 'vitest';
import { clampView, cropFromView, cropGeometry, effectiveCrop, needsCapture, normalizeCrop, replacedAssets, viewForCrop } from './capture-plan';
import type { Asset, Hold } from '../../model';

const hold: Hold = {
  id: 'h', sessionId: 's', videoId: 'v', asanaId: 'navasana', side: null,
  startS: 10, endS: 30, bestS: 20, clipStartS: 15, clipEndS: 19, crop: {},
};
const asset = (kind: Asset['kind'], extra: Partial<Asset> = {}): Asset => ({
  id: `${kind}-1`, holdId: 'h', kind, mime: 'x', width: 1, height: 1, bytes: 1, storageKey: `assets/${kind}`, ...extra,
});

describe('needsCapture', () => {
  it('requires still, thumb and clip', () => {
    expect(needsCapture(hold, [])).toEqual({ still: true, clip: true });
    const fresh = [asset('still', { atS: 20.01 }), asset('thumb', { atS: 20.01 }), asset('clip', { startS: 14.5, endS: 19.5 })];
    expect(needsCapture(hold, fresh)).toEqual({ still: false, clip: false });
  });
  it('detects a moved best frame or clip window', () => {
    const assets = [asset('still', { atS: 25 }), asset('thumb'), asset('clip', { startS: 16, endS: 19 })];
    expect(needsCapture(hold, assets)).toEqual({ still: true, clip: true });
    expect(needsCapture(hold, [asset('still', { atS: 20 }), asset('thumb'), asset('clip', { startS: 0, endS: 60 })]).clip).toBe(true);
    expect(needsCapture(hold, [asset('still'), asset('thumb'), asset('clip', { startS: 15 })])).toEqual({ still: true, clip: true });
    expect(needsCapture(hold, [asset('still', { atS: 20, holdId: 'other' })]).still).toBe(true);
  });
});

describe('replacedAssets', () => {
  it('selects assets of the same hold and kinds', () => {
    const list = [asset('still'), asset('clip'), asset('thumb', { holdId: 'x' })];
    expect(replacedAssets('h', list, ['still', 'thumb']).map((a) => a.kind)).toEqual(['still']);
  });
});

describe('crop helpers', () => {
  it('prefers manual over auto', () => {
    expect(effectiveCrop({ crop: {} })).toBeNull();
    expect(effectiveCrop({ crop: { auto: { x: 0, y: 0, w: 1, h: 1 } } })).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(effectiveCrop({ crop: { auto: { x: 0, y: 0, w: 1, h: 1 }, manual: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } } })!.x).toBe(0.1);
  });
  it('computes container and image geometry', () => {
    expect(cropGeometry(null, 1600, 900)).toEqual({ aspectRatio: 16 / 9, width: 100, left: -0, top: -0 });
    const g = cropGeometry({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, 1600, 900);
    expect(g.aspectRatio).toBeCloseTo((0.5 * 1600) / (0.25 * 900));
    expect(g.width).toBe(200);
    expect(g.left).toBe(-50);
    expect(g.top).toBe(-200);
  });
  it('clamps crops into the image', () => {
    expect(normalizeCrop({ x: -0.1, y: 0, w: 2, h: 1 })).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    const c = normalizeCrop({ x: 0.5, y: 0.5, w: 0.8, h: 0.001 });
    expect(c.x).toBeCloseTo(0.2);
    expect(c).toMatchObject({ y: 0.5, w: 0.8, h: 0.02 });
  });
  it('converts between crop boxes and pan/zoom views', () => {
    const frame = { x: 10, y: 20, w: 300, h: 400 };
    const crop = { x: 0.25, y: 0.1, w: 0.3, h: 0.4 };
    const v = viewForCrop(frame, crop, 1000, 1000);
    const back = cropFromView(frame, v, 1000, 1000);
    expect(back.x).toBeCloseTo(0.25);
    expect(back.w).toBeCloseTo(0.3);
    expect(back.h).toBeCloseTo(0.4);
    const c = clampView(frame, { s: 0.01, tx: 500, ty: 500 }, 1000, 1000, 5);
    expect(c.s).toBeCloseTo(0.4);
    expect(c.tx).toBe(10);
    expect(c.ty).toBe(20);
    expect(clampView(frame, { s: 99, tx: -1e6, ty: -1e6 }, 1000, 1000, 5)).toEqual({ s: 5, tx: 310 - 5000, ty: 420 - 5000 });
  });
});
