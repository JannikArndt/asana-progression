import { describe, expect, it } from 'vitest';
import { clipSize, halvingSteps, rebaseTimestamps, thumbSize } from './sizes';

describe('clipSize', () => {
  it('scales the short side to 720 or 1080 and keeps the aspect ratio', () => {
    expect(clipSize(3840, 2160, '1080p')).toEqual({ width: 1920, height: 1080 });
    expect(clipSize(3840, 2160, '720p')).toEqual({ width: 1280, height: 720 });
    expect(clipSize(2160, 3840, '720p')).toEqual({ width: 720, height: 1280 });
    expect(clipSize(4032, 3024, '720p')).toEqual({ width: 960, height: 720 });
    expect(clipSize(1920, 1088, '1080p')).toEqual({ width: 1906, height: 1080 });
  });

  it('never upscales and rounds down to even sizes when the source is smaller', () => {
    expect(clipSize(1280, 720, '1080p')).toEqual({ width: 1280, height: 720 });
    expect(clipSize(853, 479, '1080p')).toEqual({ width: 852, height: 478 });
    expect(clipSize(1, 1, '720p')).toEqual({ width: 2, height: 2 });
  });

  it("keeps the (even) display size for 'original'", () => {
    expect(clipSize(3840, 2160, 'original')).toEqual({ width: 3840, height: 2160 });
    expect(clipSize(1081, 1921, 'original')).toEqual({ width: 1080, height: 1920 });
  });

  it('always returns even sizes within the source and the target', () => {
    let seed = 42;
    const rand = (n: number) => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % n;
    for (let i = 0; i < 500; i++) {
      const w = 2 + rand(5000);
      const h = 2 + rand(5000);
      for (const q of ['720p', '1080p'] as const) {
        const s = clipSize(w, h, q);
        expect(s.width % 2).toBe(0);
        expect(s.height % 2).toBe(0);
        expect(s.width).toBeLessThanOrEqual(w);
        expect(s.height).toBeLessThanOrEqual(h);
        expect(Math.min(s.width, s.height)).toBeLessThanOrEqual(q === '720p' ? 720 : 1080);
        if (Math.min(w, h) >= 200) expect(Math.abs(s.width / s.height / (w / h) - 1)).toBeLessThan(0.02);
      }
    }
  });

  it('rejects invalid sizes', () => {
    expect(() => clipSize(0, 1080, '720p')).toThrow(RangeError);
    expect(() => clipSize(1920, Number.NaN, '720p')).toThrow(RangeError);
    expect(() => clipSize(Infinity, 1080, 'original')).toThrow(RangeError);
  });
});

describe('thumbSize', () => {
  it('scales the long side to 512 by default', () => {
    expect(thumbSize(3840, 2160)).toEqual({ width: 512, height: 288 });
    expect(thumbSize(2160, 3840)).toEqual({ width: 288, height: 512 });
    expect(thumbSize(1920, 1080, 640)).toEqual({ width: 640, height: 360 });
  });

  it('never upscales and keeps at least one pixel', () => {
    expect(thumbSize(300, 200)).toEqual({ width: 300, height: 200 });
    expect(thumbSize(10000, 1)).toEqual({ width: 512, height: 1 });
    expect(() => thumbSize(-1, 10)).toThrow(RangeError);
  });
});

describe('halvingSteps', () => {
  it('halves until the last step reduces by at most 2×', () => {
    expect(halvingSteps({ width: 3840, height: 2160 }, { width: 512, height: 288 })).toEqual([
      { width: 1920, height: 1080 },
      { width: 960, height: 540 },
    ]);
    expect(halvingSteps({ width: 1001, height: 501 }, { width: 100, height: 50 })).toEqual([
      { width: 501, height: 251 },
      { width: 251, height: 126 },
      { width: 126, height: 63 },
    ]);
  });

  it('needs no steps for small reductions or equal sizes', () => {
    expect(halvingSteps({ width: 1024, height: 576 }, { width: 512, height: 288 })).toEqual([]);
    expect(halvingSteps({ width: 640, height: 360 }, { width: 640, height: 360 })).toEqual([]);
    expect(halvingSteps({ width: 4000, height: 100 }, { width: 512, height: 13 })).toEqual([
      { width: 2000, height: 50 },
      { width: 1000, height: 25 },
    ]);
  });

  it('terminates for degenerate targets', () => {
    expect(halvingSteps({ width: 8, height: 8 }, { width: 0, height: 0 })).toEqual([
      { width: 4, height: 4 },
      { width: 2, height: 2 },
    ]);
  });
});

describe('rebaseTimestamps', () => {
  it('uses the minimum presentation timestamp of packets in decode order', () => {
    const r = rebaseTimestamps([
      { timestampS: 10.5, durationS: 0.1 },
      { timestampS: 10.8, durationS: 0.1 },
      { timestampS: 10.6, durationS: 0.1 },
      { timestampS: 10.7, durationS: 0.1 },
    ])!;
    expect(r.offsetS).toBe(10.5);
    expect(r.startS).toBe(10.5);
    expect(r.endS).toBeCloseTo(10.9, 9);
  });

  it('handles open-GOP leading frames before the key frame and missing durations', () => {
    const r = rebaseTimestamps([
      { timestampS: 2, durationS: 0.5 },
      { timestampS: 1.5, durationS: 0.5 },
      { timestampS: 3, durationS: -1 },
    ])!;
    expect(r).toEqual({ offsetS: 1.5, startS: 1.5, endS: 3 });
  });

  it('returns null without packets', () => {
    expect(rebaseTimestamps([])).toBeNull();
  });
});
