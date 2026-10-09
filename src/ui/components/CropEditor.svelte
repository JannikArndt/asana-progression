<script lang="ts">
  import { onMount } from 'svelte';
  import type { Asset, Box, Hold } from '../../model';
  import { assetUrl } from '../state/capture.svelte';
  import { clampView, cropFromView, effectiveCrop, FULL_FRAME, viewForCrop } from '../state/capture-plan';

  interface Props {
    hold: Hold;
    still: Asset;
    title?: string;
    onsave: (manual: Box | null) => void;
    onclose: () => void;
  }
  let { hold, still, title = 'Crop', onsave, onclose }: Props = $props();

  const ASPECTS: Array<{ id: string; label: string; value: number | null }> = [
    { id: 'current', label: 'Free', value: null },
    { id: '4:5', label: '4:5', value: 4 / 5 },
    { id: '1:1', label: '1:1', value: 1 },
    { id: '3:2', label: '3:2', value: 3 / 2 },
    { id: '16:9', label: '16:9', value: 16 / 9 },
  ];

  let stage: HTMLDivElement;
  let url = $state<string | null>(null);
  let stageW = $state(0);
  let stageH = $state(0);
  let aspect = $state<number>(1);
  let aspectId = $state('current');
  let view = $state({ s: 1, tx: 0, ty: 0 });
  const imgW = $derived(still.width);
  const imgH = $derived(still.height);

  /** The crop frame: largest rectangle of the chosen aspect inside the stage, with a margin. */
  const frame = $derived.by<Box>(() => {
    const m = 24;
    const w = Math.max(10, stageW - 2 * m);
    const h = Math.max(10, stageH - 2 * m);
    const fw = Math.min(w, h * aspect);
    const fh = fw / aspect;
    return { x: (stageW - fw) / 2, y: (stageH - fh) / 2, w: fw, h: fh };
  });

  function reset(to: Box) {
    view = clampView(frame, viewForCrop(frame, to, imgW, imgH), imgW, imgH, maxScale());
  }

  function maxScale(): number {
    return (8 * frame.w) / imgW;
  }

  function setAspect(id: string, value: number | null) {
    const crop = cropFromView(frame, view, imgW, imgH);
    aspectId = id;
    aspect = value ?? (crop.w * imgW) / (crop.h * imgH);
    queueMicrotask(() => reset(crop));
  }

  onMount(() => {
    void assetUrl(still).then((u) => (url = u));
    const start = effectiveCrop(hold) ?? FULL_FRAME;
    aspect = (start.w * imgW) / (start.h * imgH);
    const ro = new ResizeObserver(() => {
      const keep = stageW > 0 ? cropFromView(frame, view, imgW, imgH) : start;
      stageW = stage.clientWidth;
      stageH = stage.clientHeight;
      queueMicrotask(() => reset(keep));
    });
    ro.observe(stage);
    return () => ro.disconnect();
  });

  // ----- gestures: one finger pans, two fingers pinch -----
  const pointers = new Map<number, { x: number; y: number }>();
  let startView = { s: 1, tx: 0, ty: 0 };
  let startPts: Array<{ x: number; y: number }> = [];

  function snapshot() {
    startView = { ...view };
    startPts = [...pointers.values()].map((p) => ({ ...p }));
  }

  function onDown(e: PointerEvent) {
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    snapshot();
  }

  function onMove(e: PointerEvent) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.values()];
    const r = stage.getBoundingClientRect();
    if (pts.length === 1 && startPts.length === 1) {
      view = clampView(frame, { s: startView.s, tx: startView.tx + pts[0]!.x - startPts[0]!.x, ty: startView.ty + pts[0]!.y - startPts[0]!.y }, imgW, imgH, maxScale());
    } else if (pts.length >= 2 && startPts.length >= 2) {
      const d0 = Math.hypot(startPts[0]!.x - startPts[1]!.x, startPts[0]!.y - startPts[1]!.y) || 1;
      const d1 = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y) || 1;
      const m0 = { x: (startPts[0]!.x + startPts[1]!.x) / 2 - r.left, y: (startPts[0]!.y + startPts[1]!.y) / 2 - r.top };
      const m1 = { x: (pts[0]!.x + pts[1]!.x) / 2 - r.left, y: (pts[0]!.y + pts[1]!.y) / 2 - r.top };
      const k = d1 / d0;
      const s = startView.s * k;
      view = clampView(frame, { s, tx: m1.x - (m0.x - startView.tx) * k, ty: m1.y - (m0.y - startView.ty) * k }, imgW, imgH, maxScale());
    }
  }

  function onUp(e: PointerEvent) {
    pointers.delete(e.pointerId);
    snapshot();
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    const k = Math.exp(-e.deltaY * 0.002);
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    view = clampView(frame, { s: view.s * k, tx: mx - (mx - view.tx) * k, ty: my - (my - view.ty) * k }, imgW, imgH, maxScale());
  }

  function save() {
    onsave(cropFromView(frame, view, imgW, imgH));
  }
</script>

<div class="editor overlay" role="dialog" aria-modal="true" aria-label={title}>
  <header>
    <button class="btn quiet" type="button" onclick={onclose}>Cancel</button>
    <span class="title">{title}</span>
    <button class="btn quiet strong" type="button" onclick={save}>Save</button>
  </header>
  <div
    class="stage"
    bind:this={stage}
    onpointerdown={onDown}
    onpointermove={onMove}
    onpointerup={onUp}
    onpointercancel={onUp}
    onwheel={onWheel}
    role="presentation"
  >
    {#if url}
      <img
        src={url}
        alt=""
        draggable="false"
        style:width="{imgW * view.s}px"
        style:height="{imgH * view.s}px"
        style:transform="translate({view.tx}px, {view.ty}px)"
      />
    {/if}
    <div class="mask" style:left="{frame.x}px" style:top="{frame.y}px" style:width="{frame.w}px" style:height="{frame.h}px"></div>
  </div>
  <footer>
    <div class="aspects" role="radiogroup" aria-label="Aspect ratio">
      {#each ASPECTS as a (a.id)}
        <button type="button" role="radio" aria-checked={aspectId === a.id} class:on={aspectId === a.id} onclick={() => setAspect(a.id, a.value)}>{a.label}</button>
      {/each}
    </div>
    <div class="actions">
      <button class="btn" type="button" onclick={() => reset(hold.crop.auto ?? FULL_FRAME)} disabled={!hold.crop.auto}>Automatic</button>
      <button class="btn" type="button" onclick={() => { aspect = imgW / imgH; aspectId = 'current'; queueMicrotask(() => reset(FULL_FRAME)); }}>Full frame</button>
      {#if hold.crop.manual}
        <button class="btn quiet" type="button" onclick={() => onsave(null)}>Remove override</button>
      {/if}
    </div>
  </footer>
</div>

<style>
  /* Above the hold viewer it can be opened from. */
  .editor {
    z-index: 60;
  }

  .strong {
    font-weight: var(--weight-semibold);
  }

  .title {
    font-weight: var(--weight-medium);
  }

  .stage {
    position: relative;
    flex: 1;
    overflow: hidden;
    touch-action: none;
  }

  img {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: 0 0;
    user-select: none;
    -webkit-user-select: none;
    pointer-events: none;
  }

  .mask {
    position: absolute;
    border: 1px solid rgba(255, 255, 255, 0.9);
    box-shadow: 0 0 0 9999px rgba(20, 19, 17, 0.55);
    pointer-events: none;
  }

  .aspects {
    display: flex;
    justify-content: center;
    gap: var(--space-2);
  }

  .aspects button {
    min-width: var(--touch);
    min-height: 36px;
    border: 1px solid rgba(255, 255, 255, 0.3);
    border-radius: var(--radius-pill);
    background: transparent;
    color: inherit;
    font-size: var(--text-s);
  }

  .aspects button.on {
    background: rgba(255, 255, 255, 0.92);
    color: var(--color-text);
  }

  .actions {
    display: flex;
    justify-content: center;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .actions .btn {
    background: transparent;
    color: inherit;
    border-color: rgba(255, 255, 255, 0.3);
  }
</style>
