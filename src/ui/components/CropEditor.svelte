<script lang="ts">
  import { onMount } from 'svelte';
  import type { Asset, Box, Hold } from '../../model';
  import { assetUrl } from '../state/capture.svelte';
  import { clampView, cropFromView, effectiveCrop, FULL_FRAME, viewForCrop } from '../state/capture-plan';
  import { cropAspect, cropWithAspect, fitFrame, HANDLES, imageRect, inset, intersect, resizeFrame, type Handle } from '../state/crop-frame';

  interface Props {
    hold: Hold;
    still: Asset;
    title?: string;
    onsave: (manual: Box | null) => void;
    onclose: () => void;
  }
  let { hold, still, title = 'Crop', onsave, onclose }: Props = $props();

  /** Portrait first: most standing poses are taller than wide. */
  const ASPECTS: Array<{ id: string; label: string; value: number | null }> = [
    { id: 'free', label: 'Free', value: null },
    { id: '2:3', label: '2:3', value: 2 / 3 },
    { id: '3:4', label: '3:4', value: 3 / 4 },
    { id: '4:5', label: '4:5', value: 4 / 5 },
    { id: '1:1', label: '1:1', value: 1 },
    { id: '3:2', label: '3:2', value: 3 / 2 },
    { id: '16:9', label: '16:9', value: 16 / 9 },
  ];
  /** Space around the frame (the handles reach 22 px beyond it). */
  const MARGIN = 24;
  const MIN_FRAME = 72;

  let stage: HTMLDivElement;
  let url = $state<string | null>(null);
  let stageW = $state(0);
  let stageH = $state(0);
  let aspectId = $state('free');
  /** Aspect of the chosen preset; null = free (the handles change the frame's shape). */
  let lock = $state<number | null>(null);
  let frame = $state<Box>({ x: 0, y: 0, w: 1, h: 1 });
  let view = $state({ s: 1, tx: 0, ty: 0 });
  /** Animates frame and image after a handle was released or the aspect changed. */
  let settling = $state(false);
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  const imgW = $derived(still.width);
  const imgH = $derived(still.height);

  function area(): Box {
    return inset({ x: 0, y: 0, w: stageW, h: stageH }, MARGIN);
  }

  function maxScale(): number {
    return (8 * frame.w) / imgW;
  }

  function currentCrop(): Box {
    return cropFromView(frame, view, imgW, imgH);
  }

  /** Shows `crop` in the largest frame of `aspect` (px) inside the stage. */
  function place(crop: Box, aspect: number, animate = false) {
    if (animate) {
      settling = true;
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => (settling = false), 300);
    }
    frame = fitFrame(area(), aspect);
    view = clampView(frame, viewForCrop(frame, crop, imgW, imgH), imgW, imgH, maxScale());
  }

  function setAspect(id: string, value: number | null) {
    aspectId = id;
    lock = value;
    if (value !== null) place(cropWithAspect(currentCrop(), value, imgW, imgH), value, true);
  }

  function resetTo(crop: Box) {
    aspectId = 'free';
    lock = null;
    place(crop, cropAspect(crop, imgW, imgH), true);
  }

  onMount(() => {
    void assetUrl(still).then((u) => (url = u));
    const start = effectiveCrop(hold) ?? FULL_FRAME;
    const ro = new ResizeObserver(() => {
      const keep = stageW > 0 ? currentCrop() : start;
      stageW = stage.clientWidth;
      stageH = stage.clientHeight;
      place(keep, lock ?? cropAspect(keep, imgW, imgH));
    });
    ro.observe(stage);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onclose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      ro.disconnect();
      window.removeEventListener('keydown', onKey);
      clearTimeout(settleTimer);
    };
  });

  // ----- frame handles: drag an edge or a corner to change the frame (the image stays) -----
  let grab = $state<{ id: number; handle: Handle; x: number; y: number; frame: Box } | null>(null);

  function onHandleDown(e: PointerEvent, handle: Handle) {
    e.stopPropagation();
    if (grab || pointers.size) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    grab = { id: e.pointerId, handle, x: e.clientX, y: e.clientY, frame: { ...frame } };
    settling = false;
  }

  function onHandleMove(e: PointerEvent) {
    if (!grab || e.pointerId !== grab.id) return;
    const bounds = intersect(area(), imageRect(view, imgW, imgH));
    frame = resizeFrame(grab.frame, grab.handle, e.clientX - grab.x, e.clientY - grab.y, { bounds, minSize: MIN_FRAME, aspect: lock });
  }

  function onHandleUp(e: PointerEvent) {
    if (!grab || e.pointerId !== grab.id) return;
    grab = null;
    // Like Photos: the new frame grows back to fill the stage and the image zooms with it.
    place(currentCrop(), frame.w / frame.h, true);
  }

  /** Hit area of a handle: 44 px across, centred on the frame's edge or corner. */
  function handleRect(h: Handle): Box {
    const t = 44;
    const r = t / 2;
    const x = h.includes('w') ? frame.x - r : h.includes('e') ? frame.x + frame.w - r : frame.x + r;
    const y = h.includes('n') ? frame.y - r : h.includes('s') ? frame.y + frame.h - r : frame.y + r;
    return { x, y, w: h === 'n' || h === 's' ? Math.max(0, frame.w - t) : t, h: h === 'e' || h === 'w' ? Math.max(0, frame.h - t) : t };
  }

  // ----- image gestures: one finger pans, two fingers pinch -----
  const pointers = new Map<number, { x: number; y: number }>();
  let startView = { s: 1, tx: 0, ty: 0 };
  let startPts: Array<{ x: number; y: number }> = [];

  function snapshot() {
    startView = { ...view };
    startPts = [...pointers.values()].map((p) => ({ ...p }));
  }

  function onDown(e: PointerEvent) {
    if (grab) return;
    settling = false;
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
    settling = false;
    const r = stage.getBoundingClientRect();
    const k = Math.exp(-e.deltaY * 0.002);
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    view = clampView(frame, { s: view.s * k, tx: mx - (mx - view.tx) * k, ty: my - (my - view.ty) * k }, imgW, imgH, maxScale());
  }

  function save() {
    onsave(currentCrop());
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
    class:settling
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
    <div class="mask" class:active={!!grab} style:left="{frame.x}px" style:top="{frame.y}px" style:width="{frame.w}px" style:height="{frame.h}px"></div>
    {#each HANDLES as h (h)}
      {@const r = handleRect(h)}
      <div
        class="handle {h}"
        data-handle={h}
        style:left="{r.x}px"
        style:top="{r.y}px"
        style:width="{r.w}px"
        style:height="{r.h}px"
        onpointerdown={(e) => onHandleDown(e, h)}
        onpointermove={onHandleMove}
        onpointerup={onHandleUp}
        onpointercancel={onHandleUp}
        role="presentation"
      ></div>
    {/each}
  </div>
  <footer>
    <p class="hint">{lock === null ? 'Drag a corner or an edge to change the frame; pinch or drag the photo to move it.' : 'Drag a corner to resize; pinch or drag the photo to move it.'}</p>
    <div class="aspects" role="radiogroup" aria-label="Aspect ratio">
      {#each ASPECTS as a (a.id)}
        <button type="button" role="radio" aria-checked={aspectId === a.id} class:on={aspectId === a.id} onclick={() => setAspect(a.id, a.value)}>{a.label}</button>
      {/each}
    </div>
    <div class="actions">
      <button class="btn" type="button" onclick={() => resetTo(hold.crop.auto ?? FULL_FRAME)} disabled={!hold.crop.auto}>Automatic</button>
      <button class="btn" type="button" onclick={() => resetTo(FULL_FRAME)}>Full frame</button>
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
    background: var(--color-overlay-solid);
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

  /* Rule of thirds while the frame is dragged. */
  .mask.active {
    --line: rgba(255, 255, 255, 0.45);
    background:
      linear-gradient(var(--line), var(--line)) 33.33% 0 / 1px 100% no-repeat,
      linear-gradient(var(--line), var(--line)) 66.67% 0 / 1px 100% no-repeat,
      linear-gradient(var(--line), var(--line)) 0 33.33% / 100% 1px no-repeat,
      linear-gradient(var(--line), var(--line)) 0 66.67% / 100% 1px no-repeat;
  }

  .settling img {
    transition:
      width var(--duration) var(--ease),
      height var(--duration) var(--ease),
      transform var(--duration) var(--ease);
  }

  .settling .mask,
  .settling .handle {
    transition:
      left var(--duration) var(--ease),
      top var(--duration) var(--ease),
      width var(--duration) var(--ease),
      height var(--duration) var(--ease);
  }

  /* 44 px hit areas; the visible marks sit on the frame line inside them. */
  .handle {
    position: absolute;
    touch-action: none;
  }

  .handle::before {
    content: '';
    position: absolute;
    border: 0 solid var(--color-on-accent);
  }

  .handle.nw::before,
  .handle.ne::before,
  .handle.sw::before,
  .handle.se::before {
    width: 20px;
    height: 20px;
  }

  .handle.nw::before {
    left: 19px;
    top: 19px;
    border-width: 3px 0 0 3px;
  }

  .handle.ne::before {
    right: 19px;
    top: 19px;
    border-width: 3px 3px 0 0;
  }

  .handle.sw::before {
    left: 19px;
    bottom: 19px;
    border-width: 0 0 3px 3px;
  }

  .handle.se::before {
    right: 19px;
    bottom: 19px;
    border-width: 0 3px 3px 0;
  }

  .handle.n::before,
  .handle.s::before {
    left: calc(50% - 14px);
    width: 28px;
    border-top-width: 3px;
  }

  .handle.n::before {
    top: 19px;
  }

  .handle.s::before {
    bottom: 19px;
  }

  .handle.e::before,
  .handle.w::before {
    top: calc(50% - 14px);
    height: 28px;
    border-left-width: 3px;
  }

  .handle.w::before {
    left: 19px;
  }

  .handle.e::before {
    right: 19px;
  }

  .hint {
    margin: 0;
    text-align: center;
    font-size: var(--text-xs);
    opacity: 0.7;
  }

  /* One row; scrolls sideways when it does not fit. */
  .aspects {
    display: flex;
    gap: var(--space-2);
    margin: 0 calc(-1 * var(--space-4));
    padding: 0 var(--space-4);
    overflow-x: auto;
    scrollbar-width: none;
  }

  .aspects::-webkit-scrollbar {
    display: none;
  }

  .aspects button {
    flex: 1 0 auto;
    min-width: var(--touch);
    min-height: 36px;
    padding: 0 var(--space-2);
    border: 1px solid rgba(255, 255, 255, 0.3);
    border-radius: var(--radius-pill);
    background: transparent;
    color: inherit;
    font-size: var(--text-s);
    white-space: nowrap;
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
