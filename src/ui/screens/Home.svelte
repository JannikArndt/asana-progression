<script lang="ts">
  import TinyFrame from '../components/TinyFrame.svelte';
  import LazyAsset from '../components/LazyAsset.svelte';
  import { app } from '../state/app.svelte';
  import { router } from '../state/router.svelte';
  import { importFiles } from '../import.svelte';
  import { pipeline } from '../pipeline/controller.svelte';
  import { formatDuration, formatTime } from '../components/timeline';
  import { formatDay } from '../format';
  import { familyStats, placeLabel, sessionPreview, sessionTinyFrame, summarizeSession } from '../state/session-data';
  import { displayCrop, fillCrop } from '../../progression';
  import { asanaFamilies, familyLetter, type AsanaFamily, type Asset, type Hold, type Session } from '../../model';

  interface Props {
    tab?: 'asanas' | 'sessions';
  }
  let { tab = 'sessions' }: Props = $props();

  let busy = $state(false);

  async function onFiles(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    if (!files.length) return;
    busy = true;
    try {
      await importFiles(files);
    } finally {
      busy = false;
    }
  }

  const interrupted = $derived(app.jobs.filter((j) => !(pipeline.running && pipeline.videoId === j.videoId)));
  /** Captured colour image per hold for the list: the small thumbnail, else the still. */
  const images = $derived.by(() => {
    const m = new Map<string, Asset>();
    for (const a of app.assets) if (a.kind === 'thumb' || (a.kind === 'still' && m.get(a.holdId)?.kind !== 'thumb')) m.set(a.holdId, a);
    return m;
  });
  /** Lettered variants (A, B, …) are one row; each letter keeps its own progression page. */
  const families = $derived(asanaFamilies(app.asanas));
  /** Holds with a captured image (asana and session previews). */
  const captured = $derived(new Set(images.keys()));
  const stats = $derived(familyStats(families, app.sessions, app.holds, captured));
  const groups = $derived.by(() => {
    const out: Array<{ group: string; families: AsanaFamily[] }> = [];
    for (const f of families) {
      const g = f.group ?? 'Other';
      const last = out[out.length - 1];
      if (last && last.group === g) last.families.push(f);
      else out.push({ group: g, families: [f] });
    }
    return out;
  });

  /** Opens the letter with the newest hold (else the first letter). */
  function openFamily(f: AsanaFamily) {
    router.go({ name: 'asana', id: stats.get(f.members[0]!.id)?.latest?.asanaId ?? f.members[0]!.id });
  }

</script>

{#snippet tiny(hold: Hold)}
  {@const sum = app.summaries[hold.videoId]}
  {#if sum}
    <TinyFrame videoId={hold.videoId} frameWidth={sum.frameWidth} frameHeight={sum.frameHeight} index={Math.round(hold.bestS * sum.sampleHz)} alt="" />
  {/if}
{/snippet}

{#snippet sessionTiny(s: Session)}
  {@const at = sessionTinyFrame(s, app.summaries)}
  {@const sum = at ? app.summaries[at.videoId] : undefined}
  {#if at && sum}
    <TinyFrame videoId={at.videoId} frameWidth={sum.frameWidth} frameHeight={sum.frameHeight} index={at.index} alt="" />
  {/if}
{/snippet}

<main class="home">
  <header class="top">
    <h1>Asanas</h1>
    <div class="tools">
      <label class="btn quiet icon import" class:disabled={busy || pipeline.running} aria-label="Import video" title="Import video">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"
          ><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg
        >
        <input class="visually-hidden" type="file" accept="video/*" multiple disabled={busy || pipeline.running} onchange={onFiles} />
      </label>
      <button class="btn quiet icon" type="button" aria-label="Settings" title="Settings" onclick={() => router.go({ name: 'settings' })}>
        <!-- Gear: eight teeth around a ring, hole in the middle. -->
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"
          ><path
            d="M10.3 2.8h3.4l.5 2.4a7.3 7.3 0 0 1 1.9 1.1l2.3-.8 1.7 2.9-1.8 1.6a7.4 7.4 0 0 1 0 2.2l1.8 1.6-1.7 2.9-2.3-.8a7.3 7.3 0 0 1-1.9 1.1l-.5 2.4h-3.4l-.5-2.4a7.3 7.3 0 0 1-1.9-1.1l-2.3.8-1.7-2.9 1.8-1.6a7.4 7.4 0 0 1 0-2.2L3.9 8.4l1.7-2.9 2.3.8a7.3 7.3 0 0 1 1.9-1.1z"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linejoin="round"
          /><circle cx="12" cy="12" r="2.8" fill="none" stroke="currentColor" stroke-width="1.6" /></svg
        >
      </button>
    </div>
  </header>

  {#if pipeline.running}
    <button class="card banner" type="button" onclick={() => router.go({ name: 'process' })}>
      <span class="dot"></span>
      <span>Processing {pipeline.fileName}…</span>
    </button>
  {/if}

  {#each interrupted as job (job.videoId)}
    <div class="card banner static">
      <div>
        <p><strong>{job.fileName}</strong> stopped at {formatTime(job.nextIndex / job.params.sampleHz)} of {formatTime(job.durationS)}.</p>
        <p class="muted small">Select the same file again to resume.</p>
      </div>
    </div>
  {/each}

  {#if app.error}
    <p class="error">{app.error}</p>
  {/if}

  <div class="tabs" role="tablist">
    <button role="tab" type="button" aria-selected={tab === 'asanas'} class:on={tab === 'asanas'} onclick={() => router.go({ name: 'home', tab: 'asanas' }, true)}>Asanas</button>
    <button role="tab" type="button" aria-selected={tab === 'sessions'} class:on={tab === 'sessions'} onclick={() => router.go({ name: 'home', tab: 'sessions' }, true)}>Sessions</button>
  </div>

  {#if tab === 'sessions'}
    <section class="list" role="tabpanel">
      {#if app.ready && app.sessions.length === 0}
        <p class="muted empty">No sessions yet. Import a practice video with + (top right) to find the holds.</p>
      {/if}
      {#each app.sessions as s (s.id)}
        {@const sum = summarizeSession(s, app.videos, app.summaries)}
        {@const template = s.templateId ? app.templates.find((t) => t.id === s.templateId) : undefined}
        {@const extra = [placeLabel(s), s.note].filter(Boolean).join(' · ')}
        {@const preview = sessionPreview(s, app.holds, captured)}
        {@const img = preview ? images.get(preview.id) : undefined}
        <button class="row session" type="button" onclick={() => router.go({ name: s.complete ? 'session-poses' : 'session', id: s.id })}>
          <!-- The whole frame, centred: place and light make a session recognizable, not the body crop. -->
          <div class="thumb">
            {#if img}
              <LazyAsset asset={img} crop={fillCrop(null, img.width, img.height, 1)} alt="">
                {#snippet fallback()}{@render sessionTiny(s)}{/snippet}
              </LazyAsset>
            {:else}
              {@render sessionTiny(s)}
            {/if}
          </div>
          <div class="row-main">
            <span class="name">{formatDay(s.date, true)}</span>
            <span class="muted small tabular line">
              {formatDuration(sum.durationS)} · {sum.labeled} labeled{sum.open ? ` · ${sum.open} open` : ''}{template ? ` · ${template.name}` : ''}
            </span>
            {#if extra}<span class="muted small line">{extra}</span>{/if}
          </div>
          <span class="chev">›</span>
        </button>
      {/each}
    </section>
  {:else}
    <section class="list" role="tabpanel">
      {#each groups as g (g.group)}
        <h2 class="section-title group">{g.group}</h2>
        <div class="tiles">
          {#each g.families as f (f.members[0]!.id)}
            {@const st = stats.get(f.members[0]!.id)}
            <button class="tile asana" class:empty-asana={!st} type="button" onclick={() => openFamily(f)}>
              <div class="tile-img">
                {#if st?.preview}
                  {@const hold = st.preview}
                  {@const img = images.get(hold.id)}
                  {#if img}
                    <LazyAsset asset={img} crop={fillCrop(displayCrop(hold), img.width, img.height, 1)} aspect={1} alt="">
                      {#snippet fallback()}{@render tiny(hold)}{/snippet}
                    </LazyAsset>
                  {:else}
                    {@render tiny(hold)}
                  {/if}
                {/if}
              </div>
              <span class="name">{f.base}</span>
              <span class="muted small tabular line">
                {st ? `${st.count} ${st.count === 1 ? 'hold' : 'holds'}${st.days > 1 ? ` · ${st.days} days` : ''}` : 'No holds yet'}
                {#if f.members.length > 1}
                  ·
                  <span class="letters">
                    {#each f.members as m (m.id)}<span class:none={!st?.perMember.has(m.id)}>{familyLetter(f, m)}</span>{/each}
                  </span>
                {/if}
              </span>
            </button>
          {/each}
        </div>
      {/each}
    </section>
  {/if}
</main>

<style>
  .home {
    padding: calc(var(--space-4) + var(--safe-top)) calc(var(--space-4) + var(--safe-right)) calc(var(--space-7) + var(--safe-bottom))
      calc(var(--space-4) + var(--safe-left));
    max-width: 720px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-top: var(--space-4);
  }

  .icon {
    width: var(--touch);
    padding: 0;
  }

  .tools {
    display: flex;
    gap: var(--space-1);
  }

  .import.disabled {
    opacity: 0.5;
    pointer-events: none;
  }

  .banner {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: var(--touch);
    padding: var(--space-3) var(--space-4);
    text-align: left;
    font: inherit;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-accent);
    animation: pulse 1.6s var(--ease) infinite;
  }

  @keyframes pulse {
    50% {
      opacity: 0.3;
    }
  }

  .tabs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    padding: 2px;
    border-radius: var(--radius-m);
    background: var(--color-neutral-tint);
  }

  .tabs button {
    min-height: 40px;
    border: 0;
    border-radius: calc(var(--radius-m) - 2px);
    background: transparent;
    font-weight: var(--weight-medium);
    color: var(--color-text-2);
  }

  .tabs button.on {
    background: var(--color-raised);
    color: var(--color-text);
  }

  .small {
    font-size: var(--text-s);
  }

  .list {
    display: flex;
    flex-direction: column;
  }

  .group {
    margin: var(--space-4) 0 var(--space-2);
  }

  /* Asanas: two columns of square pictures with name and counts. */
  .tiles {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-4) var(--space-3);
  }

  .tile {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    padding: 0;
    border: 0;
    background: transparent;
    text-align: left;
    color: inherit;
  }

  .tile .name {
    white-space: normal;
    overflow-wrap: anywhere;
    line-height: 1.25;
  }

  .tile-img {
    aspect-ratio: 1;
    margin-bottom: var(--space-1);
    overflow: hidden;
    border-radius: var(--radius-m);
    background: var(--color-neutral-tint);
  }

  .tile-img :global(.lazy),
  .tile-img :global(.frame),
  .tile-img :global(.tiny) {
    height: 100%;
    border-radius: 0;
  }

  .tile-img :global(.tiny canvas) {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .empty {
    padding: var(--space-5) 0;
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 64px;
    padding: var(--space-2) 0;
    border: 0;
    border-bottom: 1px solid var(--color-hairline);
    background: transparent;
    text-align: left;
  }

  .row-main {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }

  .name {
    font-weight: var(--weight-medium);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .line {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chev {
    color: var(--color-text-3);
    font-size: var(--text-xl);
  }

  /* Square preview: the colour still fills it (fillCrop); the gray analysis frame is cropped to fit. */
  .thumb {
    flex: none;
    width: 56px;
    aspect-ratio: 1;
    border-radius: var(--radius-s);
    overflow: hidden;
    background: var(--color-neutral-tint);
  }

  .thumb :global(.lazy),
  .thumb :global(.frame),
  .thumb :global(.tiny) {
    height: 100%;
    border-radius: 0;
  }

  .thumb :global(.tiny canvas) {
    object-fit: cover;
  }

  .empty-asana {
    opacity: 0.45;
  }

  /* Letters of the variants; those without holds yet are fainter. */
  .letters {
    display: inline-flex;
    gap: 0.4em;
  }

  .letters .none {
    color: var(--color-text-3);
  }

  .error {
    color: var(--color-danger);
  }
</style>
