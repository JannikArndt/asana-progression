import { describe, expect, it } from 'vitest';
import { downsampleLuma, lumaBits, rotateGray } from './convert';

describe('downsampleLuma', () => {
  it('averages blocks of an 8-bit plane with stride and offset', () => {
    // 4×2 visible inside a stride of 6, offset 2
    const src = new Uint8Array([99, 99, 10, 10, 30, 30, 99, 99, 10, 10, 30, 30]);
    const out = downsampleLuma(src, 2, 6, 4, 2, 2, 1);
    expect(Array.from(out)).toEqual([10, 30]);
  });
  it('scales 10-bit samples to 8 bits', () => {
    const src = new Uint16Array([1020, 1020, 4, 4]);
    expect(Array.from(downsampleLuma(src, 0, 2, 2, 2, 1, 1, 2))).toEqual([128]);
    expect(Array.from(downsampleLuma(new Uint16Array([1023]), 0, 1, 1, 1, 1, 1, 2))).toEqual([255]);
  });
  it('subsamples large blocks but stays close to the true mean', () => {
    const w = 400;
    const h = 200;
    const src = new Uint8Array(w * h);
    for (let i = 0; i < src.length; i++) src[i] = (i % w) < 200 ? 50 : 200;
    const out = downsampleLuma(src, 0, w, w, h, 4, 2);
    expect(Array.from(out)).toEqual([50, 50, 200, 200, 50, 50, 200, 200]);
  });

  const meanOf = (a: Uint8Array) => a.reduce((s, v) => s + v, 0) / a.length;

  it('does not alias periodic stripes onto one phase', () => {
    // 4K plane, a bright line every 6th row (and every 6th column): true mean ≈ 42.5.
    const w = 3840;
    const h = 2160;
    for (const vertical of [false, true]) {
      const src = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((vertical ? x : y) % 6 === 0) src[y * w + x] = 255;
      const out = downsampleLuma(src, 0, w, w, h, 160, 90);
      expect(Math.abs(meanOf(out) - 42.5)).toBeLessThan(6);
      expect(Math.max(...out)).toBeLessThan(110);
    }
  });

  it('averages noise close to the block mean', () => {
    const w = 960;
    const h = 540;
    const src = new Uint8Array(w * h);
    let seed = 1;
    for (let i = 0; i < src.length; i++) {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      src[i] = 64 + ((seed >>> 16) % 128);
    }
    const out = downsampleLuma(src, 0, w, w, h, 160, 90);
    expect(Math.abs(meanOf(out) - 127.5)).toBeLessThan(3);
    for (const v of out) expect(Math.abs(v - 127.5)).toBeLessThan(25);
  });
});

describe('rotateGray', () => {
  // 3×2 image:  1 2 3
  //             4 5 6
  const img = new Uint8Array([1, 2, 3, 4, 5, 6]);
  it('rotates clockwise', () => {
    expect(rotateGray(img, 3, 2, 0).data).toBe(img);
    expect(rotateGray(img, 3, 2, 90)).toEqual({ data: new Uint8Array([4, 1, 5, 2, 6, 3]), width: 2, height: 3 });
    expect(Array.from(rotateGray(img, 3, 2, 180).data)).toEqual([6, 5, 4, 3, 2, 1]);
    expect(rotateGray(img, 3, 2, 270)).toEqual({ data: new Uint8Array([3, 6, 2, 5, 1, 4]), width: 2, height: 3 });
  });
});

describe('lumaBits', () => {
  it('knows planar formats', () => {
    expect(lumaBits('NV12')).toBe(8);
    expect(lumaBits('I420')).toBe(8);
    expect(lumaBits('I420P10')).toBe(16);
    expect(lumaBits('RGBA')).toBeNull();
    expect(lumaBits(null)).toBeNull();
  });
});
