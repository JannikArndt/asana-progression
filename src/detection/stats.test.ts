import { describe, expect, it } from 'vitest';
import { argminRange, lowestWindow, meanAbsDiff, medianFilter, percentile, percentileSorted, sortedFinite } from './stats';

describe('percentile', () => {
  it('interpolates linearly and ignores non-finite values', () => {
    expect(percentile([3, 1, NaN, 2, Infinity], 50)).toBe(2);
    expect(percentile([0, 10], 55)).toBeCloseTo(5.5);
    expect(percentile([0, 10], 0)).toBe(0);
    expect(percentile([0, 10], 100)).toBe(10);
    expect(percentile([0, 10], 150)).toBe(10);
    expect(percentile([0, 10], -5)).toBe(0);
  });
  it('handles empty and single inputs', () => {
    expect(percentile([], 50)).toBeNaN();
    expect(percentile([NaN], 50)).toBeNaN();
    expect(percentileSorted([7], 90)).toBe(7);
  });
  it('sortedFinite sorts numerically', () => {
    expect(Array.from(sortedFinite([10, 9, 100, NaN, 1]))).toEqual([1, 9, 10, 100]);
  });
});

describe('medianFilter', () => {
  it('removes single spikes and truncates at the edges', () => {
    const out = medianFilter([1, 1, 9, 1, 1], 3);
    expect(Array.from(out)).toEqual([1, 1, 1, 1, 1]);
  });
  it('averages the two middle values for even-sized edge windows', () => {
    const out = medianFilter([1, 3, 5, 7], 3);
    expect(out[0]).toBe(2);
    expect(out[3]).toBe(6);
  });
  it('ignores NaN and yields NaN for empty windows', () => {
    const out = medianFilter([NaN, NaN, NaN, 4], 1);
    expect(out[0]).toBeNaN();
    expect(out[3]).toBe(4);
    expect(medianFilter([NaN, 2, NaN], 3)[0]).toBe(2);
  });
  it('treats window 0 as identity', () => {
    expect(Array.from(medianFilter([5, 1, 3], 0))).toEqual([5, 1, 3]);
  });
});

describe('meanAbsDiff', () => {
  it('computes the mean absolute difference', () => {
    expect(meanAbsDiff(new Uint8Array([0, 10]), new Uint8Array([10, 0]))).toBe(10);
    expect(meanAbsDiff(new Uint8Array([]), new Uint8Array([]))).toBe(0);
  });
});

describe('argminRange', () => {
  it('finds the earliest minimum within range', () => {
    expect(argminRange([5, 1, 1, 0, 9], 0, 3)).toBe(1);
    expect(argminRange([5, 1, 1, 0, 9], 2, 10)).toBe(3);
    expect(argminRange([NaN, NaN], 0, 2)).toBe(-1);
    expect(argminRange([1, 2], -3, 1)).toBe(0);
  });
});

describe('lowestWindow', () => {
  it('finds the window with the lowest sum', () => {
    expect(lowestWindow([5, 5, 1, 1, 5, 5], 0, 6, 2)).toBe(2);
    expect(lowestWindow([1, 1, 5, 5], 0, 4, 2)).toBe(0);
  });
  it('treats NaN as very large and returns from for short ranges', () => {
    expect(lowestWindow([NaN, 1, 1, 3], 0, 4, 2)).toBe(1);
    expect(lowestWindow([1, 2, 3], 1, 3, 5)).toBe(1);
    expect(lowestWindow([1, 2, 3], 0, 3, 0)).toBe(0);
  });
});
