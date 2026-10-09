<script lang="ts">
  import LazyAsset from '../components/LazyAsset.svelte';
  import TinyFrame from '../components/TinyFrame.svelte';
  import HoldViewer from '../components/HoldViewer.svelte';
  import Flipbook from '../components/Flipbook.svelte';
  import CropEditor from '../components/CropEditor.svelte';
  import { displayCrop, hasReps, itemAspect, nextColumns, progressionItems, repLabel, typicalAspect, type ProgressionItem, type RepFilter, type SideFilter } from '../../progression';
  import { app } from '../state/app.svelte';
  import { router } from '../state/router.svelte';
  import { capture } from '../state/capture.svelte';
  import { setManualCrop } from '../state/hold-actions';
  import { formatDay } from '../format';

  interface Props {
    id: string;
  }
  let { id }: Props = $props();

  type Mode = 'feed' | 'grid';
  const VIEW_KEY = 'asana.progression.view';
  function savedView(): { mode: Mode; columns: number } {
    try {
      const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}') as { mode?: Mode; columns?: number };
      return { mode: v.mode === 'grid' ? 'grid' : 'feed', columns: Math.min(4, Math.max(2, Math.round(v.columns ?? 3))) };
    } catch {
      return { mode: 'feed', columns: 3 };
    }
  }
  const initial = savedView();
  let mode = $state<Mode>(initial.mode);
  let columns = $state(initial.columns);
  $effect(() => {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify({ mode, columns }));
    } catch {
      /* private mode */
    }
  });

  let side = $state<SideFilter>('both');
  /** All reps, or only the first / last of each run (e.g. 1st vs 5th Navasana across days). */
  let reps = $state<RepFilter>('all');
  let viewerIndex = $state<number | null>(null);
  let flipbook = $state(false);
  let editing = $state<ProgressionItem | null>(null);
  let pinnedId = $state<string | null>(readPin());

  function readPin(): string | null {
    try {
      return localStorage.getItem(`asana.pinned.${id}`);
    } catch {
      return null;
    }
  }
  function pin(holdId: string | null) {
    pinnedId = holdId;
    try {
      if (holdId) localStorage.setItem(`asana.pinned.${id}`, holdId);
      else localStorage.removeItem(`asana.pinned.${id}`);
    } catch {
      /* private mode */
    }
  }

  const asana = $derived(app.asanas.find((a) => a.id === id));
  /** Oldest first (viewer and flipbook order). */
  const items = $derived(progressionItems(id, app.holds, app.sessions, app.assets, side, reps));
  const repeated = $derived(hasReps(id, app.holds, app.sessions));
  /** Newest first (feed and grid). */
  const newest = $derived([...items].reverse());
  const withStills = $derived(items.filter((i) => i.still));
  const tileAspect = $derived(typicalAspect(items));

  // Capture missing stills and clips of this asana when the video files are available.
  let requested = false;
  $effect(() => {
    if (!app.ready || requested) return;
    requested = true;
    capture.request(app.holds.filter((h) => h.asanaId === id));
  });

  function open(item: ProgressionItem) {
    viewerIndex = items.indexOf(item);
  }

  function statusText(item: ProgressionItem): string {
    const s = capture.status[item.hold.id];
    if (s === 'queued' || s === 'capturing') return 'Capturing…';
    if (s === 'needs-file') return 'Open the session and re-attach the video to capture the still.';
    if (s === 'error') return 'Capture failed.';
    return '';
  }

  // ----- grid density: pinch (touch) or ctrl + wheel (trackpad pinch) -----
  const touches = new Map<number, { x: number; y: number }>();
  let pinchStart = 0;
  let pinchScale = $state(1);
  let suppressClickUntil = 0;

  function dist(): number {
    const [a, b] = [...touches.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  function onGridDown(e: PointerEvent) {
    if (e.pointerType !== 'touch') return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) {
      pinchStart = dist();
      pinchScale = 1;
    }
  }

  function onGridMove(e: PointerEvent) {
    if (!touches.has(e.pointerId)) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2 && pinchStart > 0) pinchScale = Math.min(1.5, Math.max(0.6, dist() / pinchStart));
  }

  function onGridUp(e: PointerEvent) {
    if (!touches.delete(e.pointerId)) return;
    if (pinchStart > 0 && touches.size < 2) {
      columns = nextColumns(columns, pinchScale);
      pinchStart = 0;
      pinchScale = 1;
      suppressClickUntil = performance.now() + 400;
    }
  }

  let wheelAcc = 0;
  function onGridWheel(e: WheelEvent) {
    if (!e.ctrlKey) return;
    e.preventDefault();
    wheelAcc += e.deltaY;
    if (Math.abs(wheelAcc) > 40) {
      columns = nextColumns(columns, wheelAcc < 0 ? 1.3 : 0.7);
      wheelAcc = 0;
    }
  }

  function onTile(item: ProgressionItem) {
    if (performance.now() < suppressClickUntil) return;
    open(item);
  }
</script>

<main class="asana">
  <header class="top">
    <button class="btn quiet" type="button" onclick={() => router.go({ name: 'home', tab: 'asanas' })}>‹ Asanas</button>
    {#if withStills.length >= 2}
      <button class="btn quiet" type="button" onclick={() => (flipbook = true)}>Flipbook</button>
    {/if}
  </header>
  {#if asana}
    <div class="title">
      <h2>{asana.name}</h2>
      <p class="muted small">{asana.group ?? ''} · {items.length} {items.length === 1 ? 'hold' : 'holds'}</p>
    </div>
    <div class="bar">
      {#if asana.sided}
        <div class="segmented" role="radiogroup" aria-label="Side">
          {#each [['both', 'Both'], ['R', 'Right'], ['L', 'Left']] as const as [value, text] (value)}
            <button type="button" role="radio" aria-checked={side === value} class:on={side === value} onclick={() => (side = value)}>{text}</button>
          {/each}
        </div>
      {/if}
      {#if repeated}
        <div class="segmented" role="radiogroup" aria-label="Reps">
          {#each [['all', 'All reps'], ['first', 'First'], ['last', 'Last']] as const as [value, text] (value)}
            <button type="button" role="radio" aria-checked={reps === value} class:on={reps === value} onclick={() => (reps = value)}>{text}</button>
          {/each}
        </div>
      {/if}
      <div class="segmented view" role="radiogroup" aria-label="Layout">
        <button type="button" role="radio" aria-checked={mode === 'feed'} class:on={mode === 'feed'} onclick={() => (mode = 'feed')}>Feed</button>
        <button type="button" role="radio" aria-checked={mode === 'grid'} class:on={mode === 'grid'} onclick={() => (mode = 'grid')}>Grid</button>
      </div>
    </div>

    {#if !items.length}
      <p class="muted">No holds labeled yet. Label holds in a session to see them here.</p>
    {:else if mode === 'feed'}
      <ol class="feed">
        {#each newest as item (item.hold.id)}
          {@const sum = app.summaries[item.hold.videoId]}
          {@const a = itemAspect(item)}
          <li>
            <button class="item" type="button" onclick={() => open(item)}>
              <LazyAsset asset={item.still} crop={displayCrop(item.hold)} aspect={a !== null && a < 0.8 ? 0.8 : null} alt="{asana.name} {formatDay(item.date)}">
                {#snippet fallback()}
                  <div class="placeholder">
                    {#if sum}
                      <TinyFrame videoId={item.hold.videoId} frameWidth={sum.frameWidth} frameHeight={sum.frameHeight} index={Math.round(item.hold.bestS * sum.sampleHz)} alt="" />
                    {/if}
                    {#if statusText(item)}<span class="status">{statusText(item)}</span>{/if}
                  </div>
                {/snippet}
              </LazyAsset>
              <span class="caption">
                <span class="date tabular">{formatDay(item.date, true)}{item.hold.side ? ` · ${item.hold.side}` : ''}{repLabel(item) ? ` · rep ${repLabel(item)}` : ''}</span>
                {#if item.note}<span class="note">{item.note}</span>{/if}
              </span>
            </button>
          </li>
        {/each}
      </ol>
    {:else}
      <div
        class="grid"
        style:--cols={columns}
        style:transform={pinchScale !== 1 ? `scale(${pinchScale})` : null}
        onpointerdown={onGridDown}
        onpointermove={onGridMove}
        onpointerup={onGridUp}
        onpointercancel={onGridUp}
        onwheel={onGridWheel}
        role="list"
        aria-label="Holds, {columns} columns (pinch to change)"
      >
        {#each newest as item (item.hold.id)}
          {@const sum = app.summaries[item.hold.videoId]}
          <div role="listitem">
            <button class="tile" type="button" onclick={() => onTile(item)}>
              <LazyAsset asset={columns >= 3 ? (item.thumb ?? item.still) : item.still} crop={displayCrop(item.hold)} aspect={tileAspect} alt="{asana.name} {formatDay(item.date)}">
                {#snippet fallback()}
                  <div class="placeholder" style:aspect-ratio={tileAspect}>
                    {#if sum}
                      <TinyFrame videoId={item.hold.videoId} frameWidth={sum.frameWidth} frameHeight={sum.frameHeight} index={Math.round(item.hold.bestS * sum.sampleHz)} alt="" />
                    {/if}
                  </div>
                {/snippet}
              </LazyAsset>
              <span class="tile-caption tabular">{formatDay(item.date)}{item.hold.side ? ` · ${item.hold.side}` : ''}{repLabel(item) ? ` · ${repLabel(item)}` : ''}</span>
            </button>
          </div>
        {/each}
      </div>
    {/if}
  {:else if app.ready}
    <p class="muted">Unknown asana.</p>
  {/if}
</main>

{#if viewerIndex !== null && asana}
  <HoldViewer
    {items}
    bind:index={viewerIndex}
    {pinnedId}
    title={asana.name}
    onpin={pin}
    onedit={(item) => (editing = item)}
    onsession={(sessionId) => router.go({ name: 'session', id: sessionId })}
    onclose={() => (viewerIndex = null)}
  />
{/if}

{#if flipbook && asana}
  <Flipbook items={withStills} title={asana.name} onclose={() => (flipbook = false)} />
{/if}

{#if editing?.still && asana}
  {@const hold = app.holds.find((h) => h.id === editing!.hold.id) ?? editing.hold}
  <CropEditor
    {hold}
    still={editing.still}
    title="Crop · {formatDay(editing.date)}"
    onsave={async (manual) => {
      await setManualCrop(hold.id, manual);
      editing = null;
    }}
    onclose={() => (editing = null)}
  />
{/if}

<style>
  .asana {
    padding: calc(var(--space-2) + var(--safe-top)) calc(var(--space-4) + var(--safe-right)) calc(var(--space-7) + var(--safe-bottom))
      calc(var(--space-4) + var(--safe-left));
    max-width: 720px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .top {
    display: flex;
    justify-content: space-between;
    margin: 0 calc(-1 * var(--space-3));
  }

  .title {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .small {
    font-size: var(--text-s);
  }

  .bar {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-3);
  }

  .segmented {
    flex: 1;
    display: grid;
    grid-auto-columns: 1fr;
    grid-auto-flow: column;
    padding: 2px;
    border-radius: var(--radius-m);
    background: var(--color-neutral-tint);
  }

  .segmented.view {
    flex: 0 0 auto;
    min-width: 140px;
  }

  .segmented button {
    min-height: 40px;
    padding: 0 var(--space-3);
    border: 0;
    border-radius: calc(var(--radius-m) - 2px);
    background: transparent;
    font-weight: var(--weight-medium);
    color: var(--color-text-2);
  }

  .segmented button.on {
    background: var(--color-surface);
    color: var(--color-text);
  }

  .feed {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .item {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    text-align: left;
    color: inherit;
  }

  .caption {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .date {
    font-weight: var(--weight-medium);
  }

  .note {
    font-size: var(--text-s);
    color: var(--color-text-2);
  }

  .placeholder {
    position: relative;
    width: 100%;
    overflow: hidden;
    border-radius: var(--radius-m);
    background: var(--color-neutral-tint);
  }

  .placeholder :global(canvas) {
    display: block;
    width: 100%;
    height: auto;
    image-rendering: auto;
    opacity: 0.6;
  }

  .status {
    position: absolute;
    left: var(--space-2);
    right: var(--space-2);
    bottom: var(--space-2);
    font-size: var(--text-xs);
    color: var(--color-text);
    background: var(--color-surface);
    border-radius: var(--radius-s);
    padding: var(--space-1) var(--space-2);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
    gap: var(--space-2);
    touch-action: pan-y;
    transform-origin: 50% 0;
    transition: grid-template-columns var(--duration) var(--ease);
  }

  .tile {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: 0;
    border: 0;
    background: transparent;
    text-align: left;
    color: inherit;
  }

  .tile-caption {
    font-size: var(--text-xs);
    color: var(--color-text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
