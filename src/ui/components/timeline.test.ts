import { describe, expect, it } from 'vitest';
import {
  clampView,
  envelope,
  fitView,
  formatDuration,
  formatTime,
  hitSpan,
  isFit,
  MAX_PX_PER_S,
  minPxPerS,
  panBy,
  revealSpan,
  robustMax,
  tickStep,
  ticks,
  timeToX,
  xToTime,
  zoomAt,
  type Span,
} from './timeline';

describe('timeline view math', () => {
  it('fits the whole duration and maps time ↔ x', () => {
    const v = fitView(3600, 360);
    expect(v.pxPerS).toBe(0.1);
    expect(isFit(v)).toBe(true);
    expect(timeToX(v, 1800)).toBe(180);
    expect(xToTime(v, 90)).toBe(900);
    expect(minPxPerS(0, 100)).toBe(1);
  });

  it('zooms around an anchor and clamps', () => {
    const v = fitView(600, 300);
    const z = zoomAt(v, 4, 150);
    expect(z.pxPerS).toBe(2);
    expect(xToTime(z, 150)).toBeCloseTo(300);
    expect(isFit(z)).toBe(false);
    const out = zoomAt(v, 0.1, 0);
    expect(out.pxPerS).toBe(v.pxPerS);
    const deep = zoomAt(v, 1e6, 0);
    expect(deep.pxPerS).toBe(MAX_PX_PER_S);
  });

  it('pans within bounds', () => {
    const z = zoomAt(fitView(600, 300), 4, 0);
    expect(panBy(z, 100).startS).toBe(0);
    const right = panBy(z, -1e6);
    expect(right.startS).toBeCloseTo(600 - 300 / z.pxPerS);
    expect(clampView({ ...z, startS: -5 }).startS).toBe(0);
  });

  it('reveals spans outside the view', () => {
    const z = zoomAt(fitView(600, 300), 10, 0); // 5 px/s → 60 s visible
    expect(revealSpan(z, 10, 20)).toBe(z);
    const r = revealSpan(z, 300, 320);
    expect(r.startS).toBeCloseTo(280);
  });

  it('chooses readable tick steps', () => {
    expect(tickStep(0.1)).toBe(600);
    expect(tickStep(10)).toBe(10);
    expect(tickStep(100)).toBe(1);
    expect(tickStep(0.0001)).toBe(3600);
    const v = fitView(125, 250);
    expect(ticks(v)).toEqual([0, 30, 60, 90, 120]);
  });

  it('formats times and durations', () => {
    expect(formatTime(0)).toBe('00:00');
    expect(formatTime(75.4)).toBe('01:15');
    expect(formatTime(3725)).toBe('1:02:05');
    expect(formatTime(-3)).toBe('00:00');
    expect(formatDuration(29.6)).toBe('30 s');
    expect(formatDuration(120)).toBe('2 min');
    expect(formatDuration(125)).toBe('2 min 5 s');
  });
});

describe('envelope', () => {
  it('computes per-column min/max and skips NaN', () => {
    const values = Float32Array.from([1, 5, 2, NaN, NaN, NaN, 3, 3]);
    const v = fitView(2, 2); // 4 samples per column at 4 Hz
    const e = envelope(values, 4, v);
    expect(Array.from(e.min)).toEqual([1, 3]);
    expect(Array.from(e.max)).toEqual([5, 3]);
    const live = envelope(values, 4, v, 3);
    expect(Array.from(live.max)).toEqual([5, NaN]);
  });
  it('handles zoomed-in views with one sample per many pixels', () => {
    const values = Float32Array.from([1, 2]);
    const v = { startS: 0, pxPerS: 8, widthPx: 4, durationS: 0.5 };
    const e = envelope(values, 4, v);
    expect(Array.from(e.max)).toEqual([1, 1, 2, 2]);
  });
});

describe('robustMax', () => {
  it('ignores spikes and handles degenerate input', () => {
    const vals = Array.from({ length: 1000 }, (_, i) => (i === 500 ? 1000 : 1));
    expect(robustMax(vals)).toBeCloseTo(1.15);
    expect(robustMax([])).toBe(1);
    expect(robustMax([0, 0])).toBe(1);
    expect(robustMax([NaN, 0, 0.5], 2)).toBe(1);
  });
});

describe('hitSpan', () => {
  const spans: Span[] = [
    { id: 'a', startS: 10, endS: 40, bestS: 20, status: 'open' },
    { id: 'b', startS: 30, endS: 35, bestS: 32, status: 'labeled', label: 'X' },
  ];
  it('returns the narrowest span under x', () => {
    const v = fitView(100, 100);
    expect(hitSpan(spans, v, 15)?.id).toBe('a');
    expect(hitSpan(spans, v, 32)?.id).toBe('b');
    expect(hitSpan(spans, v, 43)?.id).toBe('a'); // within slop
    expect(hitSpan(spans, v, 80)).toBeNull();
  });
});
