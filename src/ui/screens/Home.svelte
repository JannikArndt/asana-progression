<script lang="ts">
  import TinyFrame from '../components/TinyFrame.svelte';
  import LazyAsset from '../components/LazyAsset.svelte';
  import SessionStrip, { type StripItem } from '../components/SessionStrip.svelte';
  import { app } from '../state/app.svelte';
  import { router } from '../state/router.svelte';
  import { server } from '../state/server.svelte';
  import { importFiles } from '../import.svelte';
  import { pipeline } from '../pipeline/controller.svelte';
  import { formatDuration, formatTime } from '../components/timeline';
  import { formatDay, formatShortDay, localDay } from '../format';
  import {
    familyPicks,
    familyStats,
    placeLabel,
    restoreSelection,
    SELECTION_DAY_KEY,
    selectionKey,
    sessionPreview,
    sessionsByTime,
    sessionTinyFrame,
    summarizeSession,
    type PhotoSelection,
  } from '../state/session-data';
  import { displayCrop, fillCrop } from '../../progression';
  import {
    asanaFamilies,
    familyLetter,
    INTERMEDIATE_SERIES_ID,
    PRIMARY_SERIES_ID,
    type AsanaFamily,
    type Asset,
    type Hold,
    type Session,
  } from '../../model';

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

  // Which session's photos the tiles show (the strip): remembered for the day, then Latest again.
  function readStored(): string | null {
    try {
      return localStorage.getItem(SELECTION_DAY_KEY);
    } catch {
      return null;
    }
  }
  const stored = readStored();
  let chosen = $state<PhotoSelection | null>(null);
  const selection = $derived.by((): PhotoSelection => {
    const c = chosen ?? restoreSelection(stored, localDay(), app.sessions);
    return typeof c !== 'string' && !app.sessions.some((s) => s.id === c.sessionId) ? 'latest' : c;
  });
  const selKey = $derived(selectionKey(selection));
  const selSession = $derived(typeof selection === 'string' ? undefined : app.sessions.find((s) => s.id === selection.sessionId));
  const sessionById = $derived(new Map(app.sessions.map((s) => [s.id, s])));
  const stripItems = $derived<StripItem[]>([
    { key: 'first', label: 'First photo of each asana', text: 'First' },
    ...sessionsByTime(app.sessions).map((s) => ({ key: s.id, label: formatDay(s.date, true), session: s })),
    { key: 'latest', label: 'Latest photo of each asana', text: 'Latest' },
  ]);
  const picks = $derived(familyPicks(families, app.sessions, app.holds, captured, selection));
  const selSummary = $derived(selSession ? summarizeSession(selSession, app.videos, app.summaries) : undefined);
  const selTemplate = $derived(selSession?.templateId ? app.templates.find((t) => t.id === selSession.templateId) : undefined);

  function choose(key: string) {
    const sel: PhotoSelection = key === 'first' || key === 'latest' ? key : { sessionId: key };
    chosen = sel;
    try {
      localStorage.setItem(SELECTION_DAY_KEY, JSON.stringify({ sel, day: localDay() }));
    } catch {
      // Private mode: the choice lasts for this page.
    }
  }

  function step(by: number) {
    const i = stripItems.findIndex((x) => x.key === selKey) + by;
    if (i >= 0 && i < stripItems.length) choose(stripItems[i]!.key);
  }

  function openSession(s: Session) {
    router.go({ name: s.complete ? 'session-poses' : 'session', id: s.id });
  }

  function showList(show: boolean) {
    router.go({ name: 'home', tab: show ? 'sessions' : 'asanas' }, true);
    if (!show) window.scrollTo({ top: 0 });
  }

  /** Short mark of a session's template: I = Primary, II = Intermediate, else its initial. */
  function seriesMark(id: string | undefined, name: string): string {
    return id === PRIMARY_SERIES_ID ? 'I' : id === INTERMEDIATE_SERIES_ID ? 'II' : (name.trim()[0] ?? '?').toUpperCase();
  }

  // Once the strip scrolls under the header, it folds into the toolbar ("‹ 12 Nov ›"); tapping the date drops it down again.
  let pickerEl = $state<HTMLElement>();
  let headerEl = $state<HTMLElement>();
  let folded = $state(false);
  let peek = $state(false);
  $effect(() => {
    if (!pickerEl || !headerEl) return;
    const io = new IntersectionObserver(
      ([e]) => {
        folded = !e!.isIntersecting;
        if (!folded) peek = false;
      },
      { rootMargin: `-${Math.round(headerEl.getBoundingClientRect().bottom)}px 0px 0px 0px` },
    );
    io.observe(pickerEl);
    return () => io.disconnect();
  });
  $effect(() => {
    if (!peek) return;
    const from = window.scrollY;
    const onScroll = () => {
      if (Math.abs(window.scrollY - from) > 40) peek = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') peek = false;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('keydown', onKey);
    };
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

{#snippet sessionThumb(s: Session)}
  {@const preview = sessionPreview(s, app.holds, captured)}
  {@const img = preview ? images.get(preview.id) : undefined}
  <!-- The whole frame, centred: place and light make a session recognizable, not the body crop. -->
  {#if img}
    <LazyAsset asset={img} crop={fillCrop(null, img.width, img.height, 1)} aspect={1} alt="">
      {#snippet fallback()}{@render sessionTiny(s)}{/snippet}
    </LazyAsset>
  {:else}
    {@render sessionTiny(s)}
  {/if}
{/snippet}

{#snippet selectionInfo()}
  <div class="sel-info">
    <p class="sel-text">
      {#if selSession}
        <span class="when">{formatDay(selSession.date, true)}</span>
        {#if selTemplate}<span class="series" title={selTemplate.name} aria-label={selTemplate.name}>{seriesMark(selTemplate.id, selTemplate.name)}</span>{/if}
        <span class="muted small tabular">{selSummary?.labeled ?? 0} labeled</span>
      {:else}
        <span class="muted small">{selection === 'first' ? 'Each asana’s first photo' : 'Each asana’s newest photo'}</span>
      {/if}
    </p>
    {#if selSession}
      {@const s = selSession}
      <button class="mini" type="button" aria-label="Open session" onclick={() => openSession(s)}>Open ›</button>
    {/if}
    <button class="mini" type="button" aria-label="All sessions" aria-expanded={tab === 'sessions'} onclick={() => showList(tab !== 'sessions')}>
      All <span class="chev-mini" class:up={tab === 'sessions'} aria-hidden="true">›</span>
    </button>
  </div>
{/snippet}

<main class="home">
  <header class="top" bind:this={headerEl}>
    <h1>Asanas</h1>
    {#if folded && tab === 'asanas' && app.sessions.length}
      <div class="pill">
        <button type="button" class="pill-step" aria-label="Earlier" disabled={stripItems[0]?.key === selKey} onclick={() => step(-1)}>‹</button>
        <button type="button" class="pill-date" aria-expanded={peek} aria-label="Show photos from: {selSession ? formatDay(selSession.date) : selection === 'first' ? 'First' : 'Latest'}" onclick={() => (peek = !peek)}>
          {selSession ? formatShortDay(selSession.date) : selection === 'first' ? 'First' : 'Latest'}
        </button>
        <button type="button" class="pill-step" aria-label="Later" disabled={stripItems.at(-1)?.key === selKey} onclick={() => step(1)}>›</button>
      </div>
    {/if}
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
    {#if peek && folded}
      <div class="peek">
        <SessionStrip items={stripItems} selected={selKey} onselect={choose} thumb={sessionThumb} />
        {@render selectionInfo()}
      </div>
    {/if}
  </header>
  {#if server.mode === 'legacy'}
    <button type="button" class="moved" onclick={() => router.go({ name: 'settings' })}>
      This app moved to asana.jannikarndt.de. <strong>Move your data ›</strong>
    </button>
  {/if}

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

  {#if app.sessions.length}
    <section class="picker" bind:this={pickerEl} aria-label="Photos">
      <SessionStrip items={stripItems} selected={selKey} onselect={choose} thumb={sessionThumb} />
      {@render selectionInfo()}
    </section>
  {/if}

  {#if tab === 'sessions'}
    <section class="list" aria-label="Sessions">
      {#if app.ready && app.sessions.length === 0}
        <p class="muted empty">No sessions yet. Import a practice video with + (top right) to find the holds.</p>
      {/if}
      {#each app.sessions as s (s.id)}
        {@const sum = summarizeSession(s, app.videos, app.summaries)}
        {@const template = s.templateId ? app.templates.find((t) => t.id === s.templateId) : undefined}
        {@const extra = [placeLabel(s), s.note].filter(Boolean).join(' · ')}
        <div class="row session" class:on={s.id === selKey}>
          <button
            class="pick"
            type="button"
            aria-pressed={s.id === selKey}
            onclick={() => {
              choose(s.id);
              showList(false);
            }}
          >
            <div class="thumb">{@render sessionThumb(s)}</div>
            <div class="row-main">
              <span class="name">{formatDay(s.date, true)}</span>
              <span class="muted small tabular line">
                {formatDuration(sum.durationS)} · {sum.labeled} labeled{sum.open ? ` · ${sum.open} open` : ''}{template ? ` · ${template.name}` : ''}
              </span>
              {#if extra}<span class="muted small line">{extra}</span>{/if}
            </div>
          </button>
          <button class="open" type="button" aria-label="Open session" title="Open session" onclick={() => openSession(s)}>›</button>
        </div>
      {/each}
    </section>
  {:else}
    <section class="list" aria-label="Asanas">
      {#each groups as g (g.group)}
        <h2 class="section-title group">{g.group}</h2>
        <div class="tiles">
          {#each g.families as f (f.members[0]!.id)}
            {@const st = stats.get(f.members[0]!.id)}
            {@const pick = picks.get(f.members[0]!.id)}
            {@const from = pick ? sessionById.get(pick.sessionId) : undefined}
            <button class="tile asana" class:empty-asana={!st} class:elsewhere={pick && !pick.inSelection} type="button" onclick={() => openFamily(f)}>
              <div class="tile-img">
                {#if pick}
                  {@const hold = pick.hold}
                  {@const img = images.get(hold.id)}
                  {#if img}
                    <LazyAsset asset={img} crop={fillCrop(displayCrop(hold), img.width, img.height, 1)} aspect={1} alt="">
                      {#snippet fallback()}{@render tiny(hold)}{/snippet}
                    </LazyAsset>
                  {:else}
                    {@render tiny(hold)}
                  {/if}
                  {#if from && (!pick.inSelection || typeof selection === 'string')}
                    <span class="badge">{formatShortDay(from.date)}</span>
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

  /* The session strip and its line: date, series mark, labeled count; Open and All squeezed on the right. */
  .picker {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0 calc(-1 * var(--space-4));
  }

  .sel-info {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-height: var(--touch);
    padding: 0 var(--space-2) 0 var(--space-4);
  }

  .sel-text {
    flex: 1;
    min-width: 0;
    margin: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    white-space: nowrap;
    overflow: hidden;
  }

  .when {
    font-weight: var(--weight-semibold);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .series {
    flex: none;
    min-width: 20px;
    height: 20px;
    padding: 0 4px;
    box-sizing: border-box;
    border-radius: 6px;
    border: 1px solid var(--color-accent);
    color: var(--color-accent-strong);
    font-family: Georgia, 'Times New Roman', serif;
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    line-height: 18px;
    text-align: center;
  }

  .mini {
    flex: none;
    min-height: var(--touch);
    padding: 0 var(--space-2);
    border: 0;
    background: transparent;
    color: var(--color-accent-strong);
    font: inherit;
    font-size: var(--text-s);
    font-weight: var(--weight-medium);
  }

  .chev-mini {
    display: inline-block;
    transform: rotate(90deg);
    transition: transform var(--duration-fast) var(--ease);
  }

  .chev-mini.up {
    transform: rotate(-90deg);
  }

  /* Folded strip in the toolbar. */
  .pill {
    display: flex;
    align-items: center;
    margin-left: auto;
    margin-right: var(--space-1);
    height: 34px;
    border-radius: var(--radius-pill);
    background: var(--color-accent-tint);
    color: var(--color-accent-strong);
  }

  .pill button {
    height: var(--touch);
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
  }

  .pill-step {
    width: 30px;
    font-size: var(--text-l);
  }

  .pill-step:disabled {
    opacity: 0.35;
  }

  .pill-date {
    min-width: 56px;
    padding: 0 2px;
    font-size: var(--text-s);
    font-weight: var(--weight-semibold);
    white-space: nowrap;
  }

  .peek {
    position: absolute;
    top: 100%;
    left: calc(-1 * var(--space-4) - var(--safe-left));
    right: calc(-1 * var(--space-4) - var(--safe-right));
    padding: 0 var(--safe-right) 0 var(--safe-left);
    background: var(--color-bg);
    border-bottom: 1px solid var(--color-hairline);
  }

  .badge {
    position: absolute;
    left: 6px;
    bottom: 6px;
    padding: 2px 7px;
    border-radius: var(--radius-pill);
    background: var(--color-glass);
    color: var(--color-on-photo);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
  }

  /* Not in the selected session: the latest photo at that time (else a later one), faded. */
  .tile.elsewhere .tile-img > :global(*:not(.badge)) {
    opacity: 0.4;
  }

  .tile.elsewhere .tile-img {
    background: var(--color-neutral-tint);
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
    position: relative;
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
    gap: var(--space-2);
    border-bottom: 1px solid var(--color-hairline);
  }

  .row .pick {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 64px;
    padding: var(--space-2) 0;
    border: 0;
    background: transparent;
    text-align: left;
    color: inherit;
    font: inherit;
  }

  .row.on .thumb {
    box-shadow:
      0 0 0 2px var(--color-bg),
      0 0 0 4px var(--color-accent);
  }

  .row .open {
    flex: none;
    width: var(--touch);
    height: var(--touch);
    border: 0;
    border-radius: var(--radius-pill);
    background: var(--color-neutral-tint);
    color: var(--color-text);
    font: inherit;
    font-size: var(--text-xl);
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
  .moved {
    display: block;
    width: 100%;
    text-align: left;
    margin: var(--space-2) 0;
    padding: var(--space-3);
    border: 1px solid var(--color-accent);
    border-radius: var(--radius-m);
    background: var(--color-accent-tint);
    color: inherit;
    font: inherit;
    font-size: var(--text-s);
  }
</style>
