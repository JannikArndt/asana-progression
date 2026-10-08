<script lang="ts">
  import type { Snippet } from 'svelte';
  import AssetImage from './AssetImage.svelte';
  import type { Asset, Box } from '../../model';

  interface Props {
    asset: Asset | undefined;
    crop?: Box | null;
    alt?: string;
    aspect?: number | null;
    fallback?: Snippet;
  }
  let { asset, crop = null, alt = '', aspect = null, fallback }: Props = $props();

  let el: HTMLDivElement;
  let visible = $state(false);

  $effect(() => {
    if (visible || !el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          visible = true;
          io.disconnect();
        }
      },
      { rootMargin: '600px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  });
</script>

<div bind:this={el} class="lazy" style:aspect-ratio={!visible ? (aspect ?? (asset ? asset.width / asset.height : 16 / 9)) : null}>
  {#if visible}
    <AssetImage {asset} {crop} {alt} {aspect} {fallback} />
  {/if}
</div>

<style>
  .lazy {
    width: 100%;
    border-radius: var(--radius-m);
    background: var(--color-neutral-tint);
  }
</style>
