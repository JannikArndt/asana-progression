import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, needsResample, normalizeParams, PARAM_SPECS } from './params';

describe('params', () => {
  it('defaults match the validated algorithm', () => {
    expect(DEFAULT_PARAMS.sampleHz).toBe(4);
    expect(DEFAULT_PARAMS.sampleLongSide).toBe(160);
    expect(DEFAULT_PARAMS.pool).toBe(2);
    expect(DEFAULT_PARAMS.motionMedianWindow).toBe(9);
    expect(DEFAULT_PARAMS.changeWindowS).toBe(4);
    expect(DEFAULT_PARAMS.stillPercentile).toBe(55);
    expect(DEFAULT_PARAMS.gapMergeS).toBe(1);
    expect(DEFAULT_PARAMS.minHoldS).toBe(6);
    expect(DEFAULT_PARAMS.bestFrameMiddle).toBe(0.8);
    expect(DEFAULT_PARAMS.clipWindowS).toBe(4);
  });

  it('every param has a spec and defaults are within range', () => {
    const keys = Object.keys(DEFAULT_PARAMS).sort();
    expect(PARAM_SPECS.map((s) => s.key).sort()).toEqual(keys);
    for (const s of PARAM_SPECS) {
      expect(DEFAULT_PARAMS[s.key]).toBeGreaterThanOrEqual(s.min);
      expect(DEFAULT_PARAMS[s.key]).toBeLessThanOrEqual(s.max);
    }
  });

  it('normalizes: clamps, rounds integers, forces odd median window, drops junk', () => {
    expect(normalizeParams(undefined)).toEqual(DEFAULT_PARAMS);
    const p = normalizeParams({
      sampleHz: 100,
      pool: 2.4,
      motionMedianWindow: 8,
      stillPercentile: Number.NaN,
      // @ts-expect-error unknown key is dropped
      bogus: 1,
    });
    expect(p.sampleHz).toBe(15);
    expect(p.pool).toBe(2);
    expect(p.motionMedianWindow).toBe(9);
    expect(p.stillPercentile).toBe(55);
    expect('bogus' in p).toBe(false);
  });

  it('detects when resampling is needed', () => {
    const a = normalizeParams({});
    expect(needsResample(a, { ...a, stillPercentile: 40 })).toBe(false);
    expect(needsResample(a, { ...a, sampleHz: 5 })).toBe(true);
  });
});
