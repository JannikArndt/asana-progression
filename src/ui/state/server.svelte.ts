/**
 * The app's server: which mode the page runs in, passkey sign-in, and background sync
 * (push the outbox, pull what other devices changed, upload missing files).
 */
import { OpfsAssetStore, type MetadataStore } from '../../storage';
import { httpApi, pullChanges, pushChanges, SyncError, uploadMissingFiles, type FileOptions, type SyncApi, type SyncProgress } from '../../sync';
import { createPasskey, getPasskey } from '../webauthn';
import { remoteFile } from './remote';

export type Mode = 'local' | 'server';

const SERVER_SEEN = 'asana.server';
const FILE_OPTIONS = 'asana.sync.files';
const PUSH_EVERY_MS = 5_000;
const PULL_EVERY_MS = 60_000;

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLocal(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

async function post<T>(path: string, body: unknown = {}): Promise<T> {
  const res = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new SyncError(json.error ?? `HTTP ${res.status}`, res.status);
  return json;
}

export interface ShareLink {
  token: string;
  kind: 'session' | 'hold';
  target: string;
  createdAt: string;
  url?: string;
  title?: string;
}

class ServerState {
  mode = $state<Mode>('local');
  /** Detection finished (the first screen waits for it). */
  checked = $state(false);
  signedIn = $state(false);
  hasPasskey = $state(true);
  /** Server mode, but not reachable right now (the app works on the local copy). */
  offline = $state(false);
  syncing = $state(false);
  progress = $state<SyncProgress | null>(null);
  pending = $state(0);
  lastSyncAt = $state<string | null>(null);
  error = $state<string | null>(null);
  files = $state<FileOptions>({ clips: true, frames: false });

  private db: MetadataStore | null = null;
  private api: SyncApi = httpApi({ base: '' });
  private assets = new OpfsAssetStore({ remote: remoteFile });
  private timers: ReturnType<typeof setInterval>[] = [];
  private running: Promise<void> | null = null;
  private lastPull = 0;
  private onPulled: ((r: Awaited<ReturnType<typeof pullChanges>>) => void) | null = null;

  constructor() {
    try {
      const f = JSON.parse(readLocal(FILE_OPTIONS) ?? 'null') as Partial<FileOptions> | null;
      if (f) this.files = { clips: f.clips ?? true, frames: f.frames ?? false };
    } catch {
      /* default */
    }
  }

  /** Signed out in server mode: the sign-in screen comes first. */
  get needsSignIn(): boolean {
    return this.mode === 'server' && !this.signedIn && !this.offline;
  }

  async detect(): Promise<void> {
    try {
      const res = await fetch('/api/auth/state', { credentials: 'same-origin', cache: 'no-store' });
      const json = (await res.json().catch(() => null)) as { app?: string; signedIn?: boolean; hasPasskey?: boolean } | null;
      if (res.ok && json?.app === 'asana-progression') {
        this.mode = 'server';
        this.signedIn = !!json.signedIn;
        this.hasPasskey = !!json.hasPasskey;
        writeLocal(SERVER_SEEN, '1');
      }
    } catch {
      // Offline: a device that has used the server keeps working on its local copy.
      if (readLocal(SERVER_SEEN) === '1') {
        this.mode = 'server';
        this.offline = true;
      }
    }
    this.checked = true;
  }

  async signIn(): Promise<void> {
    const options = await post<Record<string, unknown>>('/api/auth/login/options');
    await post('/api/auth/login/verify', { response: await getPasskey(options) });
    this.signedIn = true;
    this.hasPasskey = true;
  }

  /** The first passkey (with the setup token) or another one for a signed-in device. */
  async createPasskey(setupToken?: string, name?: string): Promise<void> {
    const options = await post<Record<string, unknown>>('/api/auth/register/options', { setupToken });
    await post('/api/auth/register/verify', { response: await createPasskey(options), name });
    this.signedIn = true;
    this.hasPasskey = true;
  }

  async signOut(): Promise<void> {
    await post('/api/auth/logout');
    this.signedIn = false;
    this.stop();
  }

  setFiles(f: FileOptions) {
    this.files = f;
    writeLocal(FILE_OPTIONS, JSON.stringify(f));
    void this.sync({ files: true });
  }

  /**
   * Before the catalog seed: a device that never pulled takes the server's data first, so the
   * seed upgrades it instead of pushing a fresh catalog over the user's edits.
   */
  async beforeSeed(db: MetadataStore): Promise<boolean> {
    this.db = db;
    if (this.mode !== 'server' || !this.signedIn) return false;
    if ((await db.settings.get<number>('sync.rev')) !== undefined) return false;
    this.syncing = true;
    try {
      const r = await pullChanges(db, this.assets, this.api, (p) => (this.progress = p), { serverWins: true });
      this.lastSyncAt = new Date().toISOString();
      return r.stores.has('asanas');
    } finally {
      this.syncing = false;
      this.progress = null;
    }
  }

  /** Background sync while the app is open (server mode, signed in). */
  start(db: MetadataStore, onPulled: (r: Awaited<ReturnType<typeof pullChanges>>) => void) {
    this.db = db;
    this.onPulled = onPulled;
    if (this.mode !== 'server' || !this.signedIn) return;
    this.stop();
    this.timers.push(setInterval(() => void this.sync(), PUSH_EVERY_MS));
    document.addEventListener('visibilitychange', this.onVisible);
    void this.sync({ pull: true, files: true });
  }

  stop() {
    for (const t of this.timers.splice(0)) clearInterval(t);
    document.removeEventListener('visibilitychange', this.onVisible);
  }

  private onVisible = () => {
    if (document.visibilityState === 'visible') void this.sync({ pull: true });
  };

  /** One round: push the outbox; pull every minute (or when asked); upload missing files when asked. */
  sync(opts: { pull?: boolean; files?: boolean } = {}): Promise<void> {
    if (this.running) return this.running;
    this.running = this.round(opts).finally(() => (this.running = null));
    return this.running;
  }

  private async round(opts: { pull?: boolean; files?: boolean }) {
    const db = this.db;
    if (!db || this.mode !== 'server' || !this.signedIn) return;
    const pending = await db.outbox.count();
    this.pending = pending;
    const pull = opts.pull || Date.now() - this.lastPull > PULL_EVERY_MS;
    if (!pending && !pull && !opts.files) return;
    this.syncing = true;
    try {
      if (pending) await pushChanges(db, this.assets, this.api, this.files, (p) => (this.progress = p));
      if (opts.files) await uploadMissingFiles(db, this.assets, this.api, this.files, (p) => (this.progress = p));
      if (pull) {
        this.lastPull = Date.now();
        const r = await pullChanges(db, this.assets, this.api);
        if (r.records) this.onPulled?.(r);
      }
      this.pending = await db.outbox.count();
      this.lastSyncAt = new Date().toISOString();
      this.error = null;
      this.offline = false;
    } catch (e) {
      const err = e as SyncError;
      if (err.status === 401) {
        this.signedIn = false;
        this.stop();
      }
      if (err.status === 0) this.offline = true;
      this.error = err.message;
    } finally {
      this.syncing = false;
      this.progress = null;
    }
  }

  // ---- share links --------------------------------------------------------------------

  async share(kind: 'session' | 'hold', id: string): Promise<ShareLink> {
    // The record has to be on the server first.
    await this.sync();
    return post<ShareLink>('/api/shares', { kind, id });
  }

  async shares(): Promise<ShareLink[]> {
    const res = await fetch('/api/shares', { credentials: 'same-origin' });
    if (!res.ok) throw new SyncError(`HTTP ${res.status}`, res.status);
    return ((await res.json()) as { shares: ShareLink[] }).shares;
  }

  /** The cropped picture link previews show (og:image); replaces the previous one. */
  async setSharePreview(token: string, jpeg: Blob): Promise<void> {
    const res = await fetch(`/api/shares/${encodeURIComponent(token)}/preview`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'content-type': 'image/jpeg' },
      body: jpeg,
    });
    if (!res.ok) throw new SyncError(`HTTP ${res.status}`, res.status);
  }

  async unshare(token: string): Promise<void> {
    const res = await fetch(`/api/shares/${encodeURIComponent(token)}`, { method: 'DELETE', credentials: 'same-origin' });
    if (!res.ok) throw new SyncError(`HTTP ${res.status}`, res.status);
  }
}

export const server = new ServerState();

/**
 * Creates (or reuses) the unlisted link of a session or hold, then offers Share… / Copy: the
 * share sheet and the clipboard need a fresh tap on iOS, which the dialog provides.
 */
export async function offerShareLink(kind: 'session' | 'hold', id: string, title: string): Promise<void> {
  const { dialog } = await import('./dialog.svelte');
  const { copyText } = await import('../diagnostics');
  let link: ShareLink;
  try {
    link = await server.share(kind, id);
  } catch (e) {
    await dialog.ask({ title: 'No link', message: (e as Error).message, options: [{ id: 'cancel', label: 'OK' }] });
    return;
  }
  const url = link.url ?? `${location.origin}/s/${link.token}`;
  // The cropped photo for message previews, made fresh each time (the crop may have changed).
  // Without it the server falls back to the uncropped thumbnail.
  await updateSharePreview(link.token, kind, id).catch(() => {});
  const canShare = typeof navigator.share === 'function';
  const choice = await dialog.ask({
    title: 'Link ready',
    message: `${url} — anyone with the link sees the photos, asana names and the day (no notes or places). Remove it any time in Settings → Server.`,
    options: [
      ...(canShare ? [{ id: 'share', label: 'Share…', kind: 'primary' as const }] : []),
      { id: 'copy', label: 'Copy link', kind: canShare ? undefined : ('primary' as const) },
      { id: 'cancel', label: 'Close', kind: 'quiet' as const },
    ],
  });
  if (choice === 'share') await navigator.share({ title, url }).catch(() => {});
  else if (choice === 'copy') await copyText(url);
}

/** Uploads the cropped preview picture of a share: the hold itself, or the session's cover hold. */
async function updateSharePreview(token: string, kind: 'session' | 'hold', id: string): Promise<void> {
  const { app } = await import('./app.svelte');
  const { cropPreview } = await import('./crop-export.svelte');
  const { sessionPreview } = await import('./session-data');
  let holdId: string | null = kind === 'hold' ? id : null;
  if (kind === 'session') {
    const session = app.sessions.find((s) => s.id === id);
    const captured = new Set(app.assets.filter((a) => a.kind === 'still').map((a) => a.holdId));
    holdId = session ? (sessionPreview(session, app.holds, captured)?.id ?? null) : null;
  }
  const jpeg = holdId ? await cropPreview(holdId) : null;
  if (jpeg) await server.setSharePreview(token, jpeg);
}
