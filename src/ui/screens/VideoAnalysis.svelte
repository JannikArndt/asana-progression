<script lang="ts">
  import { tick } from 'svelte';
  import TimelineGraph from '../components/TimelineGraph.svelte';
  import TinyFrame from '../components/TinyFrame.svelte';
  import FrameProbe from '../components/FrameProbe.svelte';
  import DebugPanel from '../components/DebugPanel.svelte';
  import { formatDuration, formatTime, type Span } from '../components/timeline';
  import { app } from '../state/app.svelte';
  import { router } from '../state/router.svelte';
  import type { Analysis, Video } from '../../model';

  interface Props {
    id: string;
  }
  let { id }: Props = $props();

  let video = $state<Video | null>(null);
  let analysis = $state<Analysis | null>(null);
  let loaded = $state(false);
  let selectedId = $state<string | null>(null);
  let graphOpen = $state(true);
  let debugOpen = $state(false);
  let probe = $state<number | null>(null);
  let version = $state(0);

  async function load(videoId: string) {
    const db = app.db;
    const [v, a] = await Promise.all([db.videos.get(videoId), db.analyses.get(videoId)]);
    video = v ?? null;
    analysis = a ?? null;
    loaded = true;
    version++;
  }

  $effect(() => {
    if (app.ready) void load(id);
  });

  const spans = $derived<Span[]>(
    analysis?.candidates.map((c) => ({
      id: c.id,
      startS: c.startS,
      endS: c.endS,
      bestS: c.bestS,
      alternatesS: c.alternatesS,
      status: c.status,
    })) ?? [],
  );
  const hasFile = $derived(app.files.has(id));

  async function selectFromGraph(cid: string) {
    selectedId = cid;
    await tick();
    document.getElementById(`card-${cid}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function dateLabel(iso: string | null | undefined): string {
    return iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : 'unknown date';
  }
</script>

<main class="analysis">
  <header class="top">
    <button class="btn quiet back" type="button" onclick={() => router.go({ name: 'home' })}>‹ Videos</button>
  </header>

  {#if loaded && !video}
    <p class="muted">This video no longer exists.</p>
  {:else if video}
    <div class="title">
      <h2>{video.fileName}</h2>
      <p class="muted small tabular">
        {dateLabel(video.recordedAt)} · {formatDuration(video.durationS)}{analysis ? ` · ${analysis.candidates.length} holds` : ''}
      </p>
    </div>

    {#if analysis}
      <section class="graph-section">
        <button class="disclosure" type="button" aria-expanded={graphOpen} onclick={() => (graphOpen = !graphOpen)}>
          <span class="section-title">Timeline</span>
          <span class="chev" class:open={graphOpen}>›</span>
        </button>
        {#if graphOpen}
          <div class="card graph">
            <TimelineGraph
              durationS={video.durationS}
              sampleHz={analysis.sampleHz}
              values={analysis.C}
              {version}
              threshold={analysis.threshold}
              {spans}
              {selectedId}
              onselect={selectFromGraph}
            />
          </div>
        {/if}
      </section>

      <section class="cards">
        {#each analysis.candidates as c, i (c.id)}
          <article id="card-{c.id}" class="cand card" class:selected={c.id === selectedId}>
            <button class="thumb" type="button" onclick={() => (selectedId = c.id)} aria-label="Select hold {i + 1}">
              <TinyFrame
                videoId={id}
                frameWidth={analysis.frameWidth}
                frameHeight={analysis.frameHeight}
                index={Math.round(c.bestS * analysis.sampleHz)}
                {version}
                alt="Best frame of hold {i + 1}"
              />
            </button>
            <div class="info">
              <span class="label">Hold {i + 1}</span>
              <span class="muted small tabular">{formatTime(c.startS)}–{formatTime(c.endS)} · {formatDuration(c.endS - c.startS)}</span>
              <span class="faint small tabular">best {formatTime(c.bestS)}{c.alternatesS.length ? ` · ${c.alternatesS.length} merged` : ''}</span>
              <button class="btn quiet small-btn" type="button" onclick={() => (probe = c.bestS)} disabled={!hasFile}>
                Full frame
              </button>
            </div>
          </article>
        {:else}
          <p class="muted">No holds found. Try lowering “Minimum hold” or raising “Still percentile” in Debug.</p>
        {/each}
      </section>
    {:else if loaded}
      <p class="muted">Not analysed yet. Import the file again to process it.</p>
    {/if}

    <section>
      <button class="disclosure" type="button" aria-expanded={debugOpen} onclick={() => (debugOpen = !debugOpen)}>
        <span class="section-title">Debug</span>
        <span class="chev" class:open={debugOpen}>›</span>
      </button>
      {#if debugOpen}
        <DebugPanel {video} {analysis} onchanged={() => load(id)} />
      {/if}
    </section>
  {/if}
</main>

{#if probe !== null}
  <FrameProbe videoId={id} timestampS={probe} onclose={() => (probe = null)} />
{/if}

<style>
  .analysis {
    padding: calc(var(--space-2) + var(--safe-top)) calc(var(--space-4) + var(--safe-right)) calc(var(--space-7) + var(--safe-bottom))
      calc(var(--space-4) + var(--safe-left));
    max-width: 720px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .top {
    margin: 0 calc(-1 * var(--space-3));
  }

  .title {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .title h2 {
    overflow-wrap: anywhere;
  }

  .small {
    font-size: var(--text-s);
  }

  .disclosure {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    min-height: var(--touch);
    padding: 0;
    border: 0;
    background: transparent;
  }

  .chev {
    color: var(--color-text-3);
    font-size: var(--text-xl);
    transition: transform var(--duration) var(--ease);
  }

  .chev.open {
    transform: rotate(90deg);
  }

  .graph {
    padding: var(--space-2) 0 var(--space-1);
    overflow: hidden;
  }

  .cards {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .cand {
    display: grid;
    grid-template-columns: minmax(0, 46%) minmax(0, 1fr);
    gap: var(--space-3);
    padding: var(--space-2);
    transition: border-color var(--duration) var(--ease), background var(--duration) var(--ease);
    scroll-margin: var(--space-6);
  }

  .cand.selected {
    border-color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent-tint) 35%, var(--color-surface));
  }

  .thumb {
    padding: 0;
    border: 0;
    background: transparent;
  }

  .info {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    min-width: 0;
  }

  .label {
    font-weight: var(--weight-medium);
  }

  .small-btn {
    align-self: flex-start;
    min-height: 36px;
    padding: 0;
    margin-top: var(--space-1);
    font-size: var(--text-s);
  }
</style>
