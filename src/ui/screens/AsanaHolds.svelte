<script lang="ts">
  import TinyFrame from '../components/TinyFrame.svelte';
  import { app } from '../state/app.svelte';
  import { router } from '../state/router.svelte';
  import { formatTime } from '../components/timeline';

  interface Props {
    id: string;
  }
  let { id }: Props = $props();

  let side = $state<'R' | 'L' | 'both'>('both');
  const asana = $derived(app.asanas.find((a) => a.id === id));
  const dateOf = $derived(new Map(app.sessions.map((s) => [s.id, s.date])));
  const holds = $derived(
    app.holds
      .filter((h) => h.asanaId === id && (side === 'both' || h.side === side))
      .sort((a, b) => (dateOf.get(b.sessionId) ?? '').localeCompare(dateOf.get(a.sessionId) ?? '') || b.bestS - a.bestS),
  );

  function date(iso: string | undefined): string {
    if (!iso) return '';
    const d = new Date(iso.slice(0, 10) + 'T12:00:00Z');
    return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
</script>

<main class="asana">
  <header class="top">
    <button class="btn quiet" type="button" onclick={() => router.go({ name: 'home', tab: 'asanas' })}>‹ Asanas</button>
  </header>
  {#if asana}
    <div class="title">
      <h2>{asana.name}</h2>
      <p class="muted small">{asana.group ?? ''} · {holds.length} {holds.length === 1 ? 'hold' : 'holds'}</p>
    </div>
    {#if asana.sided}
      <div class="segmented" role="radiogroup" aria-label="Side">
        {#each [['both', 'Both'], ['R', 'Right'], ['L', 'Left']] as const as [value, text] (value)}
          <button type="button" role="radio" aria-checked={side === value} class:on={side === value} onclick={() => (side = value)}>{text}</button>
        {/each}
      </div>
    {/if}
    <div class="grid">
      {#each holds as h (h.id)}
        {@const sum = app.summaries[h.videoId]}
        <button class="tile" type="button" onclick={() => router.go({ name: 'session', id: h.sessionId })}>
          {#if sum}
            <TinyFrame videoId={h.videoId} frameWidth={sum.frameWidth} frameHeight={sum.frameHeight} index={Math.round(h.bestS * sum.sampleHz)} alt="{asana.name} {date(dateOf.get(h.sessionId))}" />
          {/if}
          <span class="caption tabular">{date(dateOf.get(h.sessionId))}{h.side ? ` · ${h.side}` : ''} · {formatTime(h.bestS)}</span>
        </button>
      {:else}
        <p class="muted">No holds labeled yet.</p>
      {/each}
    </div>
    <p class="faint small">Full progression view (stills, viewer, flipbook) comes with milestone 4.</p>
  {:else if app.ready}
    <p class="muted">Unknown asana.</p>
  {/if}
</main>

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

  .segmented {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    padding: 2px;
    border-radius: var(--radius-m);
    background: var(--color-neutral-tint);
  }

  .segmented button {
    min-height: 40px;
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

  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }

  .tile {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: 0;
    border: 0;
    background: transparent;
    text-align: left;
  }

  .caption {
    font-size: var(--text-xs);
    color: var(--color-text-2);
  }
</style>
