<script lang="ts">
  import TinyFrame from '../components/TinyFrame.svelte';
  import { app } from '../state/app.svelte';
  import { router } from '../state/router.svelte';
  import { importFiles } from '../import.svelte';
  import { pipeline } from '../pipeline/controller.svelte';
  import { formatDuration, formatTime } from '../components/timeline';
  import { asanaStats, summarizeSession } from '../state/session-data';

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

  function shortDate(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso.slice(0, 10) + 'T12:00:00Z');
    return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }

  function longDate(iso: string): string {
    const d = new Date(iso.slice(0, 10) + 'T12:00:00Z');
    return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }

  const interrupted = $derived(app.jobs.filter((j) => !(pipeline.running && pipeline.videoId === j.videoId)));
  const stats = $derived(asanaStats(app.sessions, app.holds));
  const groups = $derived.by(() => {
    const out: Array<{ group: string; asanas: typeof app.asanas }> = [];
    for (const a of app.asanas) {
      const g = a.group ?? 'Other';
      const last = out[out.length - 1];
      if (last && last.group === g) last.asanas.push(a);
      else out.push({ group: g, asanas: [a] });
    }
    return out;
  });
</script>

<main class="home">
  <header class="top">
    <h1>Asanas</h1>
    <button class="btn quiet icon" type="button" aria-label="Settings" onclick={() => router.go({ name: 'settings' })}>
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"
        ><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.6" /><path
          d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
        /></svg
      >
    </button>
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

  <label class="btn primary import" class:disabled={busy || pipeline.running}>
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"
      ><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg
    >
    Import video
    <input class="visually-hidden" type="file" accept="video/*" multiple disabled={busy || pipeline.running} onchange={onFiles} />
  </label>

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
        <p class="muted empty">No sessions yet. Import a practice video to find the holds.</p>
      {/if}
      {#each app.sessions as s (s.id)}
        {@const sum = summarizeSession(s, app.videos, app.summaries)}
        <button class="row" type="button" onclick={() => router.go({ name: 'session', id: s.id })}>
          <div class="row-main">
            <span class="name">{longDate(s.date)}</span>
            <span class="muted small tabular">
              {formatDuration(sum.durationS)} · {sum.labeled} labeled{sum.open ? ` · ${sum.open} open` : ''}{s.note ? ` · ${s.note}` : ''}
            </span>
          </div>
          <span class="chev">›</span>
        </button>
      {/each}
    </section>
  {:else}
    <section class="list" role="tabpanel">
      {#each groups as g (g.group)}
        <h2 class="section-title group">{g.group}</h2>
        {#each g.asanas as a (a.id)}
          {@const st = stats.get(a.id)}
          {@const sum = st?.latest ? app.summaries[st.latest.videoId] : undefined}
          <button class="row asana" class:empty-asana={!st} type="button" onclick={() => router.go({ name: 'asana', id: a.id })}>
            <div class="thumb">
              {#if st?.latest && sum}
                <TinyFrame
                  videoId={st.latest.videoId}
                  frameWidth={sum.frameWidth}
                  frameHeight={sum.frameHeight}
                  index={Math.round(st.latest.bestS * sum.sampleHz)}
                  alt=""
                />
              {/if}
            </div>
            <div class="row-main">
              <span class="name">{a.name}</span>
              <span class="muted small tabular">{st ? `${st.count} ${st.count === 1 ? 'hold' : 'holds'} · ${shortDate(st.latestDate)}` : 'No holds yet'}</span>
            </div>
          </button>
        {/each}
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

  .import {
    align-self: stretch;
    min-height: 52px;
    font-size: var(--text-l);
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
    background: var(--color-surface);
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
    margin: var(--space-4) 0 var(--space-1);
  }

  .empty {
    padding: var(--space-5) 0;
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 60px;
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

  .chev {
    color: var(--color-text-3);
    font-size: var(--text-xl);
  }

  .thumb {
    flex: none;
    width: 72px;
    aspect-ratio: 16 / 9;
    border-radius: var(--radius-s);
    overflow: hidden;
    background: var(--color-neutral-tint);
    display: flex;
    align-items: center;
  }

  .empty-asana {
    opacity: 0.45;
  }

  .error {
    color: var(--color-danger);
  }
</style>
