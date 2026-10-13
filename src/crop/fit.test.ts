import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Box } from '../model/types';
import { BOX_DEFAULTS, boxFromLandmarks, type BoxGeometry } from './landmarks';

/**
 * The user's manual crops (src/crop/__fixtures__/crops.json, from the research export: pose
 * landmarks of the stills and the crops, no images) against the automatic crop. BOX_DEFAULTS were
 * fitted to contain as many manual crops as possible (tolerance 2 % of the image height) while the
 * median automatic crop grows by at most 1.2 × the previous geometry's (research/REPORT.md, B3).
 */
interface CropFixture {
  tolerance: number;
  maxAreaRatio: number;
  previous: BoxGeometry;
  geometry: BoxGeometry;
  cases: Array<{ session: string; aspect: number; manual: Box; landmarks: Array<[number, number, number]> }>;
  holds: Array<{ aspect: number; landmarks: Array<[number, number, number]> }>;
}

const fx = JSON.parse(readFileSync(join(import.meta.dirname, '__fixtures__', 'crops.json'), 'utf8')) as CropFixture;
const lm = (rows: Array<[number, number, number]>) => rows.map(([x, y, visibility]) => ({ x, y, visibility }));
const box = (rows: Array<[number, number, number]>, aspect: number, geometry?: BoxGeometry) => boxFromLandmarks(lm(rows), { aspect, ...(geometry ? { geometry } : {}) });

function contains(auto: Box, m: Box, aspect: number): boolean {
  const tx = fx.tolerance / aspect;
  const ty = fx.tolerance;
  return auto.x - m.x <= tx && m.x + m.w - (auto.x + auto.w) <= tx && auto.y - m.y <= ty && m.y + m.h - (auto.y + auto.h) <= ty;
}

describe('automatic crop vs manual crops', () => {
  it('BOX_DEFAULTS are the fitted geometry', () => {
    expect({ ...BOX_DEFAULTS }).toEqual(fx.geometry);
  });

  it('contains at least the fitted number of manual crops (floor), more than the previous geometry', () => {
    const now = fx.cases.filter((c) => contains(box(c.landmarks, c.aspect)!, c.manual, c.aspect)).length;
    const before = fx.cases.filter((c) => contains(box(c.landmarks, c.aspect, fx.previous)!, c.manual, c.aspect)).length;
    expect(fx.cases.length).toBe(66);
    expect(before).toBe(16);
    expect(now).toBeGreaterThanOrEqual(37);
  });

  it('keeps the median automatic crop within 1.2 × the previous area', () => {
    const ratios = fx.holds
      .map((h) => {
        const a = box(h.landmarks, h.aspect)!;
        const b = box(h.landmarks, h.aspect, fx.previous)!;
        return (a.w * a.h) / (b.w * b.h);
      })
      .sort((x, y) => x - y);
    expect(ratios[ratios.length >> 1]!).toBeLessThanOrEqual(fx.maxAreaRatio);
    expect(ratios[0]!).toBeGreaterThanOrEqual(1 - 1e-9);
  });
});
