<script lang="ts">
  import { onMount } from 'svelte';
  import AssetImage from './AssetImage.svelte';
  import { displayCrop, flipbookInterval, typicalAspect, type ProgressionItem } from '../../progression';
  import { assetUrl } from '../state/capture.svelte';
  import { formatDay } from '../format';

  interface Props {
    /** Holds with a still, oldest first. */
    items: ProgressionItem[];
    title: string;
    onclose: () => void;
  }
  let { items, title, onclose }: Props = $props();

  const SPEED_KEY = 'asana.flipbook.fps';
  function savedFps(): number {
    try {
      const v = Number(localStorage.getItem(SPEED_KEY));
      return v > 0 ? v : 3;
    } catch {
      return 3;
    }
  }

  let index = $state(0);
  let playing = $state(true);
  let fps = $state(savedFps());
  let stage: HTMLButtonElement;
  let stageW = $state(0);
  let stageH = $state(0);
  const aspect = $derived(typicalAspect(items));
  const box = $derived.by(() => {
    const w = Math.max(1, Math.min(stageW, stageH * aspect));
    return { w, h: w / aspect };
  });
  const current = $derived(items[index]);

  // Decode the next few stills ahead so frames swap without a gap.
  const decoded = new Set<string>();
  function preload(from: number) {
    for (let k = 1; k <= 3; k++) {
      const it = items[(from + k) % items.length];
      const a = it?.still;
      if (!a || decoded.has(a.id)) continue;
      decoded.add(a.id);
      void assetUrl(a).then((u) => {
        if (!u) return;
        const img = new Image();
        img.src = u;
        void img.decode().catch(() => undefined);
      });
    }
  }

  $effect(() => {
    preload(index);
  });

  $effect(() => {
    if (!playing || items.length < 2) return;
    const id = setInterval(() => {
      index = (index + 1) % items.length;
    }, flipbookInterval(fps));
    return () => clearInterval(id);
  });

  $effect(() => {
    try {
      localStorage.setItem(SPEED_KEY, String(fps));
    } catch {
      /* private mode */
    }
  });

  onMount(() => {
    const ro = new ResizeObserver(() => {
      stageW = stage.clientWidth;
      stageH = stage.clientHeight;
    });
    ro.observe(stage);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onclose();
      else if (e.key === ' ') {
        e.preventDefault();
        playing = !playing;
      }
    };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      ro.disconnect();
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  });
</script>

<div class="flipbook" role="dialog" aria-modal="true" aria-label="{title} flipbook">
  <header>
    <button class="btn quiet" type="button" onclick={onclose} aria-label="Close">✕</button>
    <span class="title">{title}</span>
    <span class="count tabular">{index + 1} / {items.length}</span>
  </header>
  <button class="stage" type="button" bind:this={stage} onclick={() => (playing = !playing)} aria-label={playing ? 'Pause' : 'Play'}>
    {#if current && stageW > 0}
      <div class="media" style:width="{box.w}px" style:height="{box.h}px">
        <AssetImage asset={current.still} crop={displayCrop(current.hold)} {aspect} alt="{title} {formatDay(current.date)}" instant />
      </div>
    {/if}
  </button>
  <footer>
    <p class="date tabular">{current ? formatDay(current.date) : ''}{current?.hold.side ? ` · ${current.hold.side}` : ''}</p>
    <input type="range" min="0" max={Math.max(0, items.length - 1)} step="1" bind:value={index} oninput={() => (playing = false)} aria-label="Frame" />
    <div class="controls">
      <button class="btn" type="button" onclick={() => (playing = !playing)}>{playing ? 'Pause' : 'Play'}</button>
      <label class="speed">
        <span class="tabular">{fps < 1 ? fps.toFixed(1) : Math.round(fps)} / s</span>
        <input type="range" min="0.5" max="12" step="0.5" bind:value={fps} aria-label="Speed (stills per second)" />
      </label>
    </div>
  </footer>
</div>

<style>
  .flipbook {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    flex-direction: column;
    background: var(--color-overlay);
    color: var(--color-on-accent);
    padding: var(--safe-top) var(--safe-right) 0 var(--safe-left);
  }

  header {
    display: grid;
    grid-template-columns: var(--touch) 1fr auto;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-3) 0 var(--space-2);
    min-height: var(--touch);
  }

  header .btn {
    color: inherit;
  }

  .title {
    font-weight: var(--weight-medium);
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .count {
    font-size: var(--text-s);
    opacity: 0.8;
  }

  .stage {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
  }

  .media :global(.frame) {
    height: 100%;
    background: transparent;
  }

  footer {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4) calc(var(--space-4) + var(--safe-bottom));
  }

  .date {
    margin: 0;
    text-align: center;
    font-weight: var(--weight-medium);
  }

  input[type='range'] {
    width: 100%;
    min-height: var(--touch);
    accent-color: var(--color-accent);
  }

  .controls {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .controls .btn {
    background: transparent;
    color: inherit;
    border-color: rgba(255, 255, 255, 0.3);
    min-width: 88px;
  }

  .speed {
    flex: 1;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-s);
  }

  .speed span {
    min-width: 48px;
  }
</style>
