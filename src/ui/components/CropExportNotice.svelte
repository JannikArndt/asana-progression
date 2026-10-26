<script lang="ts">
  import { cropExport } from '../state/crop-export.svelte';
  import { formatBytes } from '../diagnostics';

  interface Props {
    /** Only the export prepared by this screen is shown. */
    scope: string;
  }
  let { scope }: Props = $props();

  const preparing = $derived(cropExport.preparing?.scope === scope ? cropExport.preparing : null);
  const ready = $derived(cropExport.ready?.scope === scope ? cropExport.ready : null);
  const error = $derived(cropExport.error?.scope === scope ? cropExport.error.message : null);
</script>

{#if preparing || ready || error}
  <div class="card notice" role="status">
    {#if preparing}
      <p class="small">Cropping the stills… {preparing.done} / {preparing.total}</p>
    {:else if ready}
      {@const n = ready.images.length}
      <div class="head">
        <p class="small">
          {n} cropped {n === 1 ? 'photo' : 'photos'} ready ({formatBytes(ready.zip.size)}){ready.skipped
            ? `; ${ready.skipped} ${ready.skipped === 1 ? 'hold has' : 'holds have'} no full-resolution still yet and ${ready.skipped === 1 ? 'is' : 'are'} not included`
            : ''}.
        </p>
        <button class="btn quiet close" type="button" aria-label="Close" onclick={() => cropExport.dismiss()}>✕</button>
      </div>
      <div class="actions">
        {#if cropExport.canShare}<button class="btn primary" type="button" onclick={() => cropExport.share()}>Share {n === 1 ? 'photo' : `${n} photos`}…</button>{/if}
        <button class="btn" class:primary={!cropExport.canShare} type="button" onclick={() => cropExport.save()}>Save ZIP</button>
      </div>
    {/if}
    {#if error}
      <div class="head">
        <p class="small error" role="alert">{error}</p>
        <button class="btn quiet close" type="button" aria-label="Close" onclick={() => cropExport.dismiss()}>✕</button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .notice {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
  }

  .notice p {
    margin: 0;
  }

  .small {
    font-size: var(--text-s);
  }

  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .close {
    flex: none;
    margin: calc(-1 * var(--space-2)) calc(-1 * var(--space-3)) 0 0;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .error {
    color: var(--color-danger);
  }
</style>
