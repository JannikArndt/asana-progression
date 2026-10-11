import { describe, expect, it } from 'vitest';
import { locationFromTags, parseIso6709 } from './iso6709';

describe('parseIso6709', () => {
  it('reads iPhone locations with altitude', () => {
    expect(parseIso6709('+52.5200+013.4050+034.000/')).toEqual({ lat: 52.52, lon: 13.405, altM: 34 });
  });

  it('reads locations without altitude, negative latitude', () => {
    expect(parseIso6709('-33.8688+151.2093/')).toEqual({ lat: -33.8688, lon: 151.2093, altM: null });
    expect(parseIso6709('+40.6892-074.0445')).toEqual({ lat: 40.6892, lon: -74.0445, altM: null });
  });

  it('reads a zero altitude and surrounding whitespace', () => {
    expect(parseIso6709(' +48.8577+002.2950+0.0/ ')).toEqual({ lat: 48.8577, lon: 2.295, altM: 0 });
  });

  it('accepts a coordinate reference system suffix', () => {
    expect(parseIso6709('+27.5916+086.5640+8850CRSWGS_84/')).toEqual({ lat: 27.5916, lon: 86.564, altM: 8850 });
    expect(parseIso6709('+27.5916+086.5640CRSWGS_84/')).toEqual({ lat: 27.5916, lon: 86.564, altM: null });
  });

  it('reads degrees + minutes and degrees + minutes + seconds', () => {
    const dm = parseIso6709('+5231.20+01324.30/')!;
    expect(dm.lat).toBeCloseTo(52 + 31.2 / 60, 9);
    expect(dm.lon).toBeCloseTo(13 + 24.3 / 60, 9);
    const dms = parseIso6709('-334112.5+1511233.4/')!;
    expect(dms.lat).toBeCloseTo(-(33 + 41 / 60 + 12.5 / 3600), 9);
    expect(dms.lon).toBeCloseTo(151 + 12 / 60 + 33.4 / 3600, 9);
  });

  it('rejects garbage and out-of-range values', () => {
    for (const s of [null, undefined, '', 'Berlin', '52.52,13.40', '+52.52', '+95.0000+013.4050/', '+52.5200+190.0000/', '+5260.00+01324.30/', '+523160+0132430/', '+523112+0136030/', '+123+1234/', '+52.5200+013.4050+abc/']) {
      expect(parseIso6709(s)).toBeNull();
    }
  });
});

describe('locationFromTags', () => {
  it('prefers the QuickTime key, falls back to ©xyz', () => {
    expect(locationFromTags({ 'com.apple.quicktime.location.ISO6709': '+52.5200+013.4050+034.000/', '©xyz': '+1.0000+002.0000/' })?.lat).toBe(52.52);
    expect(locationFromTags({ 'com.apple.quicktime.location.ISO6709': 'junk', '©xyz': '+1.0000+002.0000/' })).toEqual({ lat: 1, lon: 2, altM: null });
  });

  it('decodes byte values and ignores missing tags', () => {
    expect(locationFromTags({ '©xyz': new TextEncoder().encode('\u0000+1.5000-002.2500/') })).toEqual({ lat: 1.5, lon: -2.25, altM: null });
    expect(locationFromTags({ '©xyz': 42 })).toBeNull();
    expect(locationFromTags({})).toBeNull();
  });
});
