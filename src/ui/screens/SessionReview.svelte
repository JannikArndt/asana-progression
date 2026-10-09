<script lang="ts">
  import { tick } from 'svelte';
  import TimelineGraph from '../components/TimelineGraph.svelte';
  import ReviewCard from '../components/ReviewCard.svelte';
  import LabelPicker from '../components/LabelPicker.svelte';
  import FrameScrubber from '../components/FrameScrubber.svelte';
  import FrameProbe from '../components/FrameProbe.svelte';
  import CropEditor from '../components/CropEditor.svelte';
  import DebugPanel from '../components/DebugPanel.svelte';
  import { formatDuration, formatTime, previewTimes, type Span } from '../components/timeline';
  import { expectedHolds, nextEntries, type Label } from '../../labeling';
  import { PRIMARY_SERIES_ID } from '../../model';
  import { holdReps } from '../../progression';
  import { app } from '../state/app.svelte';
  import { pipeline } from '../pipeline/controller.svelte';
  import { importQueue } from '../import.svelte';
  import { router } from '../state/router.svelte';
  import { dialog } from '../state/dialog.svelte';
  import { SessionReview } from '../state/review.svelte';
  import type { SessionEntry } from '../state/session-data';
  import { capture } from '../state/capture.svelte';
  import { setManualCrop } from '../state/hold-actions';
  import { fingerprint, openVideo } from '../../source';

  interface Props {
    id: string;
  }
  let { id }: Props = $props();

  const review = new SessionReview();
  let selectedKey = $state<string | null>(null);
  let pickerKey = $state<string | null>(null);
  let scrub = $state<{ mode: 'nudge' | 'split' | 'add'; videoId: string; key?: string } | null>(null);
  let probe = $state<{ videoId: string; t: number } | null>(null);
  let cropHoldId = $state<string | null>(null);
  const cropHold = $derived(cropHoldId ? app.holds.find((h) => h.id === cropHoldId) : undefined);
  const cropStill = $derived(cropHoldId ? app.assets.find((a) => a.holdId === cropHoldId && a.kind === 'still') : undefined);
  let graphOpen = $state(true);
  let debugOpen = $state<Record<string, boolean>>({});

  $effect(() => {
    if (app.ready) void review.load(id);
  });

  const names = $derived(new Map(app.asanas.map((a) => [a.id, a.name])));
  /** Rep numbers of labeled holds (consecutive holds with the same label). */
  const reps = $derived(review.session ? holdReps(review.holds, [review.session]) : new Map());
  const nameOf = (asanaId: string) => names.get(asanaId) ?? asanaId;
  const counts = $derived({
    labeled: review.entries.filter((e) => e.candidate.status === 'labeled').length,
    open: review.entries.filter((e) => e.candidate.status === 'open').length,
  });
  const duration = $derived(review.videos.reduce((s, v) => s + v.durationS, 0));

  function spansFor(videoId: string): Span[] {
    return review.entries
      .filter((e) => e.videoId === videoId)
      .map((e) => ({
        id: e.key,
        startS: e.candidate.startS,
        endS: e.candidate.endS,
        bestS: e.candidate.bestS,
        alternatesS: e.candidate.alternatesS,
        status: e.candidate.status === 'labeled' && e.hold ? 'labeled' : e.candidate.status === 'dismissed' ? 'dismissed' : 'open',
        ...(e.hold ? { label: `${nameOf(e.hold.asanaId)}${e.hold.side ? ` ${e.hold.side}` : ''}` } : {}),
      }));
  }

  function frameOf(videoId: string) {
    const a = review.analyses[videoId];
    return { width: a?.frameWidth ?? 80, height: a?.frameHeight ?? 45, hz: a?.sampleHz ?? 4 };
  }

  async function selectFromGraph(key: string) {
    selectedKey = key;
    await tick();
    document.getElementById(`card-${key}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function dateTitle(iso: string | undefined): string {
    if (!iso) return '';
    const d = new Date(iso.slice(0, 10) + 'T12:00:00Z');
    if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
    return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }

  async function more(entry: SessionEntry) {
    const prev = review.previousOf(entry.key);
    const hasFile = app.files.has(entry.videoId);
    const hasStill = !!entry.hold && app.assets.some((a) => a.holdId === entry.hold!.id && a.kind === 'still');
    const f = frameOf(entry.videoId);
    const choice = await dialog.ask({
      title: `Hold at ${Math.floor(entry.candidate.startS / 60)}:${String(Math.floor(entry.candidate.startS % 60)).padStart(2, '0')}`,
      frames: {
        videoId: entry.videoId,
        width: f.width,
        height: f.height,
        items: previewTimes(entry.candidate.startS, entry.candidate.endS).map((t) => ({ index: Math.floor(t * f.hz), label: formatTime(t) })),
      },
      options: [
        { id: 'label', label: 'Choose label…' },
        ...(hasStill ? [{ id: 'crop', label: 'Edit crop…' }] : []),
        { id: 'nudge', label: 'Choose frame…' },
        { id: 'split', label: 'Split…' },
        { id: 'splitk', label: 'Split into several…' },
        ...(prev ? [{ id: 'merge', label: 'Merge with previous' }] : []),
        ...(entry.candidate.status !== 'dismissed' ? [{ id: 'dismiss', label: 'Not a pose', kind: 'danger' as const }] : []),
        ...(hasFile ? [{ id: 'probe', label: 'Full-resolution frame' }] : []),
        { id: 'cancel', label: 'Cancel', kind: 'quiet' },
      ],
    });
    switch (choice) {
      case 'label':
        pickerKey = entry.key;
        break;
      case 'crop':
        cropHoldId = entry.hold?.id ?? null;
        break;
      case 'nudge':
        scrub = { mode: 'nudge', videoId: entry.videoId, key: entry.key };
        break;
      case 'split':
        scrub = { mode: 'split', videoId: entry.videoId, key: entry.key };
        break;
      case 'splitk':
        await askSplitInto(entry);
        break;
      case 'merge':
        await review.mergeWithPrevious(entry.key);
        break;
      case 'dismiss':
        await review.dismiss(entry.key);
        break;
      case 'probe':
        probe = { videoId: entry.videoId, t: entry.candidate.bestS };
        break;
    }
  }

  /** Holds the template expects in place of an open card (when it is more than one). */
  function expectedAt(entry: SessionEntry): number | undefined {
    if (entry.candidate.status !== 'open') return undefined;
    const k = expectedHolds(review.items, entry.key, review.template);
    return k !== undefined && k >= 2 ? k : undefined;
  }

  async function askSplitInto(entry: SessionEntry) {
    const expected = expectedHolds(review.items, entry.key, review.template);
    const merged = entry.candidate.alternatesS.length + 1;
    const max = Math.min(12, Math.max(6, expected ?? 0, merged));
    const choice = await dialog.ask({
      title: 'Split into how many holds?',
      message: 'Cuts go to the clearest posture changes. You can merge or split again afterwards.',
      options: [
        ...Array.from({ length: max - 1 }, (_, i) => i + 2).map((k) => ({
          id: String(k),
          label: `${k} holds`,
          ...(k === expected ? { kind: 'primary' as const, detail: 'Expected by the template' } : k === merged ? { detail: 'Merged by detection' } : {}),
        })),
        { id: 'cancel', label: 'Cancel', kind: 'quiet' },
      ],
    });
    const k = Number(choice);
    if (Number.isInteger(k) && k >= 2) await review.splitInto(entry.key, k);
  }

  async function pick(label: Label) {
    const key = pickerKey;
    pickerKey = null;
    if (key) await review.confirm(key, label);
  }

  async function onScrub(t: number) {
    const s = scrub;
    scrub = null;
    if (!s) return;
    if (s.mode === 'nudge' && s.key) await review.nudge(s.key, t);
    else if (s.mode === 'split' && s.key) await review.split(s.key, t);
    else if (s.mode === 'add') {
      const key = await review.addMissed(s.videoId, t);
      if (key) void selectFromGraph(key);
    }
  }

  const waiting = $derived(capture.waitingForFile(review.holds));
  let attachError = $state<string | null>(null);

  async function reattach(e: Event, videoId: string, fp: string) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    attachError = null;
    try {
      const src = await openVideo(file);
      const ok = (await fingerprint(file, src.meta.durationS)) === fp;
      src.close();
      if (!ok) {
        attachError = 'That is a different video.';
        return;
      }
      app.attachFile(videoId, file);
      review.recapture(videoId);
    } catch (err) {
      attachError = `Cannot read the file: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  const scrubEntry = $derived(scrub?.key ? review.entry(scrub.key) : undefined);
  const pickerEntry = $derived(pickerKey ? review.entry(pickerKey) : undefined);
  const sessionLabels = $derived(review.items.filter((i) => i.status === 'labeled' && i.label).map((i) => i.label!));
</script>

<main class="review-screen">
  <header class="top">
    <button class="btn quiet" type="button" onclick={() => router.go({ name: 'home', tab: 'sessions' })}>‹ Sessions</button>
  </header>

  {#if review.loaded && !review.session}
    <p class="muted">This session no longer exists.</p>
  {:else if review.session}
    {@const session = review.session}
    <div class="title">
      <h2>{dateTitle(session.date)}</h2>
      <p class="muted small tabular">
        {formatDuration(duration)} · {counts.labeled} labeled{counts.open ? ` · ${counts.open} open` : ''}
      </p>
    </div>

    {#if review.combinable.length && !pipeline.running && importQueue.total === 0}
      <div class="card notice">
        <p class="small">
          {review.sameDay.length} other {review.sameDay.length === 1 ? 'session was' : 'sessions were'} recorded on this day.
        </p>
        <button class="btn" type="button" onclick={() => review.combineSameDay()} disabled={review.combining}>Combine into this session…</button>
      </div>
    {/if}

    <div class="controls">
      <div class="segmented" role="radiogroup" aria-label="Suggestions">
        <button type="button" role="radio" aria-checked={session.templateId === PRIMARY_SERIES_ID} class:on={session.templateId === PRIMARY_SERIES_ID} onclick={() => review.setTemplate(PRIMARY_SERIES_ID)}>Primary series</button>
        <button type="button" role="radio" aria-checked={!session.templateId} class:on={!session.templateId} onclick={() => review.setTemplate(null)}>No template</button>
      </div>
      <input
        class="note"
        type="text"
        placeholder="Note"
        value={session.note}
        onchange={(e) => review.setNote(e.currentTarget.value)}
      />
    </div>

    {#each review.videos as video (video.id)}
      {@const analysis = review.analyses[video.id]}
      {@const entries = review.entries.filter((e) => e.videoId === video.id)}
      <section class="video">
        {#if review.videos.length > 1}<h3 class="section-title">{video.fileName}</h3>{/if}
        {#if waiting.has(video.id)}
          <div class="card notice">
            <p class="small">Select <strong>{video.fileName}</strong> again to save full-resolution stills and clips of the labeled holds.</p>
            <label class="btn">
              Select video
              <input class="visually-hidden" type="file" accept="video/*" onchange={(e) => reattach(e, video.id, video.fingerprint)} />
            </label>
            {#if attachError}<p class="small error">{attachError}</p>{/if}
          </div>
        {/if}
        {#if analysis}
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
                threshold={analysis.threshold}
                spans={spansFor(video.id)}
                selectedId={selectedKey}
                onselect={selectFromGraph}
              />
            </div>
          {/if}

          <div class="cards">
            {#each entries as entry, i (entry.key)}
              <ReviewCard
                {entry}
                number={i + 1}
                suggestion={review.suggestions[entry.key]?.[0]}
                {nameOf}
                frame={frameOf(video.id)}
                selected={selectedKey === entry.key}
                thumb={entry.hold ? app.assets.find((a) => a.holdId === entry.hold!.id && a.kind === 'thumb') : undefined}
                captureStatus={entry.hold ? capture.status[entry.hold.id] : undefined}
                rep={entry.hold ? reps.get(entry.hold.id) : undefined}
                expected={expectedAt(entry)}
                onsplit={(k) => review.splitInto(entry.key, k)}
                onselect={() => (selectedKey = entry.key)}
                onconfirm={() => review.confirm(entry.key)}
                onpick={() => (pickerKey = entry.key)}
                onmore={() => more(entry)}
                onrestore={() => review.restore(entry.key)}
              />
            {:else}
              <p class="muted">No holds found in this video. Add one by hand below.</p>
            {/each}
          </div>
          <button class="btn add" type="button" onclick={() => (scrub = { mode: 'add', videoId: video.id })}>+ Add missed hold</button>
        {:else}
          <p class="muted">{video.fileName} is not analysed yet. Import the file again to process it.</p>
        {/if}

        <button
          class="disclosure"
          type="button"
          aria-expanded={!!debugOpen[video.id]}
          onclick={() => (debugOpen = { ...debugOpen, [video.id]: !debugOpen[video.id] })}
        >
          <span class="section-title">Debug{review.videos.length > 1 ? ` · ${video.fileName}` : ''}</span>
          <span class="chev" class:open={debugOpen[video.id]}>›</span>
        </button>
        {#if debugOpen[video.id]}
          <DebugPanel
            {video}
            analysis={analysis ?? null}
            rerun={(p, onProgress) => review.rerun(video.id, p, onProgress)}
            onchanged={() => review.load(id)}
          />
        {/if}
      </section>
    {/each}
  {/if}
</main>

{#if pickerEntry && review.session}
  <LabelPicker
    catalog={app.asanas}
    suggestions={review.suggestions[pickerEntry.key] ?? []}
    next={nextEntries(review.items, pickerEntry.key, review.template, app.asanas)}
    {sessionLabels}
    template={review.template}
    onpick={pick}
    onclose={() => (pickerKey = null)}
  />
{/if}

{#if scrub}
  {@const f = frameOf(scrub.videoId)}
  {@const v = review.videos.find((x) => x.id === scrub!.videoId)}
  {#if scrub.mode === 'add'}
    <FrameScrubber
      title="Add missed hold"
      confirmLabel="Add hold here"
      videoId={scrub.videoId}
      frameWidth={f.width}
      frameHeight={f.height}
      sampleHz={f.hz}
      fromS={0}
      toS={v?.durationS ?? 0}
      valueS={(v?.durationS ?? 0) / 2}
      onconfirm={onScrub}
      onclose={() => (scrub = null)}
    />
  {:else if scrubEntry}
    <FrameScrubber
      title={scrub.mode === 'nudge' ? 'Choose frame' : 'Split hold'}
      confirmLabel={scrub.mode === 'nudge' ? 'Use this frame' : 'Split here'}
      videoId={scrub.videoId}
      frameWidth={f.width}
      frameHeight={f.height}
      sampleHz={f.hz}
      fromS={scrubEntry.candidate.startS}
      toS={scrubEntry.candidate.endS}
      valueS={scrub.mode === 'nudge' ? scrubEntry.candidate.bestS : (scrubEntry.candidate.startS + scrubEntry.candidate.endS) / 2}
      marks={scrub.mode === 'nudge' ? scrubEntry.candidate.alternatesS : []}
      onconfirm={onScrub}
      onclose={() => (scrub = null)}
    />
  {/if}
{/if}

{#if probe}
  <FrameProbe videoId={probe.videoId} timestampS={probe.t} onclose={() => (probe = null)} />
{/if}

{#if cropHold && cropStill}
  <CropEditor
    hold={cropHold}
    still={cropStill}
    title={nameOf(cropHold.asanaId)}
    onsave={async (m) => {
      const id = cropHoldId!;
      cropHoldId = null;
      await setManualCrop(id, m);
    }}
    onclose={() => (cropHoldId = null)}
  />
{/if}

<style>
  .review-screen {
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

  .notice {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
  }

  .notice .btn {
    align-self: flex-start;
  }

  .error {
    color: var(--color-danger);
  }

  .controls {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .segmented {
    display: grid;
    grid-template-columns: 1fr 1fr;
    padding: 2px;
    border-radius: var(--radius-m);
    background: var(--color-neutral-tint);
  }

  .segmented button {
    min-height: 40px;
    border: 0;
    border-radius: calc(var(--radius-m) - 2px);
    background: transparent;
    font-size: var(--text-s);
    font-weight: var(--weight-medium);
    color: var(--color-text-2);
  }

  .segmented button.on {
    background: var(--color-surface);
    color: var(--color-text);
  }

  .note {
    min-height: var(--touch);
    padding: 0 var(--space-3);
    border: 1px solid var(--color-hairline);
    border-radius: var(--radius-m);
    background: var(--color-surface);
    font-size: 16px;
  }

  .video {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
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

  .add {
    align-self: flex-start;
  }
</style>
