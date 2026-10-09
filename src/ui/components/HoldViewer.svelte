<script lang="ts">
  import { onMount } from 'svelte';
  import AssetImage from './AssetImage.svelte';
  import { displayCrop, itemAspect, swipeIndex, type ProgressionItem } from '../../progression';
  import { formatDay } from '../format';

  interface Props {
    /** All holds of the asana, oldest first. */
    items: ProgressionItem[];
    index: number;
    pinnedId: string | null;
    title: string;
    onpin: (holdId: string | null) => void;
    onedit: (item: ProgressionItem) => void;
    onsession: (sessionId: string) => void;
    onclose: () => void;
  }
  let { items, index = $bindable(), pinnedId, title, onpin, onedit, onsession, onclose }: Props = $props();

  type CompareMode = 'split' | 'fade';
  let stage: HTMLDivElement;
  let stageW = $state(0);
  let stageH = $state(0);
  let dx = $state(0);
  let dragging = $state(false);
  let playing = $state(false);
  let compare = $state<CompareMode>('split');
  let mix = $state(50);

  const current = $derived(items[index]);
  const pinned = $derived(pinnedId ? items.find((i) => i.hold.id === pinnedId) : undefined);
  const comparing = $derived(!!pinned && !!current && pinned.hold.id !== current.hold.id && !!(pinned.still ?? pinned.thumb));

  /** Largest box of the item's crop aspect inside the stage. */
  function box(item: ProgressionItem | undefined): { w: number; h: number } {
    const a = (item && itemAspect(item)) ?? 16 / 9;
    const w = Math.max(1, Math.min(stageW, stageH * a));
    return { w, h: w / a };
  }

  $effect(() => {
    void index;
    playing = false;
  });

  onMount(() => {
    const ro = new ResizeObserver(() => {
      stageW = stage.clientWidth;
      stageH = stage.clientHeight;
    });
    ro.observe(stage);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onclose();
      else if (e.key === 'ArrowLeft') index = Math.max(0, index - 1);
      else if (e.key === 'ArrowRight') index = Math.min(items.length - 1, index + 1);
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

  // ----- swipe and tap -----
  let start: { id: number; x: number; y: number; t: number } | null = null;
  let last = { x: 0, t: 0, v: 0 };

  function onDown(e: PointerEvent) {
    if (start) return;
    start = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
    last = { x: e.clientX, t: start.t, v: 0 };
    stage.setPointerCapture(e.pointerId);
  }

  function onMove(e: PointerEvent) {
    if (!start || e.pointerId !== start.id) return;
    const now = performance.now();
    if (now > last.t) last = { x: e.clientX, t: now, v: (e.clientX - last.x) / (now - last.t) };
    const d = e.clientX - start.x;
    if (!dragging && Math.abs(d) > 8) dragging = true;
    if (dragging) {
      // Resist at the ends.
      const atEnd = (d > 0 && index === 0) || (d < 0 && index === items.length - 1);
      dx = atEnd ? d / 3 : d;
    }
  }

  function onUp(e: PointerEvent, cancelled = false) {
    if (!start || e.pointerId !== start.id) return;
    const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
    const quick = performance.now() - start.t < 350;
    if (dragging) index = swipeIndex(index, items.length, dx, stageW, last.v);
    else if (!cancelled && moved < 10 && quick) playing = !playing;
    dragging = false;
    dx = 0;
    start = null;
  }
</script>

<div class="viewer" role="dialog" aria-modal="true" aria-label="{title} holds">
  <header>
    <button class="btn quiet" type="button" onclick={onclose} aria-label="Close">✕</button>
    <span class="count tabular">{index + 1} / {items.length}</span>
    {#if current}
      <button class="btn quiet" type="button" class:on={pinnedId === current.hold.id} aria-pressed={pinnedId === current.hold.id} onclick={() => onpin(pinnedId === current.hold.id ? null : current.hold.id)}>
        {pinnedId === current.hold.id ? 'Pinned' : 'Pin'}
      </button>
    {/if}
  </header>

  <div
    class="stage"
    bind:this={stage}
    onpointerdown={onDown}
    onpointermove={onMove}
    onpointerup={(e) => onUp(e)}
    onpointercancel={(e) => onUp(e, true)}
    role="presentation"
  >
    <div class="track" class:dragging style:transform="translate3d({-index * stageW + dx}px, 0, 0)">
      {#each items as item, i (item.hold.id)}
        <div class="slide" style:left="{i * stageW}px" style:width="{stageW}px">
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
              {#if i === index && comparing && pinned}
                <div class="layer pinned" style:clip-path={compare === 'split' ? `inset(0 ${100 - mix}% 0 0)` : null} style:opacity={compare === 'fade' ? 1 - mix / 100 : null}>
                  <AssetImage asset={pinned.still ?? pinned.thumb} crop={displayCrop(pinned.hold)} aspect={b.w / b.h} alt="Pinned {formatDay(pinned.date)}" instant />
                </div>
                {#if compare === 'split'}
                  <div class="divider" style:left="{mix}%"></div>
                {/if}
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

  <footer>
    {#if current}
      <div class="caption">
        <span class="date tabular">{formatDay(current.date, true)}{current.hold.side ? ` · ${current.hold.side === 'R' ? 'Right' : 'Left'}` : ''}{current.reps > 1 ? ` · rep ${current.rep} of ${current.reps}` : ''}</span>
        {#if current.note}<span class="note">{current.note}</span>{/if}
      </div>
      {#if comparing && pinned}
        <div class="compare">
          <div class="modes" role="radiogroup" aria-label="Compare mode">
            <button type="button" role="radio" aria-checked={compare === 'split'} class:on={compare === 'split'} onclick={() => (compare = 'split')}>Split</button>
            <button type="button" role="radio" aria-checked={compare === 'fade'} class:on={compare === 'fade'} onclick={() => (compare = 'fade')}>Crossfade</button>
          </div>
          <input type="range" min="0" max="100" step="1" bind:value={mix} aria-label="Pinned {formatDay(pinned.date)} versus {formatDay(current.date)}" />
          <span class="legend tabular"><span>Pinned · {formatDay(pinned.date)}</span><span>{formatDay(current.date)}</span></span>
        </div>
      {/if}
      <div class="actions">
        <button class="btn" type="button" onclick={() => (playing = !playing)} disabled={!current.clip}>{playing ? 'Show still' : 'Play clip'}</button>
        <button class="btn" type="button" onclick={() => onedit(current)} disabled={!current.still}>Edit crop</button>
        <button class="btn" type="button" onclick={() => onsession(current.hold.sessionId)}>Session</button>
      </div>
    {/if}
  </footer>
</div>

<style>
  .viewer {
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
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 var(--space-2);
    min-height: var(--touch);
  }

  header .btn {
    color: inherit;
    min-width: var(--touch);
  }

  header .btn.on {
    color: var(--color-accent-tint);
    font-weight: var(--weight-semibold);
  }

  .count {
    font-size: var(--text-s);
    opacity: 0.8;
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

  footer {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4) calc(var(--space-4) + var(--safe-bottom));
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

  .legend {
    display: flex;
    justify-content: space-between;
    font-size: var(--text-xs);
    opacity: 0.75;
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

  .actions .btn:disabled {
    opacity: 0.4;
  }
</style>
