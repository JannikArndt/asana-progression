<script lang="ts">
  import { poseOverlay, type PoseDetection } from '../../crop';
  import type { Box } from '../../model';

  interface Props {
    detection: Pick<PoseDetection, 'landmarks' | 'box' | 'posture'>;
    /** Crop the image is shown with (null = full frame). */
    crop: Box | null;
    width: number;
    height: number;
  }
  let { detection, crop, width, height }: Props = $props();

  const o = $derived(poseOverlay(detection, crop, width, height));
</script>

<svg class="pose" viewBox="0 0 {width} {height}" {width} {height} role="img" aria-label="Pose landmarks{detection.posture ? `, ${detection.posture}` : ''}">
  {#if o.box}
    <rect class="box" x={o.box.x} y={o.box.y} width={o.box.w} height={o.box.h} />
  {/if}
  {#each o.lines as l, i (i)}
    <line class="bone" class:dim={l.dim} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
  {/each}
  {#each o.points as p, i (i)}
    <circle class="joint" class:dim={p.dim} cx={p.x} cy={p.y} r="3.5" />
  {/each}
</svg>

<style>
  .pose {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }

  .box {
    fill: none;
    stroke: var(--color-on-accent);
    stroke-width: 1.5;
    stroke-dasharray: 6 5;
    opacity: 0.85;
  }

  .bone {
    stroke: var(--color-pose);
    stroke-width: 2.5;
    stroke-linecap: round;
    filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.6));
  }

  .joint {
    fill: var(--color-accent);
    stroke: var(--color-on-accent);
    stroke-width: 1.5;
  }

  .dim {
    opacity: 0.3;
  }
</style>
