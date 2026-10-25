/**
 * Deployment update check: on visibilitychange the app fetches version.json (no-store). If its
 * `build` (a content hash of the deployed files, see scripts/stamp-build.mjs) differs from the
 * build this page was loaded with, a subtle banner appears; the reload happens at a quiet moment
 * only (no analysis, capture or backup running) — when the page is hidden, or when the user taps
 * the banner. Hidden-only checks (`addHiddenCheck`, e.g. "no video file selected") keep the
 * automatic reload away from state a reload would lose without being busy; the tap still applies
 * the update.
 *
 * The automatic reload never happens in the page's first 20 s, and never twice for the same build
 * (sessionStorage): Pages serves HTML from a cache for ~10 min, so a reload can land on the old
 * page again, and one build behind beats a reload loop.
 */
import { currentBuild, setBuiltAt } from './build';

type QuietCheck = () => boolean;

export const MIN_PAGE_AGE_MS = 20_000;
const RELOADED_KEY = 'asana.update.reloaded';

export function isNewer(current: string, remote: unknown): boolean {
  if (current === 'dev') return false; // dev server or unstamped build: never check
  if (!remote || typeof remote !== 'object') return false;
  const b = (remote as { build?: unknown }).build;
  return typeof b === 'string' && b.length > 0 && b !== current;
}

/** Whether the automatic reload may happen now for `build`: old enough page, not tried before. */
export function mayAutoReload(build: string, pageAgeMs: number, reloadedFor: string | null): boolean {
  return pageAgeMs >= MIN_PAGE_AGE_MS && reloadedFor !== build;
}

function reloadedFor(): string | null {
  try {
    return sessionStorage.getItem(RELOADED_KEY);
  } catch {
    return null; // storage blocked: the page-age rule still stops a tight loop
  }
}

function rememberReload(build: string) {
  try {
    sessionStorage.setItem(RELOADED_KEY, build);
  } catch {
    // ignore
  }
}

class Updates {
  available = $state(false);
  remoteVersion = $state<string | null>(null);
  lastChecked = $state<string | null>(null);
  /** Build time of this page's own build, once version.json confirmed it is the deployed one. */
  builtAt = $state<string | null>(null);
  private quietChecks: QuietCheck[] = [];
  private hiddenChecks: QuietCheck[] = [];
  private loadedAt = Date.now();

  start() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.check();
      else if (this.available && this.remoteVersion && this.isQuiet() && this.mayReloadHidden() && mayAutoReload(this.remoteVersion, Date.now() - this.loadedAt, reloadedFor())) {
        rememberReload(this.remoteVersion);
        location.reload();
      }
    });
  }

  /** Registers a predicate that must be true for a reload to be acceptable. */
  addQuietCheck(fn: QuietCheck) {
    this.quietChecks.push(fn);
  }

  /** Registers a predicate that must be true for the automatic reload while the page is hidden. */
  addHiddenCheck(fn: QuietCheck) {
    this.hiddenChecks.push(fn);
  }

  isQuiet(): boolean {
    return this.quietChecks.every((f) => f());
  }

  /** Whether the automatic reload (page hidden) loses nothing the user would have to redo. */
  mayReloadHidden(): boolean {
    return this.hiddenChecks.every((f) => f());
  }

  async check(): Promise<void> {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}version.json`, { cache: 'no-store' });
      if (!res.ok) return;
      const json: unknown = await res.json();
      this.lastChecked = new Date().toISOString();
      const mine = currentBuild();
      if (isNewer(mine, json)) {
        this.available = true;
        this.remoteVersion = (json as { build: string }).build;
      } else if (mine !== 'dev' && (json as { build?: unknown } | null)?.build === mine) {
        const at = (json as { builtAt?: unknown }).builtAt;
        this.builtAt = typeof at === 'string' ? at : null;
        setBuiltAt(this.builtAt);
      }
    } catch {
      // offline: ignore
    }
  }

  /** Reloads now if quiet; returns false if something is still running. */
  applyNow(): boolean {
    if (!this.isQuiet()) return false;
    if (this.remoteVersion) rememberReload(this.remoteVersion);
    location.reload();
    return true;
  }
}

export const updates = new Updates();
