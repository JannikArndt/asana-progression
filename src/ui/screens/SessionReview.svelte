<script lang="ts">
  import { onMount, tick } from 'svelte';
  import TimelineGraph from '../components/TimelineGraph.svelte';
  import TimelineOverview from '../components/TimelineOverview.svelte';
  import ReviewCard from '../components/ReviewCard.svelte';
  import LabelPicker from '../components/LabelPicker.svelte';
  import FrameScrubber from '../components/FrameScrubber.svelte';
  import FrameProbe from '../components/FrameProbe.svelte';
  import CropEditor from '../components/CropEditor.svelte';
  import DebugPanel from '../components/DebugPanel.svelte';
  import Sheet from '../components/Sheet.svelte';
  import { formatDuration, formatTime, previewTimes, type Span } from '../components/timeline';
  import { detailLength, firstBelow, followWindow, groupSegments, windowAround, type Range } from '../components/session-timeline';
  import { formatDay } from '../format';
  import { expectedHolds, nextEntries, type Label } from '../../labeling';
  import type { Video } from '../../model';
  import { holdReps } from '../../progression';
  import { app } from '../state/app.svelte';
  import { pipeline } from '../pipeline/controller.svelte';
  import { importQueue } from '../import.svelte';
  import { router } from '../state/router.svelte';
  import { dialog } from '../state/dialog.svelte';
  import { SessionReview } from '../state/review.svelte';
  import { coverageGaps, formatCoords, placeLabel, placeNames, sessionCoords, sessionSpanS, type CoverageGap, type SessionEntry } from '../state/session-data';
  import { capture } from '../state/capture.svelte';
  import { reattachVideo, setManualCrop } from '../state/hold-actions';

  interface Props {
    id: string;
  }
  let { id }: Props = $props();

  const review = new SessionReview();
  let selectedKey = $state<string | null>(null);
  let pickerKey = $state<string | null>(null);
  let scrub = $state<{ mode: 'nudge' | 'split' | 'add'; videoId: string; key?: string; gap?: CoverageGap } | null>(null);
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
  const groups = $derived(new Map(app.asanas.map((a) => [a.id, a.group])));
  /** Rep numbers of labeled holds (consecutive holds with the same label). */
  const reps = $derived(review.session ? holdReps(review.holds, [review.session]) : new Map());
  const nameOf = (asanaId: string) => names.get(asanaId) ?? asanaId;
  const counts = $derived({
    labeled: review.entries.filter((e) => e.candidate.status === 'labeled').length,
    open: review.entries.filter((e) => e.candidate.status === 'open').length,
  });
  const duration = $derived(review.session ? sessionSpanS(review.session, review.videos) : 0);

  // ----- template and place -----

  async function chooseTemplate() {
    const current = review.template?.id;
    const choice = await dialog.ask({
      title: 'Suggestions',
      message: 'The sequence that label suggestions follow in this session.',
      options: [
        ...app.templates.map((t) => ({ id: `t:${t.id}`, label: t.name, ...(t.id === current ? { kind: 'primary' as const, detail: 'Current' } : {}) })),
        { id: 'none', label: 'No template', detail: current ? 'Suggest by recent use.' : 'Current · suggest by recent use.', ...(current ? {} : { kind: 'primary' as const }) },
        { id: 'cancel', label: 'Cancel', kind: 'quiet' },
      ],
    });
    if (choice === 'none') await review.setTemplate(null);
    else if (choice.startsWith('t:') && choice.slice(2) !== current) await review.setTemplate(choice.slice(2));
  }

  /** Place name being edited (null = sheet closed). */
  let placeDraft = $state<string | null>(null);
  const coords = $derived(review.session ? sessionCoords(review.session) : null);
  const place = $derived(review.session ? placeLabel(review.session) : null);
  const placeChips = $derived(placeDraft !== null && review.session ? placeNames(app.sessions.filter((s) => s.id !== review.session!.id), coords).slice(0, 8) : []);
  const alsoNamed = $derived(placeDraft !== null && placeDraft.trim() ? review.unnamedNearby.length : 0);

  async function savePlace() {
    const name = placeDraft;
    placeDraft = null;
    if (name !== null) await review.setPlaceName(name);
  }

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

  /** Entries of one video, in time order (as `review.entries`). */
  const entriesByVideo = $derived.by(() => {
    const out = new Map<string, SessionEntry[]>();
    for (const e of review.entries) {
      const list = out.get(e.videoId) ?? [];
      list.push(e);
      out.set(e.videoId, list);
    }
    return out;
  });

  /** Uncovered stretches per video by the index of the card after them; dismissed candidates count as covered. */
  function gapsFor(video: Video): Map<number, CoverageGap> {
    const gaps = coverageGaps((entriesByVideo.get(video.id) ?? []).map((e) => e.candidate), video.durationS);
    return new Map(gaps.map((g) => [g.beforeIndex, g]));
  }

  function overviewOf(videoId: string) {
    const list = entriesByVideo.get(videoId) ?? [];
    return {
      segments: groupSegments(
        list.map((e) => ({
          startS: e.candidate.startS,
          endS: e.candidate.endS,
          status: e.candidate.status === 'labeled' && e.hold ? ('labeled' as const) : ('open' as const),
          group: e.hold ? groups.get(e.hold.asanaId) : undefined,
        })),
      ),
      open: list.filter((e) => e.candidate.status === 'open').map((e) => ({ startS: e.candidate.startS, endS: e.candidate.endS })),
    };
  }

  // ----- sticky timeline: a detail window per video that follows the list -----

  type Target = Range & { animate?: boolean };
  /** Range requested for each video's detail graph (follow, overview taps). */
  let targets = $state.raw<Record<string, Target>>({});
  /** Range the detail graph actually shows (it can be pinched and panned). */
  let shown = $state.raw<Record<string, Range>>({});
  let stuck = $state.raw<Record<string, boolean>>({});
  const heads: Record<string, HTMLElement> = {};
  const defaults = new Map<string, Target>();

  function targetOf(video: Video): Target {
    const t = targets[video.id];
    if (t) return t;
    // Stable object per video: a new one would move the graph back.
    let d = defaults.get(video.id);
    if (!d || d.endS - d.startS !== detailLength(video.durationS)) {
      d = windowAround(0, detailLength(video.durationS), video.durationS);
      defaults.set(video.id, d);
    }
    return d;
  }

  /** What the detail graph shows (or would show while collapsed). */
  function windowOf(video: Video): Range {
    return (graphOpen && shown[video.id]) || targetOf(video);
  }

  function setTarget(videoId: string, r: Target) {
    targets = { ...targets, [videoId]: r };
  }

  function onView(videoId: string, startS: number, endS: number) {
    const cur = shown[videoId];
    if (cur && cur.startS === startS && cur.endS === endS) return;
    shown = { ...shown, [videoId]: { startS, endS } };
  }

  // Programmatic (smooth) scrolling passes many cards; the window must not follow it.
  let programmatic = false;
  let programmaticIdle = 0;
  let programmaticMax = 0;
  function markProgrammatic() {
    programmatic = true;
    clearTimeout(programmaticIdle);
    clearTimeout(programmaticMax);
    programmaticIdle = window.setTimeout(endProgrammatic, 200);
    programmaticMax = window.setTimeout(endProgrammatic, 1500);
  }
  function endProgrammatic() {
    clearTimeout(programmaticIdle);
    clearTimeout(programmaticMax);
    programmatic = false;
  }

  /** Scrolls the page so the card is visible below the sticky timeline (`top`: right below it). */
  function scrollToCard(key: string, videoId: string, top = false) {
    const el = document.getElementById(`card-${key}`);
    const head = heads[videoId];
    if (!el) return;
    const r = el.getBoundingClientRect();
    const stickyTop = head ? parseFloat(getComputedStyle(head).top) || 0 : 0;
    const upper = stickyTop + (head?.offsetHeight ?? 0) + 8;
    const lower = (window.visualViewport?.height ?? window.innerHeight) - 8;
    let dy = 0;
    if (top || r.top < upper) dy = r.top - upper;
    else if (r.bottom > lower) dy = Math.min(r.bottom - lower, r.top - upper);
    if (Math.abs(dy) < 2) return;
    markProgrammatic();
    window.scrollBy({ top: dy, behavior: 'smooth' });
  }

  /** The card right below the sticky timeline defines the current time; the window follows it. */
  function follow() {
    const nextStuck: Record<string, boolean> = {};
    for (const video of review.videos) {
      const head = heads[video.id];
      const section = head?.parentElement?.getBoundingClientRect();
      if (!head || !section) continue;
      const hr = head.getBoundingClientRect();
      const stickyTop = parseFloat(getComputedStyle(head).top) || 0;
      nextStuck[video.id] = hr.top <= stickyTop + 0.5 && section.top < hr.top - 0.5;
      const list = entriesByVideo.get(video.id) ?? [];
      if (programmatic || !list.length || section.bottom < hr.bottom || section.top > window.innerHeight) continue;
      const bottomOf = (i: number) => document.getElementById(`card-${list[i]!.key}`)?.getBoundingClientRect().bottom ?? -Infinity;
      const c = list[Math.min(list.length - 1, firstBelow(list.length, bottomOf, hr.bottom + 8))]!.candidate;
      const cur = windowOf(video);
      const next = followWindow(cur, (c.startS + c.endS) / 2, video.durationS);
      if (next !== cur) setTarget(video.id, next);
    }
    if (Object.keys(nextStuck).some((k) => nextStuck[k] !== stuck[k])) stuck = nextStuck;
  }

  let scrollRaf = 0;
  function onScroll() {
    if (programmatic) {
      // Still moving: extend the quiet period.
      clearTimeout(programmaticIdle);
      programmaticIdle = window.setTimeout(endProgrammatic, 200);
    }
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      follow();
    });
  }

  onMount(() => {
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(scrollRaf);
      endProgrammatic();
    };
  });

  /** Overview drag: the window follows the finger. */
  function scrubOverview(video: Video, t: number) {
    const cur = windowOf(video);
    setTarget(video.id, { ...windowAround(t, cur.endS - cur.startS, video.durationS), animate: false });
  }

  /** Overview tap (or end of a drag): moves the window there and scrolls the list to the card at that time. */
  function pickOverview(video: Video, t: number, dragged: boolean) {
    const cur = windowOf(video);
    setTarget(video.id, { ...windowAround(t, cur.endS - cur.startS, video.durationS), animate: !dragged });
    const list = entriesByVideo.get(video.id) ?? [];
    const at = list.find((e) => e.candidate.endS >= t) ?? list[list.length - 1];
    if (at) scrollToCard(at.key, video.id, true);
  }

  function frameOf(videoId: string) {
    const a = review.analyses[videoId];
    return { width: a?.frameWidth ?? 80, height: a?.frameHeight ?? 45, hz: a?.sampleHz ?? 4 };
  }

  async function selectFromGraph(key: string) {
    selectedKey = key;
    await tick();
    const e = review.entry(key);
    if (e) scrollToCard(key, e.videoId);
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
      const key = await review.addMissed(s.videoId, t, s.gap ? { fromS: s.gap.startS, toS: s.gap.endS } : undefined);
      if (key) void selectFromGraph(key);
    }
  }

  const waiting = $derived(capture.waitingForFile(review.holds));
  let attachError = $state<string | null>(null);

  async function reattach(e: Event, video: Video) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    attachError = await reattachVideo(video, file);
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
      <h2>{formatDay(session.date, true)}</h2>
      <p class="muted small tabular">
        {formatDuration(duration)} · {counts.labeled} labeled{counts.open ? ` · ${counts.open} open` : ''}
      </p>
      <button class="place" class:unset={!place} type="button" aria-label={place ? `Location: ${place}. Edit` : 'Add location'} onclick={() => (placeDraft = session.location?.name ?? '')}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"
          ><path d="M12 21s-6.5-6.1-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 14.9 12 21 12 21Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" /><circle
            cx="12"
            cy="9.8"
            r="2.3"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
          /></svg
        >
        <span>{place ?? 'Add location'}</span>
      </button>
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
      <button class="picker" type="button" aria-haspopup="dialog" aria-label="Template: {review.template?.name ?? 'No template'}" onclick={chooseTemplate}>
        <span class="picker-label">Template</span>
        <span class="picker-value">{review.template?.name ?? 'No template'}</span>
        <span class="picker-chev" aria-hidden="true">›</span>
      </button>
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
      {@const entries = entriesByVideo.get(video.id) ?? []}
      <section class="video">
        {#if review.videos.length > 1}<h3 class="section-title">{video.fileName}</h3>{/if}
        {#if waiting.has(video.id)}
          <div class="card notice">
            <p class="small">Select <strong>{video.fileName}</strong> again to save full-resolution stills and clips of the labeled holds.</p>
            <label class="btn">
              Select video
              <input class="visually-hidden" type="file" accept="video/*" onchange={(e) => reattach(e, video)} />
            </label>
            {#if attachError}<p class="small error">{attachError}</p>{/if}
          </div>
        {/if}
        {#if analysis}
          {@const overview = overviewOf(video.id)}
          {@const gaps = gapsFor(video)}
          <div class="timeline-head" class:stuck={stuck[video.id]} bind:this={heads[video.id]}>
            <div class="overview-row">
              <TimelineOverview
                durationS={video.durationS}
                segments={overview.segments}
                open={overview.open}
                window={windowOf(video)}
                onscrub={(t) => scrubOverview(video, t)}
                onpick={(t, dragged) => pickOverview(video, t, dragged)}
              />
              <button class="chev-btn" type="button" aria-expanded={graphOpen} aria-label="Timeline graph" onclick={() => (graphOpen = !graphOpen)}>
                <span class="chev" class:open={graphOpen}>›</span>
              </button>
            </div>
            {#if graphOpen}
              <div class="card graph">
                <TimelineGraph
                  durationS={video.durationS}
                  sampleHz={analysis.sampleHz}
                  values={analysis.C}
                  threshold={analysis.threshold}
                  spans={spansFor(video.id)}
                  selectedId={selectedKey}
                  height={136}
                  range={targetOf(video)}
                  onselect={selectFromGraph}
                  onview={(a, b) => onView(video.id, a, b)}
                />
              </div>
            {/if}
          </div>

          {#snippet gapRow(gap: CoverageGap)}
            <button
              class="gap"
              type="button"
              aria-label="{formatDuration(gap.endS - gap.startS)} not covered at {formatTime(gap.startS)}: add a hold"
              onclick={() => (scrub = { mode: 'add', videoId: video.id, gap })}
            >
              <span class="tabular">{formatDuration(gap.endS - gap.startS)} not covered</span>
              <span class="gap-add">+ Add hold</span>
            </button>
          {/snippet}

          <div class="cards">
            {#each entries as entry, i (entry.key)}
              {#if gaps.has(i)}{@render gapRow(gaps.get(i)!)}{/if}
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
                onframe={() => (scrub = { mode: 'nudge', videoId: video.id, key: entry.key })}
                oncrop={entry.hold ? () => (cropHoldId = entry.hold?.id ?? null) : undefined}
                onfullframe={app.files.has(video.id) ? () => (probe = { videoId: video.id, t: entry.candidate.bestS }) : undefined}
                onselect={() => (selectedKey = entry.key)}
                onconfirm={() => review.confirm(entry.key)}
                onpick={() => (pickerKey = entry.key)}
                onmore={() => more(entry)}
                onrestore={() => review.restore(entry.key)}
              />
            {:else}
              <p class="muted">No holds found in this video. Add one by hand below.</p>
            {/each}
            {#if entries.length && gaps.has(entries.length)}{@render gapRow(gaps.get(entries.length)!)}{/if}
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
    {@const from = scrub.gap?.startS ?? 0}
    {@const to = scrub.gap?.endS ?? v?.durationS ?? 0}
    <FrameScrubber
      title={scrub.gap ? `Add hold · ${formatTime(from)}–${formatTime(to)}` : 'Add missed hold'}
      confirmLabel="Add hold here"
      videoId={scrub.videoId}
      frameWidth={f.width}
      frameHeight={f.height}
      sampleHz={f.hz}
      fromS={from}
      toS={to}
      valueS={(from + to) / 2}
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

{#if placeDraft !== null && review.session}
  <Sheet title="Location" onclose={() => (placeDraft = null)} action={{ label: 'Save', form: 'place-form' }}>
    <form
      id="place-form"
      class="place-form"
      onsubmit={(e) => {
        e.preventDefault();
        void savePlace();
      }}
    >
      <label class="field">
        <span>Place name</span>
        <input type="text" bind:value={placeDraft} placeholder="e.g. Shala, Park" autocomplete="off" autocapitalize="words" enterkeyhint="done" />
      </label>
      {#if placeChips.length}
        <div class="chips" role="group" aria-label="Places you named">
          {#each placeChips as name (name)}
            <button type="button" class="chip" class:on={name === placeDraft.trim()} aria-pressed={name === placeDraft.trim()} onclick={() => (placeDraft = name)}>{name}</button>
          {/each}
        </div>
      {/if}
      <p class="muted small">
        {coords ? `${formatCoords(coords.lat, coords.lon)}, from the video.` : 'The videos carry no location. The name is all this session has.'}
        {#if alsoNamed}<br />Also used for {alsoNamed} other {alsoNamed === 1 ? 'session' : 'sessions'} here.{/if}
      </p>
    </form>
  </Sheet>
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

  /* Where the session was practised: quiet, like the line above it. */
  .place {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    min-height: var(--touch);
    max-width: 100%;
    margin: calc(-1 * var(--space-2)) 0 calc(-1 * var(--space-2)) calc(-1 * var(--space-1));
    padding: 0 var(--space-1);
    border: 0;
    border-radius: var(--radius-s);
    background: transparent;
    color: var(--color-text-2);
    font-size: var(--text-s);
    text-align: left;
  }

  .place span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .place.unset {
    color: var(--color-accent-strong);
    font-weight: var(--weight-medium);
  }

  .place:active {
    background: var(--color-neutral-tint);
  }

  /* Template: a settings-style row that opens the list of templates. */
  .picker {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--touch);
    padding: 0 var(--space-3);
    border: 1px solid var(--color-hairline);
    border-radius: var(--radius-m);
    background: var(--color-surface);
    text-align: left;
  }

  .picker-label {
    color: var(--color-text-2);
    font-size: var(--text-s);
  }

  .picker-value {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: right;
    font-weight: var(--weight-medium);
  }

  .picker-chev {
    color: var(--color-text-3);
    font-size: var(--text-l);
  }

  .place-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .place-form p {
    margin: 0;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--text-s);
    color: var(--color-text-2);
  }

  .field input {
    min-height: var(--touch);
    padding: 0 var(--space-3);
    border: 1px solid var(--color-hairline);
    border-radius: var(--radius-s);
    background: var(--color-surface);
    font-size: var(--text-l);
    color: var(--color-text);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .chip {
    min-height: var(--touch);
    padding: 0 var(--space-3);
    border: 1px solid var(--color-hairline);
    border-radius: var(--radius-pill);
    background: var(--color-surface);
    font-size: var(--text-s);
    color: var(--color-text);
  }

  .chip.on {
    border-color: var(--color-accent);
    background: var(--color-accent-tint);
    color: var(--color-accent-strong);
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

  /* Status bar area of the Home Screen app: cards scroll away beneath it, not into view above the sticky timeline. */
  .review-screen::before {
    content: '';
    position: fixed;
    inset: 0 0 auto;
    height: var(--safe-top);
    background: var(--color-bg);
    z-index: 3;
  }

  .timeline-head {
    position: sticky;
    top: var(--safe-top);
    z-index: 2;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0 calc(-1 * var(--space-2));
    padding: var(--space-1) var(--space-2) var(--space-2);
    border-bottom: 1px solid transparent;
    background: var(--color-bg);
    transition: border-color var(--duration-fast) var(--ease);
  }

  .timeline-head.stuck {
    border-bottom-color: var(--color-hairline);
  }

  .overview-row {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .chev-btn {
    flex: none;
    width: var(--touch);
    height: var(--touch);
    margin-right: calc(-1 * var(--space-2));
    padding: 0;
    border: 0;
    background: transparent;
  }

  .graph {
    padding: var(--space-2) 0 var(--space-1);
    overflow: hidden;
  }

  /* Uncovered stretch between two cards: a quiet dashed line with a time and an add action. */
  .gap {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--touch);
    margin: calc(-1 * var(--space-1)) 0;
    padding: 0 var(--space-1);
    border: 0;
    border-radius: var(--radius-s);
    background: transparent;
    color: var(--color-text-3);
    font-size: var(--text-s);
    text-align: left;
  }

  .gap::before,
  .gap::after {
    content: '';
    flex: 1;
    border-top: 1px dashed var(--color-hairline);
  }

  .gap::before {
    flex: 0 0 var(--space-3);
  }

  .gap::after {
    order: 2;
  }

  .gap-add {
    order: 3;
    color: var(--color-accent-strong);
    font-weight: var(--weight-medium);
  }

  .gap:active {
    background: var(--color-neutral-tint);
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
