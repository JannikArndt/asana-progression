<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Asset, Box } from '../../model';
  import { assetUrl } from '../state/capture.svelte';
  import { cropGeometry } from '../state/capture-plan';

  interface Props {
    asset: Asset | undefined;
    /** Normalized crop to show (null = full frame). */
    crop?: Box | null;
    alt?: string;
    /** Fixed container aspect (e.g. 1 for square tiles); the crop is contained inside it. */
    aspect?: number | null;
    /** Swap sources without clearing or fading (flipbook, viewer). */
    instant?: boolean;
    fallback?: Snippet;
  }
  let { asset, crop = null, alt = '', aspect = null, instant = false, fallback }: Props = $props();

  let url = $state<string | null>(null);
  $effect(() => {
    const a = asset;
    let live = true;
    if (!instant) url = null;
    if (a) void assetUrl(a).then((u) => live && (url = u));
    return () => {
      live = false;
    };
  });

  const g = $derived(asset ? cropGeometry(crop, asset.width, asset.height) : null);
</script>

{#if asset && g}
  <div class="frame" style:aspect-ratio={aspect ?? g.aspectRatio} class:contain={aspect !== null}>
    <div class="crop" style:aspect-ratio={g.aspectRatio} style:--ar={g.aspectRatio}>
      {#if url && asset.mime.startsWith('video/')}
        <!-- Clips loop silently while shown (they have no audio track). -->
        <video src={url} autoplay loop muted playsinline aria-label={alt} style:width="{g.width}%" style:left="{g.left}%" style:top="{g.top}%"></video>
      {:else if url}
        <img src={url} {alt} class:fade={!instant} style:width="{g.width}%" style:left="{g.left}%" style:top="{g.top}%" draggable="false" />
      {/if}
    </div>
  </div>
{:else if fallback}
  {@render fallback()}
{/if}

<style>
  .frame {
    position: relative;
    width: 100%;
    overflow: hidden;
    border-radius: var(--radius-m);
    background: var(--color-neutral-tint);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* Contained crop: the largest box of the crop's aspect inside the frame. */
  .frame.contain {
    container-type: size;
  }

  .crop {
    position: relative;
    width: 100%;
    overflow: hidden;
  }

  .contain .crop {
    width: min(100cqw, calc(100cqh * var(--ar)));
  }

  img,
  video {
    position: absolute;
    display: block;
    height: auto;
    max-width: none;
  }

  img.fade {
    opacity: 0;
    animation: appear var(--duration) var(--ease) forwards;
  }

  @keyframes appear {
    to {
      opacity: 1;
    }
  }
</style>
