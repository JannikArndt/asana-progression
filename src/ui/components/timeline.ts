/** Pure geometry for the timeline graph (time axis, zoom/pan, decimation, hit testing). */

export interface View {
  /** Time at the left edge (s). */
  startS: number;
  pxPerS: number;
  widthPx: number;
  durationS: number;
}

export interface Span {
  id: string;
  startS: number;
  endS: number;
  bestS: number;
  alternatesS?: number[];
  status: 'open' | 'labeled' | 'dismissed';
  label?: string;
}

/** Most zoomed-in scale (px per second). */
export const MAX_PX_PER_S = 60;

export function minPxPerS(durationS: number, widthPx: number): number {
  return durationS > 0 ? widthPx / durationS : 1;
}

export function fitView(durationS: number, widthPx: number): View {
  return { startS: 0, pxPerS: minPxPerS(durationS, widthPx), widthPx, durationS };
}

export function isFit(v: View): boolean {
  return v.pxPerS <= minPxPerS(v.durationS, v.widthPx) * 1.0001;
}

export function clampView(v: View): View {
  const lo = minPxPerS(v.durationS, v.widthPx);
  const pxPerS = Math.min(Math.max(lo, MAX_PX_PER_S), Math.max(lo, v.pxPerS));
  const visible = v.widthPx / pxPerS;
  const startS = Math.min(Math.max(0, v.durationS - visible), Math.max(0, v.startS));
  return { ...v, pxPerS, startS };
}

export function timeToX(v: View, t: number): number {
  return (t - v.startS) * v.pxPerS;
}

export function xToTime(v: View, x: number): number {
  return v.startS + x / v.pxPerS;
}

/** Zooms by `factor` keeping the time under `anchorPx` fixed. */
export function zoomAt(v: View, factor: number, anchorPx: number): View {
  const t = xToTime(v, anchorPx);
  const pxPerS = v.pxPerS * factor;
  return clampView({ ...v, pxPerS, startS: t - anchorPx / pxPerS });
}

export function panBy(v: View, dxPx: number): View {
  return clampView({ ...v, startS: v.startS - dxPx / v.pxPerS });
}

/** Scrolls so that [a, b] is visible, centring it if it is not. Keeps the zoom. */
export function revealSpan(v: View, a: number, b: number): View {
  const visible = v.widthPx / v.pxPerS;
  if (a >= v.startS && b <= v.startS + visible) return v;
  return clampView({ ...v, startS: (a + b) / 2 - visible / 2 });
}

const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];

/** Smallest tick step (s) keeping labels at least `minSpacingPx` apart. */
export function tickStep(pxPerS: number, minSpacingPx = 56): number {
  for (const s of TICK_STEPS) if (s * pxPerS >= minSpacingPx) return s;
  return TICK_STEPS[TICK_STEPS.length - 1]!;
}

export function ticks(v: View, minSpacingPx = 56): number[] {
  const step = tickStep(v.pxPerS, minSpacingPx);
  const end = Math.min(v.durationS, v.startS + v.widthPx / v.pxPerS);
  const out: number[] = [];
  for (let t = Math.ceil(v.startS / step) * step; t <= end + 1e-9; t += step) out.push(t);
  return out;
}

/** mm:ss, or h:mm:ss from one hour. */
export function formatTime(s: number): string {
  const total = Math.max(0, Math.round(s));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${String(m).padStart(2, '0')}:${ss}`;
}

export function formatDuration(s: number): string {
  if (s < 60) return `${Math.round(s)} s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return r ? `${m} min ${r} s` : `${m} min`;
}

/**
 * Min/max envelope of `values` per pixel column of the view. Columns without finite values are
 * NaN. `available` limits reading to the first samples (live mode).
 */
export function envelope(
  values: ArrayLike<number>,
  hz: number,
  v: View,
  available = values.length,
): { min: Float32Array; max: Float32Array } {
  const cols = Math.max(0, Math.ceil(v.widthPx));
  const min = new Float32Array(cols).fill(NaN);
  const max = new Float32Array(cols).fill(NaN);
  const n = Math.min(values.length, available);
  for (let c = 0; c < cols; c++) {
    const a = Math.max(0, Math.floor(xToTime(v, c) * hz));
    const b = Math.min(n, Math.max(a + 1, Math.ceil(xToTime(v, c + 1) * hz)));
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = a; i < b; i++) {
      const x = values[i]!;
      if (!Number.isFinite(x)) continue;
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
    if (hi >= lo) {
      min[c] = lo;
      max[c] = hi;
    }
  }
  return { min, max };
}

/** A y-scale maximum robust to spikes: 99th percentile × 1.15 (or the max if tiny). */
export function robustMax(values: ArrayLike<number>, available = values.length): number {
  const finite: number[] = [];
  for (let i = 0; i < Math.min(values.length, available); i++) {
    const x = values[i]!;
    if (Number.isFinite(x)) finite.push(x);
  }
  if (finite.length === 0) return 1;
  finite.sort((a, b) => a - b);
  const p99 = finite[Math.min(finite.length - 1, Math.floor(finite.length * 0.99))]!;
  const top = p99 > 0 ? p99 * 1.15 : finite[finite.length - 1]!;
  return top > 0 ? top : 1;
}

/** Span under x (px). Prefers the narrowest span when spans overlap. */
export function hitSpan(spans: Span[], v: View, x: number, slopPx = 6): Span | null {
  const t = xToTime(v, x);
  const slop = slopPx / v.pxPerS;
  let best: Span | null = null;
  for (const s of spans) {
    if (t >= s.startS - slop && t <= s.endS + slop) {
      if (!best || s.endS - s.startS < best.endS - best.startS) best = s;
    }
  }
  return best;
}
