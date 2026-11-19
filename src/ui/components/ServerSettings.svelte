<script lang="ts">
  import { onMount } from 'svelte';
  import { server, type ShareLink } from '../state/server.svelte';
  import { copyText, formatBytes } from '../diagnostics';
  import { formatDay } from '../format';
  import { dialog } from '../state/dialog.svelte';

  let links = $state<ShareLink[] | null>(null);
  let message = $state<string | null>(null);
  let error = $state<string | null>(null);

  const pct = $derived(server.progress && server.progress.total ? Math.floor((100 * server.progress.done) / server.progress.total) : null);

  async function loadLinks() {
    try {
      links = await server.shares();
    } catch {
      links = null;
    }
  }

  onMount(() => void loadLinks());

  async function act(fn: () => Promise<unknown>) {
    error = null;
    message = null;
    try {
      await fn();
    } catch (e) {
      const err = e as Error;
      if (err.name !== 'NotAllowedError') error = err.message;
    }
  }

  async function revoke(l: ShareLink) {
    const ok = await dialog.ask({
      title: 'Remove this link?',
      message: `“${l.title ?? l.target}” stops working for everyone who has it.`,
      options: [
        { id: 'go', label: 'Remove link', kind: 'primary' },
        { id: 'cancel', label: 'Cancel', kind: 'quiet' },
      ],
    });
    if (ok !== 'go') return;
    await act(async () => {
      await server.unshare(l.token);
      await loadLinks();
    });
  }

  async function signOut() {
    const ok = await dialog.ask({
      title: 'Sign out?',
      message: 'The data on this device stays; sync stops until you sign in again.',
      options: [
        { id: 'go', label: 'Sign out', kind: 'primary' },
        { id: 'cancel', label: 'Cancel', kind: 'quiet' },
      ],
    });
    if (ok === 'go') await act(() => server.signOut());
  }
</script>

<section class="group" aria-labelledby="server-title">
  <h3 class="section-title" id="server-title">Server</h3>
  {#if !server.signedIn}
    <p class="small muted">{server.offline ? 'Offline: changes stay on this device until the server is reachable.' : 'Signed out.'}</p>
    {#if !server.offline}<button class="btn primary" type="button" onclick={() => act(() => server.signIn().then(() => location.reload()))}>Sign in with passkey</button>{/if}
  {:else}
    <dl class="kv">
      <dt>Sync</dt>
      <dd>
        {#if server.syncing}
          {server.progress?.phase === 'files' ? `Uploading files… ${pct ?? 0} % (${formatBytes(server.progress.bytesDone)} of ${formatBytes(server.progress.bytesTotal)})` : 'Syncing…'}
        {:else if server.offline}
          Offline
        {:else}
          {server.pending ? `${server.pending} change(s) waiting` : 'Up to date'}{server.lastSyncAt ? ` · ${new Date(server.lastSyncAt).toLocaleTimeString()}` : ''}
        {/if}
      </dd>
    </dl>
    {#if server.error}<p class="small error" role="alert">{server.error}</p>{/if}
    <label class="check">
      <input type="checkbox" checked={server.files.clips} onchange={(e) => server.setFiles({ ...server.files, clips: e.currentTarget.checked })} />
      <span>Upload clips</span>
    </label>
    <label class="check">
      <input type="checkbox" checked={server.files.frames} onchange={(e) => server.setFiles({ ...server.files, frames: e.currentTarget.checked })} />
      <span>Upload analysis frames</span>
    </label>
    <p class="small muted">
      Records, stills and thumbnails always go to the server. Clips and the tiny analysis frames (review timeline frames, re-running
      detection on another device) are optional.
    </p>
    <div class="actions">
      <button class="btn" type="button" disabled={server.syncing} onclick={() => act(() => server.sync({ pull: true, files: true }))}>Sync now</button>
    </div>

    <h4 class="sub">Share links</h4>
    {#if links === null}
      <p class="small muted">Not available right now.</p>
    {:else if links.length === 0}
      <p class="small muted">None yet. Share a session from its Poses page, or a photo from the viewer’s Save sheet.</p>
    {:else}
      <ul class="links">
        {#each links as l (l.token)}
          <li>
            <span class="small">{l.title ?? l.target}<span class="muted"> · {l.kind} · {formatDay(l.createdAt)}</span></span>
            <span class="row-actions">
              <button class="btn quiet" type="button" onclick={() => act(async () => { await copyText(`${location.origin}/s/${l.token}`); message = 'Link copied'; })}>Copy</button>
              <button class="btn quiet" type="button" onclick={() => revoke(l)}>Remove</button>
            </span>
          </li>
        {/each}
      </ul>
    {/if}

    <h4 class="sub">Passkeys</h4>
    <div class="actions">
      <button class="btn" type="button" onclick={() => act(async () => { await server.createPasskey(undefined, 'Added in Settings'); message = 'Passkey added'; })}>Add a passkey…</button>
      <button class="btn quiet" type="button" onclick={signOut}>Sign out</button>
    </div>
    <p class="small muted">Passkeys in iCloud Keychain reach your other Apple devices by themselves; add one here for any other device.</p>
  {/if}
  {#if message}<p class="small" role="status">{message}</p>{/if}
  {#if error}<p class="small error" role="alert">{error}</p>{/if}
</section>

<style>
  .group {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .small {
    font-size: var(--text-s);
  }
  .error {
    color: var(--color-danger);
  }
  .check {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--touch);
    font-size: var(--text-s);
  }
  .check input {
    width: 20px;
    height: 20px;
  }
  .sub {
    margin: var(--space-2) 0 0;
    font-size: var(--text-s);
    font-weight: 600;
  }
  .links {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .links li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    border-bottom: 1px solid var(--color-hairline);
    min-height: var(--touch);
  }
  .row-actions {
    display: flex;
    flex-shrink: 0;
  }
</style>
