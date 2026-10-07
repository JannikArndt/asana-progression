<script lang="ts">
  import { app } from '../state/app.svelte';
  import { router } from '../state/router.svelte';
  import { importFiles } from '../import.svelte';
  import { pipeline } from '../pipeline/controller.svelte';
  import { formatDuration, formatTime } from '../components/timeline';

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

  function dateOf(iso: string | null): string {
    if (!iso) return 'Unknown date';
    const d = new Date(iso.length > 19 ? iso : iso + 'Z');
    if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
    return iso.slice(0, 10) + ' · ' + iso.slice(11, 16);
  }

  const interrupted = $derived(app.jobs.filter((j) => !(pipeline.running && pipeline.videoId === j.videoId)));
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

  <section class="list">
    <h2 class="section-title">Videos</h2>
    {#if app.ready && app.videos.length === 0}
      <p class="muted empty">No videos yet. Import a practice video to find the holds.</p>
    {/if}
    {#each app.videos as v (v.id)}
      {@const s = app.summaries[v.id]}
      <button class="row" type="button" onclick={() => router.go({ name: 'video', id: v.id })}>
        <div class="row-main">
          <span class="name">{v.fileName}</span>
          <span class="muted small tabular">{dateOf(v.recordedAt)} · {formatDuration(v.durationS)}</span>
        </div>
        <span class="count tabular" class:faint={!s}>{s ? `${s.candidates} holds` : 'not analysed'}</span>
      </button>
    {/each}
  </section>
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

  .small {
    font-size: var(--text-s);
  }

  .list {
    display: flex;
    flex-direction: column;
    margin-top: var(--space-3);
  }

  .list h2 {
    margin-bottom: var(--space-2);
  }

  .empty {
    padding: var(--space-5) 0;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
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
  }

  .name {
    font-weight: var(--weight-medium);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .count {
    flex: none;
    font-size: var(--text-s);
    color: var(--color-text-2);
  }

  .error {
    color: var(--color-danger);
  }
</style>
