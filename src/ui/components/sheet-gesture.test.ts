import { describe, expect, it } from 'vitest';
import { DRAG_SLOP, dragOffset, FLICK_VELOCITY, OVERDRAG_PX, releaseAction, releaseVelocity, settleMs, startsDrag } from './sheet-gesture';

describe('sheet gesture', () => {
  it('starts a drag only after the slop, vertically, and from content only at its top going down', () => {
    expect(startsDrag('handle', 0, DRAG_SLOP - 1, 0)).toBeNull();
    expect(startsDrag('handle', 0, 10, 0)).toBe(true);
    expect(startsDrag('handle', 0, -10, 0)).toBe(true);
    expect(startsDrag('handle', 10, 4, 0)).toBe(false);
    expect(startsDrag('content', 0, 10, 0)).toBe(true);
    expect(startsDrag('content', 0, 10, 1)).toBe(false);
    expect(startsDrag('content', 0, -10, 0)).toBe(false);
    expect(startsDrag('content', 12, 10, 0)).toBe(false);
  });

  it('follows the finger down and resists upwards', () => {
    expect(dragOffset(0)).toBe(0);
    expect(dragOffset(120)).toBe(120);
    expect(dragOffset(-10)).toBeLessThan(0);
    expect(dragOffset(-10)).toBeGreaterThan(-10);
    expect(dragOffset(-10_000)).toBeGreaterThan(-OVERDRAG_PX);
  });

  it('measures the release velocity over the last samples', () => {
    expect(releaseVelocity([])).toBe(0);
    expect(releaseVelocity([{ t: 0, y: 5 }])).toBe(0);
    // An early slow part outside the window does not count.
    expect(releaseVelocity([{ t: 0, y: 0 }, { t: 500, y: 10 }, { t: 540, y: 30 }, { t: 580, y: 50 }])).toBeCloseTo(40 / 80);
    expect(releaseVelocity([{ t: 0, y: 100 }, { t: 50, y: 50 }])).toBe(-1);
  });

  it('dismisses past 30 % of the height or on a downward flick, snaps back otherwise', () => {
    expect(releaseAction(0, 600, 2)).toBe('snap');
    expect(releaseAction(-20, 600, 2)).toBe('snap');
    expect(releaseAction(179, 600, 0)).toBe('snap');
    expect(releaseAction(180, 600, 0)).toBe('dismiss');
    expect(releaseAction(30, 600, FLICK_VELOCITY)).toBe('dismiss');
    expect(releaseAction(400, 600, -FLICK_VELOCITY)).toBe('snap');
    expect(releaseAction(400, 600, -0.2)).toBe('dismiss');
  });

  it('keeps a flick’s speed when settling', () => {
    expect(settleMs(500, 0, 250)).toBe(250);
    expect(settleMs(0, 1, 250)).toBe(250);
    expect(settleMs(300, 2, 250)).toBe(150);
    expect(settleMs(100, 5, 250)).toBe(100);
    expect(settleMs(500, 0.6, 250)).toBe(250);
  });
});
