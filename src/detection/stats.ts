/** Small numeric helpers used by the detector. All functions ignore NaN where noted. */

/** Finite values of `values`, sorted ascending. */
export function sortedFinite(values: ArrayLike<number>): Float64Array {
  let n = 0;
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i]!)) n++;
  const out = new Float64Array(n);
  let j = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (Number.isFinite(v)) out[j++] = v;
  }
  return out.sort();
}

/** Percentile `p` (0–100) of an ascending array, with linear interpolation. NaN if empty. */
export function percentileSorted(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0]!;
  const pos = (Math.min(100, Math.max(0, p)) / 100) * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(n - 1, lo + 1);
  const frac = pos - lo;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * frac;
}

/** Percentile `p` (0–100) of the finite values. NaN if there are none. */
export function percentile(values: ArrayLike<number>, p: number): number {
  return percentileSorted(sortedFinite(values), p);
}

/**
 * Centred running median with an odd window. At the edges the window is truncated.
 * NaN inputs are ignored; a window without finite values yields NaN.
 */
export function medianFilter(values: ArrayLike<number>, window: number): Float32Array {
  const n = values.length;
  const out = new Float32Array(n);
  const half = Math.max(0, Math.floor(window / 2));
  const buf: number[] = [];
  for (let i = 0; i < n; i++) {
    buf.length = 0;
    const a = Math.max(0, i - half);
    const b = Math.min(n - 1, i + half);
    for (let j = a; j <= b; j++) {
      const v = values[j]!;
      if (Number.isFinite(v)) buf.push(v);
    }
    if (buf.length === 0) {
      out[i] = NaN;
      continue;
    }
    buf.sort((x, y) => x - y);
    const mid = buf.length >> 1;
    out[i] = buf.length % 2 === 1 ? buf[mid]! : (buf[mid - 1]! + buf[mid]!) / 2;
  }
  return out;
}

/** Mean absolute difference of two equally sized byte images. */
export function meanAbsDiff(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.abs(a[i]! - b[i]!);
  return s / n;
}

/** Index of the minimum finite value in [from, to). -1 if none. Ties keep the earliest index. */
export function argminRange(values: ArrayLike<number>, from: number, to: number): number {
  let best = -1;
  let bestV = Infinity;
  for (let i = Math.max(0, from); i < Math.min(values.length, to); i++) {
    const v = values[i]!;
    if (Number.isFinite(v) && v < bestV) {
      bestV = v;
      best = i;
    }
  }
  return best;
}

/**
 * Start index of the window of `len` samples in [from, to) with the lowest sum.
 * Non-finite values count as +Infinity. If the range is shorter than `len`, returns `from`.
 */
export function lowestWindow(values: ArrayLike<number>, from: number, to: number, len: number): number {
  const a = Math.max(0, from);
  const b = Math.min(values.length, to);
  if (len <= 0 || b - a <= len) return a;
  const val = (i: number) => {
    const v = values[i]!;
    return Number.isFinite(v) ? v : 1e12;
  };
  let sum = 0;
  for (let i = a; i < a + len; i++) sum += val(i);
  let best = a;
  let bestSum = sum;
  for (let s = a + 1; s + len <= b; s++) {
    sum += val(s + len - 1) - val(s - 1);
    if (sum < bestSum - 1e-9) {
      bestSum = sum;
      best = s;
    }
  }
  return best;
}
