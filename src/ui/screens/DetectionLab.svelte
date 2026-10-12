<script lang="ts">
  import type { DetectionParams } from '../../detection';
  import { parseGrid, type ScoreSummary } from '../../labeling';
  import { DEFAULT_LAB_GRID, gridText } from '../research/lab';
  import { isFullyLabeled } from '../research/export';
  import { app } from '../state/app.svelte';
  import { router } from '../state/router.svelte';
  import { research } from '../state/research.svelte';
  import { pipeline } from '../pipeline/controller.svelte';
  import { formatBytes, shareOrDownload } from '../diagnostics';
  import { formatDay } from '../format';

  /** The last grid text (a per-device convenience; the default grid when empty or unavailable). */
  const KEY = 'asana.lab.grid';
  const defaultText = gridText(DEFAULT_LAB_GRID);

  function stored(): string {
    try {
      return localStorage.getItem(KEY) || defaultText;
    } catch {
      return defaultText;
    }
  }

  let text = $state(stored());
  const parsed = $derived(parseGrid(text));

  $effect(() => {
    try {
      if (text === defaultText) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, text);
    } catch {
      /* private mode */
    }
  });

  /** Fully labeled videos (no open card, at least one labeled) and their sessions. */
  const eligible = $derived.by(() => {
    const videos = Object.values(app.summaries).filter((s) => isFullyLabeled(s));
    const sessions = new Set(videos.map((v) => app.sessions.find((s) => s.videoIds.includes(v.videoId))?.id).filter(Boolean));
    return { videos: videos.length, sessions: sessions.size };
  });

  const report = $derived(research.report);
  const top = $derived(report ? report.ranking.slice(0, 10).map((i) => report.combos[i]!) : []);
  const betterEverywhere = $derived(report ? report.loso.every((l) => l.chosen >= 0 && l.heldOutCost < l.defaultCost) : false);

  function sessionLabel(id: string): string {
    const s = app.sessions.find((x) => x.id === id);
    return s ? formatDay(s.date) : id;
  }

  function counts(s: ScoreSummary): string {
    return `missed ${s.missed} · split ${s.needSplit} · merge ${s.needMerge} · false ${s.falsePos}`;
  }

  function chips(diff: Partial<DetectionParams> | null): string[] {
    if (!diff) return [];
    const list = Object.entries(diff).map(([k, v]) => `${k} ${v}`);
    return list.length ? list : ['defaults'];
  }

  function run() {
    if ('combos' in parsed) void research.runLab(parsed.grid);
  }
</script>

<main class="lab">
  <header class="top">
    <button class="btn quiet" type="button" onclick={() => router.go({ name: 'settings' })}>‹ Settings</button>
  </header>
  <h2>Detection lab</h2>
  <p class="small muted">
    Runs hold finding with every combination of the values below on the stored analysis frames of every fully labeled video (no open
    card) and counts the review edits each would need: 2 per missed hold, 1 per split, merge and "Not a pose". Nothing is changed.
  </p>
  <p class="small">
    {eligible.videos} fully labeled video{eligible.videos === 1 ? '' : 's'} in {eligible.sessions} session{eligible.sessions === 1 ? '' : 's'}.
  </p>

  <label class="grid-label" for="lab-grid">Parameter grid (JSON: <span class="mono">base</span> on top of the defaults, every combination of <span class="mono">vary</span>)</label>
  <textarea id="lab-grid" class="grid mono" bind:value={text} spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off" rows="12"></textarea>
  <p class="small" class:error={'error' in parsed} class:muted={!('error' in parsed)} aria-live="polite">
    {'error' in parsed ? parsed.error : `${parsed.combos.length} parameter set${parsed.combos.length === 1 ? '' : 's'}`}
  </p>
  <div class="actions">
    {#if research.labRunning}
      <button class="btn" type="button" onclick={() => research.cancel()}>Cancel</button>
    {:else}
      <button class="btn primary" type="button" onclick={run} disabled={'error' in parsed || research.busy || pipeline.running || eligible.videos === 0}>Run</button>
    {/if}
    <button class="btn quiet" type="button" onclick={() => (text = defaultText)} disabled={text === defaultText || !!research.labRunning}>Reset grid</button>
  </div>
  {#if research.labRunning}
    {@const p = research.labRunning}
    <p class="small muted" role="status">Video {Math.min(p.video + 1, p.videos)} of {p.videos} · set {p.combo} of {p.combos}</p>
  {/if}
  {#if research.error?.kind === 'lab'}<p class="small error" role="alert">{research.error.message}</p>{/if}

  {#if report}
    <section class="group" aria-labelledby="lab-results">
      <h3 class="section-title" id="lab-results">Best {top.length} of {report.combos.length}</h3>
      <ol class="rows">
        <li class="row reference">
          <span class="rank">–</span>
          <span class="cost tabular">{report.reference.total.editCost}</span>
          <span class="detail">
            <span class="small">{counts(report.reference.total)}</span>
            <span class="chips"><span class="chip">current defaults</span></span>
          </span>
        </li>
        {#each top as c, i (c.index)}
          <li class="row">
            <span class="rank tabular">{i + 1}</span>
            <span class="cost tabular">{c.total.editCost}</span>
            <span class="detail">
              <span class="small">{counts(c.total)}</span>
              <span class="chips">{#each chips(c.diff) as chip (chip)}<span class="chip">{chip}</span>{/each}</span>
            </span>
          </li>
        {/each}
      </ol>
      {#if report.skipped.length}
        <p class="small muted">Skipped {report.skipped.length} video{report.skipped.length === 1 ? '' : 's'}: {report.skipped[0]!.reason}</p>
      {/if}
    </section>

    {#if report.sessions.length > 1}
      <section class="group" aria-labelledby="lab-loso">
        <h3 class="section-title" id="lab-loso">Held-out sessions</h3>
        <p class="small muted">For each session, the set that is best on the other sessions, and its edits on this one.</p>
        <ul class="rows">
          {#each report.loso as l (l.session)}
            <li class="row">
              <span class="detail">
                <span class="small">{sessionLabel(l.session)}: {l.heldOutCost} edits (defaults {l.defaultCost})</span>
                <span class="chips">{#each chips(l.diff) as chip (chip)}<span class="chip">{chip}</span>{/each}</span>
              </span>
            </li>
          {/each}
        </ul>
        <p class="small">{betterEverywhere ? 'Fewer edits than the defaults in every held-out session.' : 'Not better than the defaults in every held-out session.'}</p>
      </section>
    {/if}

    <div class="actions">
      <button class="btn" type="button" onclick={() => research.prepareReport()}>Export results</button>
    </div>
    {#if research.ready?.kind === 'lab'}
      {@const r = research.ready}
      <div class="ready" role="status">
        <p class="small">Results ready: {r.file.name}, {formatBytes(r.file.size)} ({r.note}).</p>
        <div class="actions">
          <button class="btn primary" type="button" onclick={() => shareOrDownload(r.file.name, r.file)}>Save</button>
        </div>
      </div>
    {/if}
  {/if}
</main>

<style>
  .lab {
    padding: calc(var(--space-2) + var(--safe-top)) calc(var(--space-4) + var(--safe-right)) calc(var(--space-7) + var(--safe-bottom))
      calc(var(--space-4) + var(--safe-left));
    max-width: 720px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .top {
    margin: 0 calc(-1 * var(--space-3));
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }

  p {
    margin: 0;
  }

  .small {
    font-size: var(--text-s);
  }

  .error {
    color: var(--color-danger);
  }

  .grid-label {
    font-size: var(--text-s);
    color: var(--color-text-2);
  }

  .grid {
    width: 100%;
    box-sizing: border-box;
    padding: var(--space-3);
    border: 1px solid var(--color-hairline);
    border-radius: var(--radius-s);
    background: var(--color-surface);
    color: var(--color-text);
    font-family: var(--font-mono);
    font-size: 16px; /* prevents iOS zoom on focus */
    line-height: var(--leading);
    white-space: pre;
    overflow-x: auto;
    resize: vertical;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .row {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--color-hairline);
  }

  .row.reference {
    color: var(--color-text-2);
  }

  .rank {
    flex: none;
    width: 1.5em;
    color: var(--color-text-3);
    font-size: var(--text-s);
  }

  .cost {
    flex: none;
    min-width: 2.5em;
    font-size: var(--text-l);
    font-weight: var(--weight-semibold);
  }

  .detail {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .chip {
    padding: 2px var(--space-2);
    border-radius: var(--radius-pill);
    background: var(--color-neutral-tint);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    overflow-wrap: anywhere;
  }

  .ready {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border-radius: var(--radius-m);
    background: var(--color-accent-tint);
  }
</style>
