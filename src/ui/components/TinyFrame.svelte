<script lang="ts">
  import { grayToImageData, sampleReader } from '../state/samples';

  interface Props {
    videoId: string;
    frameWidth: number;
    frameHeight: number;
    index: number;
    version?: number;
    alt?: string;
  }
  let { videoId, frameWidth, frameHeight, index, version = 0, alt = '' }: Props = $props();
  let canvas: HTMLCanvasElement;
  let missing = $state(false);

  $effect(() => {
    const args = { videoId, frameWidth, frameHeight, index, version };
    let cancelled = false;
    void (async () => {
      const reader = await sampleReader(args.videoId, args.frameWidth * args.frameHeight);
      if (cancelled) return;
      if (!reader) {
        missing = true;
        return;
      }
      try {
        const data = await reader.read(Math.max(0, args.index));
        if (cancelled || !canvas) return;
        canvas.width = args.frameWidth;
        canvas.height = args.frameHeight;
        canvas.getContext('2d')?.putImageData(grayToImageData(data, args.frameWidth, args.frameHeight), 0, 0);
        missing = false;
      } catch {
        missing = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  });
</script>

<div class="tiny" style:aspect-ratio="{frameWidth} / {frameHeight}" class:missing role="img" aria-label={alt}>
  <canvas bind:this={canvas} aria-hidden="true"></canvas>
</div>

<style>
  .tiny {
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

  .missing canvas {
    visibility: hidden;
  }
</style>
