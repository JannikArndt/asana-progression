import { describe, expect, it } from 'vitest';
import {
  DETAIL_WINDOW_S,
  detailLength,
  firstBelow,
  followWindow,
  groupSegments,
  shortGroup,
  windowAround,
  type OverviewSpan,
} from './session-timeline';

describe('detail window', () => {
  it('shows short videos whole and long ones as a 20 min window', () => {
    expect(detailLength(600)).toBe(600);
    expect(detailLength(36 * 60)).toBe(DETAIL_WINDOW_S);
    expect(detailLength(25 * 60)).toBe(25 * 60);
    expect(detailLength(67 * 60)).toBe(DETAIL_WINDOW_S);
  });

  it('centres a window and keeps it inside the video', () => {
    expect(windowAround(2000, 1200, 4000)).toEqual({ startS: 1400, endS: 2600 });
    expect(windowAround(100, 1200, 4000)).toEqual({ startS: 0, endS: 1200 });
    expect(windowAround(3900, 1200, 4000)).toEqual({ startS: 2800, endS: 4000 });
    expect(windowAround(10, 1200, 600)).toEqual({ startS: 0, endS: 600 });
  });

  it('follows the current time in steps', () => {
    const w = { startS: 1000, endS: 2200 };
    // Middle 50 %: 1300…1900 keeps the window.
    expect(followWindow(w, 1300, 4000)).toBe(w);
    expect(followWindow(w, 1900, 4000)).toBe(w);
    expect(followWindow(w, 1950, 4000)).toEqual({ startS: 1350, endS: 2550 });
    expect(followWindow(w, 1200, 4000)).toEqual({ startS: 600, endS: 1800 });
    // A narrower band moves earlier.
    expect(followWindow(w, 1850, 4000, 0.2)).not.toBe(w);
  });

  it('does not move at the edges of the video', () => {
    const first = { startS: 0, endS: 1200 };
    expect(followWindow(first, 10, 4000)).toBe(first);
    expect(followWindow(first, 1000, 4000)).toEqual({ startS: 400, endS: 1600 });
    const last = { startS: 2800, endS: 4000 };
    expect(followWindow(last, 3990, 4000)).toBe(last);
    const whole = { startS: 0, endS: 600 };
    expect(followWindow(whole, 590, 600)).toBe(whole);
    expect(followWindow(whole, 5, 600)).toBe(whole);
  });
});

describe('overview segments', () => {
  const s = (startS: number, endS: number, status: OverviewSpan['status'], group?: string): OverviewSpan => ({ startS, endS, status, group });

  it('groups consecutive labeled holds by catalog group', () => {
    const spans = [
      s(10, 40, 'labeled', 'Surya Namaskara'),
      s(60, 90, 'labeled', 'Surya Namaskara'),
      s(95, 100, 'open'),
      s(120, 150, 'labeled', 'Surya Namaskara'),
      s(170, 200, 'labeled', 'Standing'),
      s(210, 220, 'dismissed'),
      s(230, 260, 'labeled', 'Standing'),
      s(300, 330, 'labeled'),
      s(340, 350, 'labeled'),
      s(400, 450, 'labeled', 'Seated'),
    ];
    expect(groupSegments(spans)).toEqual([
      { startS: 10, endS: 150, group: 'Surya Namaskara', label: 'Sun', holds: 3 },
      { startS: 170, endS: 260, group: 'Standing', label: 'Standing', holds: 2 },
      { startS: 300, endS: 350, group: '', label: 'Other', holds: 2 },
      { startS: 400, endS: 450, group: 'Seated', label: 'Seated', holds: 1 },
    ]);
  });

  it('has no segments without labels', () => {
    expect(groupSegments([s(0, 10, 'open')])).toEqual([]);
    expect(shortGroup('Backbending')).toBe('Backbends');
    expect(shortGroup('Finishing')).toBe('Finishing');
  });
});

describe('firstBelow', () => {
  it('finds the first item whose bottom is below y', () => {
    const bottoms = [100, 200, 300, 400];
    const at = (i: number) => bottoms[i]!;
    expect(firstBelow(4, at, 50)).toBe(0);
    expect(firstBelow(4, at, 100)).toBe(1);
    expect(firstBelow(4, at, 250)).toBe(2);
    expect(firstBelow(4, at, 400)).toBe(4);
    expect(firstBelow(0, at, 0)).toBe(0);
  });
});
