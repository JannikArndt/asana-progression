<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { fade } from 'svelte/transition';
  import AssetImage from './AssetImage.svelte';
  import PoseOverlay from './PoseOverlay.svelte';
  import { displayCrop, itemAspect, swipeIndex, type ProgressionItem } from '../../progression';
  import type { PostureClass } from '../../model';
  import { formatDay } from '../format';
  import { app } from '../state/app.svelte';
  import { capture, type PoseResult } from '../state/capture.svelte';
  import { attachPicked } from '../state/hold-actions';
  import { photosSearchDate, recordedClock } from '../state/file-match';
  import { copyText } from '../diagnostics';
  import { dismissOffset, dismissProgress, gestureAxis, isTap, shouldDismiss, type Axis } from './viewer-gestures';

  interface Props {
    /** All holds of the asana, oldest first. */
    items: ProgressionItem[];
    index: number;
    /** The hold the others are compared with (split slider / crossfade), or null. */
    compareId: string | null;
    title: string;
    /** Something is open on top (crop editor, frame picker): it owns the keyboard. */
    covered?: boolean;
    oncompare: (holdId: string | null) => void;
    onedit: (item: ProgressionItem) => void;
    /** Choose another best frame from the analysis frames (omitted: no such action). */
    onframe?: ((item: ProgressionItem) => void) | undefined;
    onsession: (sessionId: string) => void;
    onclose: () => void;
  }
  let { items, index = $bindable(), compareId, title, covered = false, oncompare, onedit, onframe, onsession, onclose }: Props = $props();

  type CompareMode = 'split' | 'fade';
  const POSTURE: Record<PostureClass, string> = { standing: 'standing', seated: 'seated', lying: 'lying', inverted: 'inverted', 'arm-balance': 'arm balance' };
  const BAR_MS = 4000;

  let stage: HTMLDivElement;
  let stageW = $state(0);
  let stageH = $state(0);
  let dx = $state(0);
  let dy = $state(0);
  let dragging = $state(false);
  let playing = $state(false);
  let compare = $state<CompareMode>('split');
  let mix = $state(50);
  /** Translucent action bar over the image, shown by a tap on it. */
  let bar = $state(false);
  let barTimer: ReturnType<typeof setTimeout> | undefined;
  let showPose = $state(false);
  let poses = $state.raw<Record<string, PoseResult | 'loading'>>({});

  const current = $derived(items[index]);
  const reference = $derived(compareId ? items.find((i) => i.hold.id === compareId) : undefined);
  const comparing = $derived(!!reference && !!current && reference.hold.id !== current.hold.id && !!(reference.still ?? reference.thumb));
  const isReference = $derived(!!current && compareId === current.hold.id);
  const canChooseFrame = $derived(!!current && !!app.summaries[current.hold.videoId]);
  const status = $derived(current ? capture.status[current.hold.id] : undefined);
  const video = $derived(current && status === 'needs-file' ? app.videos.find((v) => v.id === current.hold.videoId) : undefined);
  const pose = $derived(showPose && current?.still ? poses[current.still.storageKey] : undefined);
  const poseLabel = $derived.by(() => {
    if (!showPose || !current) return null;
    if (!current.still) return 'No still to find a pose in';
    if (!pose || pose === 'loading') return 'Finding the pose…';
    if (pose.cropper === 'none') return 'Pose model off';
    if (pose.error) return 'Pose detection failed';
    if (!pose.detection) return 'No pose found';
    return `Pose · ${pose.detection.posture ? POSTURE[pose.detection.posture] : 'posture unclear'}`;
  });
  /** 0 → 1 while the image is pulled down to close. */
  const closing = $derived(dismissProgress(dy, stageH));

  /** Largest box of the item's crop aspect inside the stage. */
  function box(item: ProgressionItem | undefined): { w: number; h: number } {
    const a = (item && itemAspect(item)) ?? 16 / 9;
    const w = Math.max(1, Math.min(stageW, stageH * a));
    return { w, h: w / a };
  }

  function showBar(visible = true) {
    bar = visible;
    clearTimeout(barTimer);
    if (visible) barTimer = setTimeout(() => (bar = false), BAR_MS);
  }

  /** Bar actions that open something else hide the bar first. */
  function open(action: () => void) {
    showBar(false);
    action();
  }

  $effect(() => {
    void index;
    playing = false;
  });

  // Pose landmarks of the shown still, once per still (cached in the capture queue as well).
  $effect(() => {
    const still = showPose ? current?.still : undefined;
    if (!still) return;
    const key = still.storageKey;
    if (untrack(() => poses[key])) return;
    poses = { ...untrack(() => poses), [key]: 'loading' };
    void capture.pose(still).then((r) => (poses = { ...poses, [key]: r }));
  });

  let attachMessage = $state<string | null>(null);
  let attaching = $state(false);
  let copied = $state(false);
  const searchDate = $derived(video ? photosSearchDate(video.recordedAt ?? video.importedAt) : '');

  async function reattach(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    if (!files.length || !video) return;
    attaching = true;
    try {
      const r = await attachPicked(files, [video]);
      attachMessage = r.attached.some((v) => v.id === video?.id) ? null : r.message;
    } finally {
      attaching = false;
    }
  }

  onMount(() => {
    const ro = new ResizeObserver(() => {
      stageW = stage.clientWidth;
      stageH = stage.clientHeight;
    });
    ro.observe(stage);
    const onKey = (e: KeyboardEvent) => {
      if (covered) return;
      if (e.key === 'Escape') onclose();
      else if (e.key === 'ArrowLeft') index = Math.max(0, index - 1);
      else if (e.key === 'ArrowRight') index = Math.min(items.length - 1, index + 1);
    };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      ro.disconnect();
      clearTimeout(barTimer);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  });

  // ----- gestures: swipe sideways between holds, pull down to close, tap -----
  let start: { id: number; x: number; y: number; t: number; onImage: boolean } | null = null;
  let axis: Axis | null = null;
  let last = { x: 0, y: 0, t: 0, vx: 0, vy: 0 };

  function onDown(e: PointerEvent) {
    if (start) return;
    const onImage = !!(e.target as Element | null)?.closest?.('.slide.current .media');
    start = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), onImage };
    axis = null;
    last = { x: e.clientX, y: e.clientY, t: start.t, vx: 0, vy: 0 };
    stage.setPointerCapture(e.pointerId);
  }

  function onMove(e: PointerEvent) {
    if (!start || e.pointerId !== start.id) return;
    const now = performance.now();
    if (now > last.t) last = { x: e.clientX, y: e.clientY, t: now, vx: (e.clientX - last.x) / (now - last.t), vy: (e.clientY - last.y) / (now - last.t) };
    const mx = e.clientX - start.x;
    const my = e.clientY - start.y;
    if (!axis) {
      axis = gestureAxis(mx, my);
      if (!axis) return;
      dragging = true;
      showBar(false);
    }
    if (axis === 'x') {
      // Resist at the ends.
      const atEnd = (mx > 0 && index === 0) || (mx < 0 && index === items.length - 1);
      dx = atEnd ? mx / 3 : mx;
    } else {
      dy = dismissOffset(my);
    }
  }

  function onUp(e: PointerEvent, cancelled = false) {
    if (!start || e.pointerId !== start.id) return;
    const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
    const s = start;
    start = null;
    if (axis === 'x') index = swipeIndex(index, items.length, dx, stageW, last.vx);
    else if (axis === 'y' && !cancelled && shouldDismiss(e.clientY - s.y, last.vy, stageH)) {
      onclose();
      return;
    } else if (!axis && !cancelled && isTap(moved, performance.now() - s.t)) {
      // On the image: show or hide the actions; around it: close.
      if (s.onImage) showBar(!bar);
      else onclose();
    }
    axis = null;
    dragging = false;
    dx = 0;
    dy = 0;
  }
</script>

<div class="viewer overlay" role="dialog" aria-modal="true" aria-label="{title} holds">
  <div class="backdrop" style:opacity={1 - 0.8 * closing}></div>
  <header style:opacity={1 - closing}>
    <button class="btn quiet" type="button" onclick={onclose} aria-label="Close">✕</button>
    <span class="count tabular">{index + 1} / {items.length}</span>
    <button class="btn quiet" type="button" aria-label="Actions" aria-expanded={bar} onclick={() => showBar(!bar)}>•••</button>
  </header>

  <div class="stage-wrap">
    <div
      class="stage"
      bind:this={stage}
      onpointerdown={onDown}
      onpointermove={onMove}
      onpointerup={(e) => onUp(e)}
      onpointercancel={(e) => onUp(e, true)}
      role="presentation"
    >
      <div class="track" class:dragging style:transform="translate3d({-index * stageW + dx}px, {dy}px, 0) scale({1 - 0.15 * closing})">
        {#each items as item, i (item.hold.id)}
          <div class="slide" class:current={i === index} style:left="{i * stageW}px" style:width="{stageW}px">
            {#if Math.abs(i - index) <= 1 && stageW > 0}
              {@const b = box(item)}
              {@const crop = displayCrop(item.hold)}
              <div class="media" style:width="{b.w}px" style:height="{b.h}px">
                <AssetImage asset={item.still ?? item.thumb} {crop} aspect={b.w / b.h} alt="{title} {formatDay(item.date)}" instant>
                  {#snippet fallback()}
                    <p class="empty">No still captured yet.<br />Open the session with its video to capture it.</p>
                  {/snippet}
                </AssetImage>
                {#if i === index && playing && item.clip}
                  <div class="layer">
                    <AssetImage asset={item.clip} {crop} aspect={b.w / b.h} alt="{title} clip" instant />
                  </div>
                {/if}
                {#if i === index && comparing && reference}
                  <div class="layer reference" style:clip-path={compare === 'split' ? `inset(0 ${100 - mix}% 0 0)` : null} style:opacity={compare === 'fade' ? 1 - mix / 100 : null}>
                    <AssetImage asset={reference.still ?? reference.thumb} crop={displayCrop(reference.hold)} aspect={b.w / b.h} alt="Compared with {formatDay(reference.date)}" instant />
                  </div>
                  {#if compare === 'split'}
                    <div class="divider" style:left="{mix}%"></div>
                  {/if}
                  <span class="tag left tabular">{formatDay(reference.date)}</span>
                  <span class="tag right tabular">{formatDay(item.date)}</span>
                {/if}
                {#if i === index && pose && pose !== 'loading' && pose.detection}
                  <PoseOverlay detection={pose.detection} {crop} width={b.w} height={b.h} />
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>
      {#if current && playing && !current.clip}
        <p class="hint">No clip captured for this hold.</p>
      {/if}
    </div>

    {#if poseLabel}
      <p class="chip pose-label" role="status">{poseLabel}</p>
    {/if}

    {#if bar && current}
      <div class="bar" role="toolbar" aria-label="Hold actions" transition:fade={{ duration: 150 }}>
        <button type="button" onclick={() => open(() => onedit(current))} disabled={!current.still}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14" /></svg>
          <span>Edit crop</span>
        </button>
        {#if onframe}
          <button type="button" onclick={() => open(() => onframe(current))} disabled={!canChooseFrame}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M8 5v14M16 5v14" /></svg>
            <span>Choose frame</span>
          </button>
        {/if}
        {#if current.clip}
          <button type="button" aria-pressed={playing} onclick={() => { playing = !playing; showBar(); }}>
            {#if playing}
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1.5" /></svg>
            {:else}
              <svg viewBox="0 0 24 24" aria-hidden="true"><path class="solid" d="M7 4.5l12 7.5-12 7.5z" /></svg>
            {/if}
            <span>{playing ? 'Stop clip' : 'Play clip'}</span>
          </button>
        {/if}
        <button type="button" aria-pressed={showPose} class:on={showPose} onclick={() => { showPose = !showPose; showBar(); }} disabled={!current.still}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="4.5" r="2" /><path d="M12 7.5v7M5.5 10.5h13M12 14.5l-4 7M12 14.5l4 7" /></svg>
          <span>Pose</span>
        </button>
        <button type="button" aria-pressed={isReference} class:on={isReference} onclick={() => { oncompare(isReference ? null : current.hold.id); showBar(); }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M12 2v20" /></svg>
          <span>Compare</span>
        </button>
      </div>
    {/if}
  </div>

  <footer style:opacity={1 - closing}>
    {#if current}
      <div class="caption">
        <span class="date tabular">{formatDay(current.date, true)}{current.hold.side ? ` · ${current.hold.side === 'R' ? 'Right' : 'Left'}` : ''}{current.reps > 1 ? ` · rep ${current.rep} of ${current.reps}` : ''}</span>
        {#if current.note}<span class="note">{current.note}</span>{/if}
      </div>
      {#if comparing && reference}
        <div class="compare">
          <div class="compare-head">
            <span>Comparing with <strong class="tabular">{formatDay(reference.date, true)}</strong></span>
            <button class="btn quiet small" type="button" onclick={() => oncompare(null)}>Stop</button>
          </div>
          <div class="modes" role="radiogroup" aria-label="Compare mode">
            <button type="button" role="radio" aria-checked={compare === 'split'} class:on={compare === 'split'} onclick={() => (compare = 'split')}>Split</button>
            <button type="button" role="radio" aria-checked={compare === 'fade'} class:on={compare === 'fade'} onclick={() => (compare = 'fade')}>Crossfade</button>
          </div>
          <input type="range" min="0" max="100" step="1" bind:value={mix} aria-label="{formatDay(reference.date)} versus {formatDay(current.date)}" />
        </div>
      {:else if isReference}
        <div class="compare-head">
          <span class="explain">{items.length > 1 ? 'Swipe to another day to compare it with this one.' : 'Compare needs a second hold of this asana.'}</span>
          <button class="btn quiet small" type="button" onclick={() => oncompare(null)}>Stop</button>
        </div>
      {/if}
      {#if video}
        <div class="reattach">
          <span>Select {video.fileName} to save the still of this hold (recorded {[formatDay(video.recordedAt ?? video.importedAt), recordedClock(video.recordedAt)].filter(Boolean).join(', ')}).</span>
          {#if searchDate}
            <button class="btn small" type="button" onclick={async () => (copied = await copyText(searchDate))} aria-label="Copy {searchDate} for the Photos search">
              {copied ? 'Copied' : `Copy “${searchDate}”`}
            </button>
          {/if}
          <label class="btn small" aria-disabled={attaching}>
            {attaching ? 'Checking…' : 'Select video'}
            <input class="visually-hidden" type="file" accept="video/*" multiple disabled={attaching} onchange={reattach} />
          </label>
          {#if attachMessage}<span class="error" role="alert">{attachMessage}</span>{/if}
        </div>
      {:else if status === 'queued' || status === 'capturing'}
        <p class="saving">Saving the still…</p>
      {/if}
      <button class="btn quiet session" type="button" onclick={() => onsession(current.hold.sessionId)}>Open session ›</button>
    {/if}
  </footer>
</div>

<style>
  /* The backdrop fades while the image is pulled down. */
  .viewer {
    background: transparent;
  }

  .backdrop {
    position: absolute;
    inset: 0;
    z-index: -1;
    background: var(--color-overlay-solid);
  }

  .count {
    font-size: var(--text-s);
    opacity: 0.8;
  }

  .stage-wrap {
    position: relative;
    flex: 1;
    display: flex;
    min-height: 0;
  }

  .stage {
    position: relative;
    flex: 1;
    overflow: hidden;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
  }

  .track {
    position: absolute;
    inset: 0;
    transition: transform var(--duration) var(--ease);
  }

  .track.dragging {
    transition: none;
  }

  .slide {
    position: absolute;
    top: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .media {
    position: relative;
  }

  .media :global(.frame) {
    height: 100%;
    background: transparent;
  }

  .layer {
    position: absolute;
    inset: 0;
  }

  .divider {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: rgba(255, 255, 255, 0.9);
    pointer-events: none;
  }

  .tag {
    position: absolute;
    top: var(--space-2);
    padding: 2px var(--space-2);
    border-radius: var(--radius-pill);
    background: var(--color-glass);
    font-size: var(--text-xs);
    pointer-events: none;
  }

  .tag.left {
    left: var(--space-2);
  }

  .tag.right {
    right: var(--space-2);
  }

  .empty,
  .hint {
    text-align: center;
    font-size: var(--text-s);
    opacity: 0.75;
    padding: var(--space-5);
  }

  .hint {
    position: absolute;
    left: 0;
    right: 0;
    bottom: var(--space-2);
    padding: 0;
  }

  .chip {
    position: absolute;
    top: var(--space-2);
    left: 50%;
    transform: translateX(-50%);
    margin: 0;
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-pill);
    background: var(--color-glass);
    -webkit-backdrop-filter: blur(12px);
    backdrop-filter: blur(12px);
    font-size: var(--text-xs);
    white-space: nowrap;
    pointer-events: none;
  }

  /* iOS Photos-like: translucent, over the bottom of the image. */
  .bar {
    position: absolute;
    left: 50%;
    bottom: var(--space-3);
    transform: translateX(-50%);
    display: flex;
    gap: 2px;
    max-width: calc(100% - 2 * var(--space-3));
    padding: var(--space-1);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: var(--radius-l);
    background: var(--color-glass);
    -webkit-backdrop-filter: blur(16px);
    backdrop-filter: blur(16px);
  }

  .bar button {
    flex: 1 1 0;
    min-width: var(--touch);
    min-height: 52px;
    padding: var(--space-1) var(--space-2);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    border: 0;
    border-radius: var(--radius-m);
    background: transparent;
    color: inherit;
    font-size: var(--text-xs);
    white-space: nowrap;
  }

  .bar button:active,
  .bar button.on {
    background: rgba(255, 255, 255, 0.16);
  }

  .bar button:disabled {
    opacity: 0.4;
  }

  .bar svg {
    width: 22px;
    height: 22px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .bar svg .solid {
    fill: currentColor;
  }

  .caption {
    display: flex;
    flex-direction: column;
    gap: 2px;
    text-align: center;
  }

  .date {
    font-weight: var(--weight-medium);
  }

  .note {
    font-size: var(--text-s);
    opacity: 0.8;
  }

  .compare {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .compare-head {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    font-size: var(--text-s);
  }

  .compare-head strong {
    font-weight: var(--weight-semibold);
  }

  .explain {
    opacity: 0.85;
  }

  .small {
    min-height: 36px;
    padding: 0 var(--space-3);
  }

  .compare-head .btn,
  .reattach .btn {
    color: inherit;
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.3);
  }

  .modes {
    display: flex;
    justify-content: center;
    gap: var(--space-2);
  }

  .modes button {
    min-height: 36px;
    padding: 0 var(--space-3);
    border: 1px solid rgba(255, 255, 255, 0.3);
    border-radius: var(--radius-pill);
    background: transparent;
    color: inherit;
    font-size: var(--text-s);
  }

  .modes button.on {
    background: rgba(255, 255, 255, 0.92);
    color: var(--color-text);
  }

  input[type='range'] {
    width: 100%;
    min-height: var(--touch);
    accent-color: var(--color-accent);
  }

  .reattach {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    font-size: var(--text-s);
    text-align: center;
  }

  .error {
    font-weight: var(--weight-medium);
  }

  .saving {
    margin: 0;
    text-align: center;
    font-size: var(--text-s);
    opacity: 0.75;
  }

  .session {
    align-self: center;
    color: inherit;
    opacity: 0.85;
  }
</style>
