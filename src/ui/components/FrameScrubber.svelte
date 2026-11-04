<script lang="ts">
  import Sheet from './Sheet.svelte';
  import { grayToImageData, sampleReader } from '../state/samples';
  import { formatTime } from './timeline';
  import { app } from '../state/app.svelte';
  import { hqFrame } from '../state/hq-frame';

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
  /** Full-quality frame from the video file (when it is selected), shown once the slider rests. */
  let hqBox: HTMLDivElement;
  let hqIndex = $state<number | null>(null);
  let hqLoading = $state(false);
  const hasFile = $derived(app.files.has(videoId));
  const HQ_DELAY_MS = 220;
  $effect(() => {
    const i = index;
    if (!hasFile) return;
    const timer = setTimeout(() => {
      hqLoading = true;
      void hqFrame(videoId, i / sampleHz, 1600, () => i === index)
        .then((c) => {
          if (!c || i !== index || !hqBox) return;
          c.className = 'hq-canvas';
          hqBox.replaceChildren(c);
          hqIndex = i;
        })
        .catch(() => undefined)
        .finally(() => {
          if (i === index) hqLoading = false;
        });
    }, HQ_DELAY_MS);
    return () => clearTimeout(timer);
  });

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

<Sheet {title} {onclose} action={{ label: confirmLabel, onclick: () => onconfirm(index / sampleHz) }}>
  <div class="frame" style:aspect-ratio="{frameWidth} / {frameHeight}">
    <canvas bind:this={canvas}></canvas>
    <div class="hq" class:shown={hqIndex === index} bind:this={hqBox}></div>
  </div>
  <div class="time tabular">
    {formatTime(index / sampleHz)}<span class="faint">.{String(Math.round(((index / sampleHz) % 1) * 100)).padStart(2, '0')}</span>
    {#if hasFile}<span class="quality faint">{hqIndex === index ? 'full quality' : hqLoading ? 'loading…' : 'preview'}</span>{/if}
  </div>
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
</Sheet>

<style>
  .frame {
    position: relative;
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

  .hq {
    position: absolute;
    inset: 0;
    opacity: 0;
    transition: opacity 120ms linear;
  }

  .hq.shown {
    opacity: 1;
  }

  .hq :global(.hq-canvas) {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .quality {
    margin-left: var(--space-2);
    font-size: var(--text-s);
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
</style>
