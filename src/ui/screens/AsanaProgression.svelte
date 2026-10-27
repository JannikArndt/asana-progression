<script lang="ts" module>
  import type { RepFilter as CarriedReps, SideFilter as CarriedSide } from '../../progression';
  /** Side and rep filters carried over when switching between the letters of a family. */
  let carried: { side: CarriedSide; reps: CarriedReps } | null = null;
</script>

<script lang="ts">
  import LazyAsset from '../components/LazyAsset.svelte';
  import TinyFrame from '../components/TinyFrame.svelte';
  import HoldViewer from '../components/HoldViewer.svelte';
  import Flipbook from '../components/Flipbook.svelte';
  import CropEditor from '../components/CropEditor.svelte';
  import FrameScrubber from '../components/FrameScrubber.svelte';
  import { displayCrop, hasReps, itemAspect, nextColumns, progressionItems, repLabel, typicalAspect, type ProgressionItem, type RepFilter, type SideFilter } from '../../progression';
  import { app } from '../state/app.svelte';
  import { router } from '../state/router.svelte';
  import { capture } from '../state/capture.svelte';
  import { chooseBestFrame, setManualCrop } from '../state/hold-actions';
  import VideoFinder from '../components/VideoFinder.svelte';
  import CropExportNotice from '../components/CropExportNotice.svelte';
  import { cropExport } from '../state/crop-export.svelte';
  import { asanaFamilies, familyLetter } from '../../model';
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

  const kept = carried;
  carried = null;
  let side = $state<SideFilter>(kept?.side ?? 'both');
  /** All reps, or only the first / last of each run (e.g. 1st vs 5th Navasana across days). */
  let reps = $state<RepFilter>(kept?.reps ?? 'all');
  let viewerIndex = $state<number | null>(null);
  let flipbook = $state(false);
  let editing = $state<ProgressionItem | null>(null);
  /** Choosing another best frame for this hold (from the viewer). */
  let framing = $state<ProgressionItem | null>(null);
  /** The hold the viewer compares the others with (remembered per asana; key from when it was "pin"). */
  let compareId = $state<string | null>(readCompare());

  function readCompare(): string | null {
    try {
      return localStorage.getItem(`asana.pinned.${id}`);
    } catch {
      return null;
    }
  }
  function setCompare(holdId: string | null) {
    compareId = holdId;
    try {
      if (holdId) localStorage.setItem(`asana.pinned.${id}`, holdId);
      else localStorage.removeItem(`asana.pinned.${id}`);
    } catch {
      /* private mode */
    }
  }

  const asana = $derived(app.asanas.find((a) => a.id === id));
  /** Lettered variants of this asana (A | B | …); each letter is its own progression. */
  const family = $derived(asanaFamilies(app.asanas).find((f) => f.members.some((m) => m.id === id)));
  const letters = $derived(family && family.members.length > 1 ? family : null);
  const memberCounts = $derived.by(() => {
    const m = new Map<string, number>();
    for (const h of app.holds) m.set(h.asanaId, (m.get(h.asanaId) ?? 0) + 1);
    return m;
  });

  function chooseLetter(memberId: string) {
    if (memberId === id) return;
    const target = app.asanas.find((a) => a.id === memberId);
    carried = { side: target?.sided ? side : 'both', reps };
    router.go({ name: 'asana', id: memberId }, true);
  }
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

  /** Videos whose file is needed to capture stills of this asana's holds. */
  const waiting = $derived.by(() => {
    const ids = capture.waitingForFile(app.holds.filter((h) => h.asanaId === id));
    return app.videos.filter((v) => ids.has(v.id));
  });
  const waitingHolds = $derived(items.filter((i) => capture.status[i.hold.id] === 'needs-file').length);
  let attachMessage = $state<string | null>(null);

  const QUALITY: Record<string, string> = { '720p': '720p', '1080p': '1080p', original: 'Original' };

  function open(item: ProgressionItem) {
    viewerIndex = items.indexOf(item);
  }

  /** Cropped stills of the shown holds (side and rep filters apply), oldest first. */
  function exportCrops() {
    const a = asana;
    if (!a) return;
    const slug = a.name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'asana';
    void cropExport.prepare(`asana:${id}`, items, `${slug}-progression`);
  }

  function statusText(item: ProgressionItem): string {
    const s = capture.status[item.hold.id];
    if (s === 'queued' || s === 'capturing') return 'Capturing…';
    if (s === 'needs-file') return 'Needs the video (see above)';
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
    <span class="actions">
      {#if withStills.length}
        <button class="btn quiet" type="button" onclick={exportCrops} disabled={!!cropExport.preparing}>Export</button>
      {/if}
      {#if withStills.length >= 2}
        <button class="btn quiet" type="button" onclick={() => (flipbook = true)}>Flipbook</button>
      {/if}
    </span>
  </header>
  {#if asana}
    <div class="title">
      <h2>{letters ? letters.base : asana.name}</h2>
      <p class="muted small">{asana.group ?? ''} · {items.length} {items.length === 1 ? 'hold' : 'holds'}</p>
    </div>
    {#if letters}
      <div class="segmented letters" role="radiogroup" aria-label="Variant">
        {#each letters.members as m (m.id)}
          {@const n = memberCounts.get(m.id) ?? 0}
          <button type="button" role="radio" aria-checked={m.id === id} aria-label={m.name} class:on={m.id === id} onclick={() => chooseLetter(m.id)}>
            {familyLetter(letters, m)}{#if n}<span class="count tabular">{n}</span>{/if}
          </button>
        {/each}
      </div>
    {/if}
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

    {#if waiting.length || attachMessage}
      <div class="card notice">
        {#if waiting.length}
          <p class="small">
            {waitingHolds}
            {waitingHolds === 1 ? 'hold has' : 'holds have'} no full-resolution still yet. Select the video{waiting.length === 1 ? '' : 's'} to capture
            {waitingHolds === 1 ? 'it' : 'them'}.
          </p>
          <VideoFinder videos={waiting} onresult={(m) => (attachMessage = m)} />
        {/if}
        {#if attachMessage}<p class="small" aria-live="polite">{attachMessage}</p>{/if}
      </div>
    {/if}

    <CropExportNotice scope="asana:{id}" />

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
                <span class="line">
                  <span class="date tabular">{formatDay(item.date, true)}{item.hold.side ? ` · ${item.hold.side}` : ''}{repLabel(item) ? ` · rep ${repLabel(item)}` : ''}</span>
                  {#if item.hold.id === compareId}<span class="badge reference" title="Compared with the other days in the viewer">Compare</span>{/if}
                  {#if item.clip}<span class="badge" title="Clip quality">{item.clip.quality ? (QUALITY[item.clip.quality] ?? item.clip.quality) : 'Clip'}</span>{/if}
                </span>
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
    {compareId}
    title={asana.name}
    covered={!!editing || !!framing}
    oncompare={setCompare}
    onedit={(item) => (editing = item)}
    onframe={(item) => (framing = item)}
    onsession={(sessionId) => router.go({ name: 'session', id: sessionId })}
    onclose={() => (viewerIndex = null)}
  />
{/if}

{#if framing}
  {@const hold = app.holds.find((h) => h.id === framing!.hold.id) ?? framing.hold}
  {@const sum = app.summaries[hold.videoId]}
  {#if sum}
    <!-- Sheets sit below full-screen overlays; this one opens from the viewer. -->
    <div class="above-viewer">
      <FrameScrubber
        title="Choose frame · {formatDay(framing.date)}"
        confirmLabel="Use this frame"
        videoId={hold.videoId}
        frameWidth={sum.frameWidth}
        frameHeight={sum.frameHeight}
        sampleHz={sum.sampleHz}
        fromS={hold.startS}
        toS={hold.endS}
        valueS={hold.bestS}
        marks={sum.candidates.find((c) => c.holdId === hold.id)?.alternatesS ?? []}
        onconfirm={async (t) => {
          const holdId = hold.id;
          framing = null;
          await chooseBestFrame(holdId, t);
        }}
        onclose={() => (framing = null)}
      />
    </div>
  {/if}
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

  .actions {
    display: flex;
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

  /* Never shrink below the labels: the bar wraps to a second row instead. */
  .segmented {
    flex: 1 0 auto;
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
    white-space: nowrap;
    border: 0;
    border-radius: calc(var(--radius-m) - 2px);
    background: transparent;
    font-weight: var(--weight-medium);
    color: var(--color-text-2);
  }

  .segmented button.on {
    background: var(--color-raised);
    color: var(--color-text);
  }

  /* Letters of a family (A | B | …): directly under the title, each letter its own progression. */
  .segmented.letters {
    flex: none;
    margin-top: calc(-1 * var(--space-2));
  }

  .segmented.letters button {
    min-height: var(--touch);
  }

  .count {
    margin-left: var(--space-1);
    font-size: var(--text-xs);
    font-weight: var(--weight-regular);
    color: var(--color-text-3);
  }

  .on .count {
    color: var(--color-text-2);
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

  .line {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .above-viewer {
    position: relative;
    z-index: 70;
  }

  .badge.reference {
    margin-left: auto;
    background: var(--color-accent-tint);
    color: var(--color-accent-strong);
  }

  .badge {
    flex: none;
    padding: 1px var(--space-2);
    border-radius: var(--radius-pill);
    background: var(--color-neutral-tint);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    color: var(--color-text-2);
  }

  .notice {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
  }

  .notice p {
    margin: 0;
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
