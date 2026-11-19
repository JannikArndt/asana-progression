/**
 * Desktop or phone: `wide` = at least 1000 px (the desktop layout: more columns, the page uses the
 * width), `mouse` = a fine pointer that can hover (buttons for what a phone does with a swipe).
 * Live: both follow window resizes.
 */
export const WIDE_QUERY = '(min-width: 1000px)';
const MOUSE_QUERY = '(hover: hover) and (pointer: fine)';

function media(query: string): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query) : null;
}

class Viewport {
  wide = $state(false);
  mouse = $state(false);

  constructor() {
    const w = media(WIDE_QUERY);
    const m = media(MOUSE_QUERY);
    this.wide = !!w?.matches;
    this.mouse = !!m?.matches;
    w?.addEventListener('change', (e) => (this.wide = e.matches));
    m?.addEventListener('change', (e) => (this.mouse = e.matches));
  }
}

export const viewport = new Viewport();

/** Grid columns a screen offers: fewer on the phone, more on the desktop. */
export interface ColumnRange {
  min: number;
  max: number;
  initial: number;
}

export function clampColumns(n: number | undefined, r: ColumnRange): number {
  return Math.min(r.max, Math.max(r.min, Math.round(n ?? r.initial)));
}
