import { describe, expect, it } from 'vitest';
import { dismissOffset, dismissProgress, gestureAxis, isTap, shouldDismiss } from './viewer-gestures';

describe('gestureAxis', () => {
  it('waits for the slop', () => {
    expect(gestureAxis(0, 0)).toBeNull();
    expect(gestureAxis(6, 6)).toBeNull();
    expect(gestureAxis(3, 4, 5)).toBe('y');
  });
  it('picks the dominant axis', () => {
    expect(gestureAxis(12, 3)).toBe('x');
    expect(gestureAxis(-12, 11)).toBe('x');
    expect(gestureAxis(4, 15)).toBe('y');
    expect(gestureAxis(-2, -20)).toBe('y');
    expect(gestureAxis(10, 10)).toBe('x');
  });
});

describe('isTap', () => {
  it('needs a short press without movement', () => {
    expect(isTap(2, 120)).toBe(true);
    expect(isTap(12, 120)).toBe(false);
    expect(isTap(2, 600)).toBe(false);
  });
});

describe('dismiss', () => {
  it('follows down and resists up', () => {
    expect(dismissOffset(80)).toBe(80);
    expect(dismissOffset(-80)).toBe(-20);
  });
  it('fades with the distance', () => {
    expect(dismissProgress(0, 600)).toBe(0);
    expect(dismissProgress(150, 600)).toBe(0.5);
    expect(dismissProgress(900, 600)).toBe(1);
    expect(dismissProgress(-50, 600)).toBe(0);
    expect(dismissProgress(50, 0)).toBe(0);
  });
  it('closes past the threshold or on a flick, else snaps back', () => {
    expect(shouldDismiss(130, 0, 600)).toBe(true);
    expect(shouldDismiss(100, 0.1, 600)).toBe(false);
    expect(shouldDismiss(40, 0.8, 600)).toBe(true);
    expect(shouldDismiss(15, 0.8, 600)).toBe(false);
    expect(shouldDismiss(-200, 2, 600)).toBe(false);
  });
});
