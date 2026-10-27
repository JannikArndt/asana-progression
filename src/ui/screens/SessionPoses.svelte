<script lang="ts">
  import LazyAsset from '../components/LazyAsset.svelte';
  import TinyFrame from '../components/TinyFrame.svelte';
  import HoldViewer from '../components/HoldViewer.svelte';
  import CropEditor from '../components/CropEditor.svelte';
  import FrameScrubber from '../components/FrameScrubber.svelte';
  import VideoFinder from '../components/VideoFinder.svelte';
  import CropExportNotice from '../components/CropExportNotice.svelte';
  import { displayCrop, repLabel, sessionItems, typicalAspect, type ProgressionItem } from '../../progression';
  import { app } from '../state/app.svelte';
  import { router, routeHash } from '../state/router.svelte';
  import { capture } from '../state/capture.svelte';
  import { cropExport } from '../state/crop-export.svelte';
  import { chooseBestFrame, setManualCrop } from '../state/hold-actions';
  import { placeLabel } from '../state/session-data';
  import { formatDay } from '../format';

  interface Props {
    id: string;
  }
  let { id }: Props = $props();

  const COLUMNS_KEY = 'asana.sessionPoses.columns';
  function savedColumns(): number {
    try {
      const n = Number(localStorage.getItem(COLUMNS_KEY));
      return n >= 1 && n <= 3 ? Math.round(n) : 2;
    } catch {
      return 2;
    }
  }
  let columns = $state(savedColumns());
  $effect(() => {
    try {
      localStorage.setItem(COLUMNS_KEY, String(columns));
    } catch {
      /* private mode */
    }
  });

  const session = $derived(app.sessions.find((s) => s.id === id));
  /** The session's labeled holds in practice order. */
  const items = $derived(sessionItems(id, app.holds, app.sessions, app.assets));
  const tileAspect = $derived(typicalAspect(items));
  const withStills = $derived(items.filter((i) => i.still).length);
  const place = $derived(session ? placeLabel(session) : null);
  const scope = $derived(`session:${id}`);
  const nameById = $derived(new Map(app.asanas.map((a) => [a.id, a.name])));
  const nameOf = (item: ProgressionItem) => nameById.get(item.hold.asanaId) ?? 'Unknown asana';

  let viewerIndex = $state<number | null>(null);
  let editing = $state<ProgressionItem | null>(null);
  let framing = $state<ProgressionItem | null>(null);
  let attachMessage = $state<string | null>(null);

  // Capture missing stills of this session when the video files are available.
  let requested = false;
  $effect(() => {
    if (!app.ready || requested) return;
    requested = true;
    capture.request(app.holds.filter((h) => h.sessionId === id));
  });

  const waiting = $derived.by(() => {
    const ids = capture.waitingForFile(app.holds.filter((h) => h.sessionId === id));
    return app.videos.filter((v) => ids.has(v.id));
  });
  const waitingHolds = $derived(items.filter((i) => capture.status[i.hold.id] === 'needs-file').length);

  function exportCrops() {
    if (!session) return;
    void cropExport.prepare(scope, items, `asana-progression-${session.date.slice(0, 10)}`);
  }

  function caption(item: ProgressionItem): string {
    return [item.hold.side, repLabel(item) ? `rep ${repLabel(item)}` : ''].filter(Boolean).join(' · ');
  }
</script>

<main class="poses">
  <header class="top">
    <a class="btn quiet" href={routeHash({ name: 'session', id })}>‹ Session</a>
    {#if withStills}
      <button class="btn quiet" type="button" onclick={exportCrops} disabled={!!cropExport.preparing}>Export</button>
    {/if}
  </header>

  {#if session}
    <div class="title">
      <h2>{formatDay(session.date, true)}</h2>
      <p class="muted small">{items.length} {items.length === 1 ? 'pose' : 'poses'}{place ? ` · ${place}` : ''}</p>
    </div>

    {#if items.length}
      <div class="segmented" role="radiogroup" aria-label="Columns">
        {#each [1, 2, 3] as n (n)}
          <button type="button" role="radio" aria-checked={columns === n} class:on={columns === n} onclick={() => (columns = n)}>{n} {n === 1 ? 'column' : 'columns'}</button>
        {/each}
      </div>
    {/if}

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

    <CropExportNotice {scope} />

    {#if !items.length}
      <p class="muted">No holds labeled in this session yet. <a href={routeHash({ name: 'session', id })}>Label them in the review.</a></p>
    {:else}
      <ol class="grid" style:--cols={columns}>
        {#each items as item, i (item.hold.id)}
          {@const sum = app.summaries[item.hold.videoId]}
          {@const name = nameOf(item)}
          <li>
            <button class="tile" type="button" onclick={() => (viewerIndex = i)}>
              <LazyAsset asset={columns >= 3 ? (item.thumb ?? item.still) : item.still} crop={displayCrop(item.hold)} aspect={tileAspect} alt={name}>
                {#snippet fallback()}
                  <div class="placeholder" style:aspect-ratio={tileAspect}>
                    {#if sum}
                      <TinyFrame videoId={item.hold.videoId} frameWidth={sum.frameWidth} frameHeight={sum.frameHeight} index={Math.round(item.hold.bestS * sum.sampleHz)} alt="" />
                    {/if}
                  </div>
                {/snippet}
              </LazyAsset>
              <span class="tile-caption">
                <span class="name">{name}</span>
                {#if caption(item)}<span class="meta tabular">{caption(item)}</span>{/if}
              </span>
            </button>
          </li>
        {/each}
      </ol>
    {/if}
  {:else if app.ready}
    <p class="muted">This session no longer exists.</p>
  {/if}
</main>

{#if viewerIndex !== null && session}
  <HoldViewer
    {items}
    bind:index={viewerIndex}
    compareId={null}
    title={formatDay(session.date)}
    heading={nameOf}
    covered={!!editing || !!framing}
    onedit={(item) => (editing = item)}
    onframe={(item) => (framing = item)}
    onsession={() => router.go({ name: 'session', id })}
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
        title="Choose frame · {nameOf(framing)}"
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

{#if editing?.still}
  {@const hold = app.holds.find((h) => h.id === editing!.hold.id) ?? editing.hold}
  <CropEditor
    {hold}
    still={editing.still}
    title="Crop · {nameOf(editing)}"
    onsave={async (manual) => {
      await setManualCrop(hold.id, manual);
      editing = null;
    }}
    onclose={() => (editing = null)}
  />
{/if}

<style>
  .poses {
    padding: calc(var(--space-2) + var(--safe-top)) calc(var(--space-4) + var(--safe-right)) calc(var(--space-7) + var(--safe-bottom))
      calc(var(--space-4) + var(--safe-left));
    max-width: 960px;
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

  .top a {
    text-decoration: none;
  }

  .title {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .small {
    font-size: var(--text-s);
  }

  .segmented {
    display: grid;
    grid-auto-columns: 1fr;
    grid-auto-flow: column;
    padding: 2px;
    border-radius: var(--radius-m);
    background: var(--color-neutral-tint);
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

  .notice {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
  }

  .notice p {
    margin: 0;
  }

  .grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
    gap: var(--space-4) var(--space-2);
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
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .name {
    font-size: var(--text-s);
    font-weight: var(--weight-medium);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta {
    font-size: var(--text-xs);
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
    opacity: 0.6;
  }

  .above-viewer {
    position: relative;
    z-index: 70;
  }
</style>
