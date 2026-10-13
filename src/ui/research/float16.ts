/**
 * IEEE 754 half precision for compact signal exports: 2 bytes per value, ~3 significant digits at
 * every magnitude (rounding to fixed decimals would create ties among small motion values and move
 * best frames). Little-endian, base64. NaN and ±Infinity are kept.
 */

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** Half-precision bits of `v` (round to nearest, ties to even). */
export function toFloat16Bits(v: number): number {
  f32[0] = v;
  const x = u32[0]!;
  const sign = (x >>> 16) & 0x8000;
  const exp = (x >>> 23) & 0xff;
  const mant = x & 0x7fffff;
  if (exp === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0);
  const e = exp - 127 + 15;
  if (e >= 0x1f) return sign | 0x7c00;
  if (e <= 0) {
    // Subnormal half (or zero).
    if (e < -10) return sign;
    const m = mant | 0x800000;
    const shift = 14 - e;
    let h = m >>> shift;
    const rest = m & ((1 << shift) - 1);
    const half = 1 << (shift - 1);
    if (rest > half || (rest === half && h & 1)) h++;
    return sign | h;
  }
  let h = (e << 10) | (mant >>> 13);
  const rest = mant & 0x1fff;
  if (rest > 0x1000 || (rest === 0x1000 && h & 1)) h++;
  return sign | h;
}

export function fromFloat16Bits(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exp = (h >>> 10) & 0x1f;
  const mant = h & 0x3ff;
  if (exp === 0) return sign * mant * 2 ** -24;
  if (exp === 0x1f) return mant ? NaN : sign * Infinity;
  return sign * (1 + mant / 1024) * 2 ** (exp - 15);
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function encodeFloat16(values: ArrayLike<number>): string {
  const bytes = new Uint8Array(values.length * 2);
  for (let i = 0; i < values.length; i++) {
    const h = toFloat16Bits(values[i]!);
    bytes[2 * i] = h & 0xff;
    bytes[2 * i + 1] = h >>> 8;
  }
  return toBase64(bytes);
}

export function decodeFloat16(b64: string): Float32Array {
  const bytes = fromBase64(b64);
  const out = new Float32Array(bytes.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = fromFloat16Bits(bytes[2 * i]! | (bytes[2 * i + 1]! << 8));
  return out;
}
