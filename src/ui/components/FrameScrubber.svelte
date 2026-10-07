<script lang="ts">
  import Sheet from './Sheet.svelte';
  import { grayToImageData, sampleReader } from '../state/samples';
  import { formatTime } from './timeline';

  interface Props {
    title: string;
    confirmLabel: string;
    videoId: string;
    frameWidth: number;
    frameHeight: number;
    sampleHz: number;
    fromS: number;
    toS: number;
    valueS: number;
    /** Times worth jumping to (e.g. alternates). */
    marks?: number[];
    onconfirm: (t: number) => void;
    onclose: () => void;
  }
  let { title, confirmLabel, videoId, frameWidth, frameHeight, sampleHz, fromS, toS, valueS, marks = [], onconfirm, onclose }: Props = $props();

  const first = $derived(Math.max(0, Math.ceil(fromS * sampleHz)));
  const last = $derived(Math.max(first, Math.floor(toS * sampleHz) - 1));
  let index = $state(0);
  let canvas: HTMLCanvasElement;
  let request = 0;

  $effect.pre(() => {
    index = Math.min(last, Math.max(first, Math.round(valueS * sampleHz)));
  });

  $effect(() => {
    const i = index;
    const id = ++request;
    void (async () => {
      const reader = await sampleReader(videoId, frameWidth * frameHeight);
      if (!reader || id !== request) return;
      try {
        const data = await reader.read(i);
        if (id !== request || !canvas) return;
        canvas.width = frameWidth;
        canvas.height = frameHeight;
        canvas.getContext('2d')?.putImageData(grayToImageData(data, frameWidth, frameHeight), 0, 0);
      } catch {
        // out of range
      }
    })();
  });

  function step(d: number) {
    index = Math.min(last, Math.max(first, index + d));
  }
</script>

<Sheet {title} {onclose}>
  <div class="frame" style:aspect-ratio="{frameWidth} / {frameHeight}">
    <canvas bind:this={canvas}></canvas>
  </div>
  <div class="time tabular">{formatTime(index / sampleHz)}<span class="faint">.{String(Math.round(((index / sampleHz) % 1) * 100)).padStart(2, '0')}</span></div>
  <input
    class="slider"
    type="range"
    min={first}
    max={last}
    step="1"
    bind:value={index}
    aria-label="Frame"
  />
  <div class="steps">
    <button class="btn" type="button" onclick={() => step(-4)}>−1 s</button>
    <button class="btn" type="button" onclick={() => step(-1)}>‹</button>
    <button class="btn" type="button" onclick={() => step(1)}>›</button>
    <button class="btn" type="button" onclick={() => step(4)}>+1 s</button>
  </div>
  {#if marks.length}
    <div class="marks">
      {#each marks as m (m)}
        <button class="btn quiet" type="button" onclick={() => (index = Math.round(m * sampleHz))}>{formatTime(m)}</button>
      {/each}
    </div>
  {/if}
  {#snippet footer()}
    <button class="btn primary wide" type="button" onclick={() => onconfirm(index / sampleHz)}>{confirmLabel}</button>
  {/snippet}
</Sheet>

<style>
  .frame {
    width: 100%;
    overflow: hidden;
    border-radius: var(--radius-m);
    background: var(--color-neutral-tint);
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }

  .time {
    margin-top: var(--space-2);
    text-align: center;
    font-size: var(--text-l);
  }

  .slider {
    width: 100%;
    min-height: var(--touch);
    accent-color: var(--color-accent);
  }

  .steps,
  .marks {
    display: flex;
    justify-content: center;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .wide {
    width: 100%;
  }
</style>
