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

/**
 * Centred rolling percentile: out[i] = percentile `p` of the finite values in [i − half, i + half]
 * (truncated at the edges), NaN where that window has none. Keeps the window sorted (binary search
 * + shift), O(n · window).
 */
export function rollingPercentile(values: ArrayLike<number>, half: number, p: number): Float32Array {
  const n = values.length;
  const h = Math.max(0, Math.floor(half));
  const out = new Float32Array(n);
  const win = new Float64Array(Math.min(n, 2 * h + 1) + 1);
  let k = 0;
  // First index with win[idx] >= v.
  const lowerBound = (v: number) => {
    let lo = 0;
    let hi = k;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (win[mid]! < v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const add = (v: number) => {
    if (!Number.isFinite(v)) return;
    const at = lowerBound(v);
    win.copyWithin(at + 1, at, k);
    win[at] = v;
    k++;
  };
  const remove = (v: number) => {
    if (!Number.isFinite(v)) return;
    const at = lowerBound(v);
    win.copyWithin(at, at + 1, k);
    k--;
  };
  for (let j = 0; j < Math.min(n, h); j++) add(values[j]!);
  for (let i = 0; i < n; i++) {
    if (i + h < n) add(values[i + h]!);
    if (i - h - 1 >= 0) remove(values[i - h - 1]!);
    out[i] = percentileSorted(win.subarray(0, k), p);
  }
  return out;
}

/**
 * Local minima of `value` in [a, b) with their prominence: from the minimum, the highest value
 * passed on each side before reaching a lower point (or the span's end); the lower of the two
 * sides minus the minimum. A plateau counts once (its first sample). NaN samples are skipped.
 */
export function valleyProminence(value: (i: number) => number, a: number, b: number): Array<{ at: number; prominence: number }> {
  const idx: number[] = [];
  for (let i = a; i < b; i++) if (!Number.isNaN(value(i))) idx.push(i);
  const v = idx.map(value);
  const out: Array<{ at: number; prominence: number }> = [];
  for (let j = 0; j < v.length; j++) {
    const x = v[j]!;
    if (j > 0 && v[j - 1]! <= x) continue;
    let r = j;
    while (r + 1 < v.length && v[r + 1] === x) r++;
    if (r + 1 < v.length && v[r + 1]! < x) continue;
    let left = x;
    for (let l = j - 1; l >= 0 && v[l]! >= x; l--) left = Math.max(left, v[l]!);
    let right = x;
    for (let q = r + 1; q < v.length && v[q]! >= x; q++) right = Math.max(right, v[q]!);
    out.push({ at: idx[j]!, prominence: Math.min(left, right) - x });
  }
  return out;
}
