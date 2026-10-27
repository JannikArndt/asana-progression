<script lang="ts">
  import Sheet from './Sheet.svelte';
  import MetadataToggle from './MetadataToggle.svelte';
  import { canShareFiles, cropExport, preparePhoto, saveFile, shareFiles, type PreparedPhoto } from '../state/crop-export.svelte';
  import { formatBytes } from '../diagnostics';
  import type { ProgressionItem } from '../../progression';

  interface Props {
    item: ProgressionItem;
    onclose: () => void;
  }
  let { item, onclose }: Props = $props();

  let photo = $state.raw<PreparedPhoto | null>(null);
  let error = $state<string | null>(null);
  let url = $state<string | null>(null);

  $effect(() => {
    let live = true;
    preparePhoto(item)
      .then((p) => {
        if (!live) return;
        if (!p) error = 'This hold has no full-resolution still yet.';
        else {
          photo = p;
          url = URL.createObjectURL(p.plain);
        }
      })
      .catch((e: unknown) => live && (error = `Preparing the photo failed: ${(e as Error).message}`));
    return () => {
      live = false;
    };
  });
  $effect(() => {
    const u = url;
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  });

  const file = $derived(photo ? (cropExport.metadata ? photo.tagged : photo.plain) : null);
  const canShare = $derived(!!file && canShareFiles([file]));

  async function share() {
    if (file) error = await shareFiles([file]);
  }
</script>

<Sheet title="Save photo" layer="dialog" {onclose}>
  <div class="body">
    {#if photo && url}
      <img src={url} alt="" style:aspect-ratio="{photo.width} / {photo.height}" />
      <p class="small muted tabular">{file?.name} · {photo.width} × {photo.height} px · {formatBytes(file?.size ?? 0)}</p>
      <MetadataToggle checked={cropExport.metadata} onchange={(on) => cropExport.setMetadata(on)} />
      <div class="actions">
        {#if canShare}<button class="btn primary" type="button" onclick={share}>Share…</button>{/if}
        <button class="btn" class:primary={!canShare} type="button" onclick={() => file && saveFile(file)}>Save</button>
      </div>
    {:else if !error}
      <p class="small muted">Cropping the still…</p>
    {/if}
    {#if error}<p class="small error" role="alert">{error}</p>{/if}
  </div>
</Sheet>

<style>
  .body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding-bottom: var(--space-4);
  }

  img {
    display: block;
    max-width: 100%;
    max-height: 45vh;
    margin: 0 auto;
    border-radius: var(--radius-m);
    background: var(--color-neutral-tint);
  }

  p {
    margin: 0;
  }

  .small {
    font-size: var(--text-s);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .actions .btn {
    flex: 1;
  }

  .error {
    color: var(--color-danger);
  }
</style>
