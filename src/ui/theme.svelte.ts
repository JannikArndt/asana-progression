/**
 * Appearance: follow the system (default), or force Light / Dark. The choice is a device setting in
 * localStorage (`asana.theme`), applied as `data-theme` on <html>; index.html applies it before the
 * first paint. Canvas drawing reads the colour tokens, so it re-reads them via `onThemeChange`.
 */
export type ThemePref = 'system' | 'light' | 'dark';

const KEY = 'asana.theme';
const LIGHT_BG = '#f7f5f1';
const DARK_BG = '#151412';

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

class Theme {
  pref = $state<ThemePref>('system');
  private listeners = new Set<() => void>();
  private media: MediaQueryList | null = null;

  start() {
    this.pref = readPref();
    this.media = matchMedia('(prefers-color-scheme: dark)');
    this.media.addEventListener('change', () => this.apply());
    this.apply();
  }

  get dark(): boolean {
    return this.pref === 'dark' || (this.pref === 'system' && !!this.media?.matches);
  }

  set(pref: ThemePref) {
    this.pref = pref;
    try {
      if (pref === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, pref);
    } catch {
      // Private mode: the choice lasts for this page only.
    }
    this.apply();
  }

  /** Calls `fn` after every change of the effective theme; returns the unsubscribe function. */
  onThemeChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private apply() {
    const root = document.documentElement;
    if (this.pref === 'system') delete root.dataset.theme;
    else root.dataset.theme = this.pref;
    // One theme-color for the browser UI and the Home Screen app's status bar area.
    for (const m of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) m.remove();
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = this.dark ? DARK_BG : LIGHT_BG;
    document.head.append(meta);
    for (const fn of this.listeners) fn();
  }
}

export const theme = new Theme();
