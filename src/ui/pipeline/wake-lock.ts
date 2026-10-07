/** Screen Wake Lock while processing; re-acquired when the page becomes visible again. */
export class WakeLock {
  private sentinel: WakeLockSentinel | null = null;
  private wanted = false;
  status: 'unsupported' | 'off' | 'on' | 'error' = 'off';
  onchange: (() => void) | null = null;

  constructor() {
    if (!('wakeLock' in navigator)) this.status = 'unsupported';
    document.addEventListener('visibilitychange', () => {
      if (this.wanted && document.visibilityState === 'visible') void this.acquire();
    });
  }

  async enable(): Promise<void> {
    this.wanted = true;
    await this.acquire();
  }

  async disable(): Promise<void> {
    this.wanted = false;
    const s = this.sentinel;
    this.sentinel = null;
    if (s && !s.released) await s.release().catch(() => {});
    if (this.status !== 'unsupported') this.set('off');
  }

  private async acquire(): Promise<void> {
    if (this.status === 'unsupported' || (this.sentinel && !this.sentinel.released)) return;
    try {
      this.sentinel = await navigator.wakeLock.request('screen');
      this.set('on');
      this.sentinel.addEventListener('release', () => {
        if (this.status === 'on') this.set('off');
      });
    } catch {
      this.set('error');
    }
  }

  private set(s: WakeLock['status']) {
    this.status = s;
    this.onchange?.();
  }
}
