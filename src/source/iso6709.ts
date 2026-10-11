import type { GeoLocation } from './types';

/**
 * Converts one ISO 6709 coordinate field to decimal degrees. The integer digits decide the form:
 * degrees (lat ≤ 2, lon ≤ 3 digits), degrees + minutes (4 / 5) or degrees + minutes + seconds (6 / 7).
 */
function degrees(field: string, degDigits: number): number | null {
  const sign = field[0] === '-' ? -1 : 1;
  const body = field.slice(1);
  const dot = body.indexOf('.');
  const int = dot < 0 ? body : body.slice(0, dot);
  const frac = dot < 0 ? '' : body.slice(dot);
  let value: number;
  if (int.length <= degDigits) value = Number(body);
  else if (int.length === degDigits + 2) {
    const min = Number(int.slice(degDigits) + frac);
    if (min >= 60) return null;
    value = Number(int.slice(0, degDigits)) + min / 60;
  } else if (int.length === degDigits + 4) {
    const min = Number(int.slice(degDigits, degDigits + 2));
    const sec = Number(int.slice(degDigits + 2) + frac);
    if (min >= 60 || sec >= 60) return null;
    value = Number(int.slice(0, degDigits)) + min / 60 + sec / 3600;
  } else return null;
  return sign * value;
}

/**
 * Parses an ISO 6709 location string as phones write it into videos, e.g. "+52.5200+013.4050+034.000/"
 * (QuickTime `com.apple.quicktime.location.ISO6709`, MP4 `©xyz`). An optional altitude and a
 * coordinate reference system suffix ("CRSWGS_84") are allowed. Null when it is not a valid location.
 */
export function parseIso6709(s: string | null | undefined): GeoLocation | null {
  if (typeof s !== 'string') return null;
  const m = /^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)?(?:CRS[A-Za-z0-9_:.-]*)?\/?$/.exec(s.trim());
  if (!m) return null;
  const lat = degrees(m[1]!, 2);
  const lon = degrees(m[2]!, 3);
  if (lat === null || lon === null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const altM = m[3] !== undefined ? Number(m[3]) : null;
  return { lat, lon, altM: altM !== null && Number.isFinite(altM) ? altM : null };
}

/** Raw metadata keys that carry an ISO 6709 location, in order of preference. */
export const LOCATION_KEYS = ['com.apple.quicktime.location.ISO6709', '©xyz'] as const;

/** Location from Mediabunny's raw metadata tags (iPhone keys/ilst, MP4 udta), null when absent. */
export function locationFromTags(raw: Record<string, unknown>): GeoLocation | null {
  for (const key of LOCATION_KEYS) {
    const v = raw[key];
    const text = typeof v === 'string' ? v : v instanceof Uint8Array ? new TextDecoder().decode(v).replace(/[^\x20-\x7e]/g, '') : null;
    const loc = parseIso6709(text);
    if (loc) return loc;
  }
  return null;
}
