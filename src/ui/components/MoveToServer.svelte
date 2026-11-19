<script lang="ts">
  import { onMount } from 'svelte';
  import { OpfsAssetStore } from '../../storage';
  import { localSizes, type LocalSizes } from '../../sync';
  import { app } from '../state/app.svelte';
  import { move, SERVER_ORIGIN } from '../state/server.svelte';
  import { formatBytes } from '../diagnostics';
  import { WakeLock } from '../pipeline/wake-lock';

  let code = $state('');
  let clips = $state(true);
  let frames = $state(false);
  let sizes = $state<LocalSizes | null>(null);
  const wake = new WakeLock();

  onMount(() => {
    void app.whenReady().then(async () => {
      if (app.ready) sizes = await localSizes(app.db, new OpfsAssetStore());
    });
  });

  const total = $derived(sizes ? sizes.images.bytes + (clips ? sizes.clips.bytes : 0) + (frames ? Math.round(sizes.frames.bytes / 2) : 0) : null);
  const pct = $derived(move.progress && move.progress.bytesTotal ? Math.floor((100 * move.progress.bytesDone) / move.progress.bytesTotal) : 0);
</script>

<section class="group move" aria-labelledby="move-title">
  <h3 class="section-title" id="move-title">Move to asana.jannikarndt.de</h3>
  <p class="small">
    This app now lives on <a href={SERVER_ORIGIN} target="_blank" rel="noopener">asana.jannikarndt.de</a>. Sign in there with your passkey,
    open Settings → <em>Code for the old app</em>, copy the code and paste it here. Everything but the videos is uploaded; you can run it
    again any time, it only sends what is missing.
  </p>
  <label class="field">
    <span class="small">Upload code</span>
    <input
      class="mono"
      type="text"
      autocomplete="off"
      autocapitalize="characters"
      spellcheck="false"
      placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
      bind:value={code}
      disabled={move.running}
    />
  </label>
  <p class="small muted">
    {#if sizes}
      Always: {sizes.records} records, {sizes.images.count} stills and thumbnails ({formatBytes(sizes.images.bytes)}).
    {:else}
      Counting what is on this device…
    {/if}
  </p>
  <label class="check">
    <input type="checkbox" bind:checked={clips} disabled={move.running} />
    <span>Clips{sizes ? ` (${sizes.clips.count}, ${formatBytes(sizes.clips.bytes)})` : ''}</span>
  </label>
  <label class="check">
    <input type="checkbox" bind:checked={frames} disabled={move.running} />
    <span>Analysis frames{sizes ? ` (${sizes.frames.count} videos, ${formatBytes(sizes.frames.bytes)}, about half that gzipped)` : ''}</span>
  </label>
  <p class="small muted">
    Stills and clips are JPEG and MP4 already, so they do not get smaller; the analysis frames are gzipped on the way. Keep this screen
    open (the screen stays on); if it is interrupted, start again and it continues.
  </p>
  <button
    class="btn primary"
    type="button"
    disabled={move.running || !code.trim() || !app.ready}
    onclick={() => move.run(app.db, code, { clips, frames }, SERVER_ORIGIN, wake)}
  >
    {#if move.running}
      {move.progress?.phase === 'records' ? `Sending records… ${move.progress.done} / ${move.progress.total}` : `Uploading… ${pct} % (${formatBytes(move.progress?.bytesDone ?? 0)} of ${formatBytes(move.progress?.bytesTotal ?? total ?? 0)})`}
    {:else}
      Upload{total !== null ? ` about ${formatBytes(total)}` : ''}
    {/if}
  </button>
  {#if move.result}
    <p class="small" role="status">
      Done: {move.result.files} files and {move.result.records} records are on the server. Open
      <a href={SERVER_ORIGIN} target="_blank" rel="noopener">asana.jannikarndt.de</a> and add it to the Home Screen.
    </p>
  {/if}
  {#if move.error}<p class="small error" role="alert">{move.error}</p>{/if}
</section>

<style>
  .group {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .move {
    padding: var(--space-3);
    border: 1px solid var(--color-accent);
    border-radius: var(--radius-m);
    background: var(--color-accent-tint);
  }
  .small {
    font-size: var(--text-s);
    margin: 0;
  }
  .error {
    color: var(--color-danger);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  input[type='text'] {
    min-height: var(--touch);
    font-size: 16px;
    border: 1px solid var(--color-hairline);
    border-radius: var(--radius-s);
    background: var(--color-surface);
    color: inherit;
    padding: 0 var(--space-3);
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
</style>
