/**
 * Deployment update check: on visibilitychange the app fetches version.json (no-store). If the
 * version differs, a subtle banner appears; the reload happens at a quiet moment only (no
 * analysis, capture or backup running) — when the page is hidden, or when the user taps the banner.
 * Hidden-only checks (`addHiddenCheck`, e.g. "no video file selected") keep the automatic reload
 * away from state a reload would lose without being busy; the tap still applies the update.
 */
type QuietCheck = () => boolean;

export function isNewer(current: string, remote: unknown): boolean {
  if (!remote || typeof remote !== 'object') return false;
  const v = (remote as { version?: unknown }).version;
  return typeof v === 'string' && v.length > 0 && v !== current;
}

class Updates {
  available = $state(false);
  remoteVersion = $state<string | null>(null);
  lastChecked = $state<string | null>(null);
  private quietChecks: QuietCheck[] = [];
  private hiddenChecks: QuietCheck[] = [];

  start() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.check();
      else if (this.available && this.isQuiet() && this.mayReloadHidden()) location.reload();
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
      if (isNewer(__APP_VERSION__, json)) {
        this.available = true;
        this.remoteVersion = (json as { version: string }).version;
      }
    } catch {
      // offline: ignore
    }
  }

  /** Reloads now if quiet; returns false if something is still running. */
  applyNow(): boolean {
    if (!this.isQuiet()) return false;
    location.reload();
    return true;
  }
}

export const updates = new Updates();
