<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import TimelineGraph from '../components/TimelineGraph.svelte';
  import TimelineOverview from '../components/TimelineOverview.svelte';
  import ReviewCard from '../components/ReviewCard.svelte';
  import LabelPicker from '../components/LabelPicker.svelte';
  import FrameScrubber from '../components/FrameScrubber.svelte';
  import FrameProbe from '../components/FrameProbe.svelte';
  import CropEditor from '../components/CropEditor.svelte';
  import Sheet from '../components/Sheet.svelte';
  import { formatDuration, formatTime, previewTimes, type Span } from '../components/timeline';
  import { combinedSignal, detailLength, firstBelow, followWindow, groupSegments, videoOffsets, windowAround, type Range } from '../components/session-timeline';
  import { formatDay } from '../format';
  import { expectedHolds, nextEntries, type Label } from '../../labeling';
  import { holdReps } from '../../progression';
  import { app } from '../state/app.svelte';
  import { pipeline } from '../pipeline/controller.svelte';
  import { importQueue } from '../import.svelte';
  import { routeHash, router } from '../state/router.svelte';
  import { dialog } from '../state/dialog.svelte';
  import { SessionReview } from '../state/review.svelte';
  import { coverageRows, formatCoords, missingPoseFrames, placeLabel, placeNames, sessionCoords, sessionSpanS, type GapPart, type SessionEntry } from '../state/session-data';
  import { capture, debugCropper } from '../state/capture.svelte';
  import { setManualCrop } from '../state/hold-actions';
  import VideoFinder from '../components/VideoFinder.svelte';

  interface Props {
    id: string;
  }
  let { id }: Props = $props();

  const review = new SessionReview();
  let selectedKey = $state<string | null>(null);
  let pickerKey = $state<string | null>(null);
  let scrub = $state<{ mode: 'nudge' | 'split' | 'add'; videoId: string; key?: string; gap?: GapPart } | null>(null);
  let probe = $state<{ videoId: string; t: number } | null>(null);
  let cropHoldId = $state<string | null>(null);
  const cropHold = $derived(cropHoldId ? app.holds.find((h) => h.id === cropHoldId) : undefined);
  const cropStill = $derived(cropHoldId ? app.assets.find((a) => a.holdId === cropHoldId && a.kind === 'still') : undefined);
  let graphOpen = $state(true);

  $effect(() => {
    if (app.ready) void review.load(id);
  });
  onDestroy(() => review.dispose());

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

  /** Open cards the pose alignment can label in one go (shown from two on). */
  const confirmable = $derived(review.confirmAllPlan && review.confirmAllPlan.length >= 2 ? review.confirmAllPlan.length : 0);
  let confirmingAll = $state(false);

  async function confirmAll() {
    const n = confirmable;
    const choice = await dialog.ask({
      title: `Label ${n} holds?`,
      message: 'Each open card gets its first suggestion, from the template order and the pose. You can change any label afterwards.',
      options: [
        { id: 'go', label: `Confirm ${n}`, kind: 'primary' },
        { id: 'cancel', label: 'Cancel', kind: 'quiet' },
      ],
    });
    if (choice !== 'go') return;
    confirmingAll = true;
    try {
      await review.confirmAll();
    } finally {
      confirmingAll = false;
    }
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

  // ----- one timeline for the whole session: the videos back to back in session order -----

  const offsets = $derived(videoOffsets(review.videos));
  const timelineS = $derived(review.videos.reduce((sum, v) => sum + v.durationS, 0));
  /** Where one video ends and the next begins. */
  const boundaries = $derived(review.videos.slice(1).map((v) => offsets.get(v.id) ?? 0));
  const offsetOf = (videoId: string) => offsets.get(videoId) ?? 0;
  const analysed = $derived(review.videos.filter((v) => review.analyses[v.id]));
  /** Cards on screen: "Not a pose" candidates live only in the gap rows. */
  const visible = $derived(review.entries.filter((e) => e.candidate.status !== 'dismissed'));
  const unanalysed = $derived(review.videos.filter((v) => !review.analyses[v.id]));

  /** C(t) of all videos on the session timeline, each divided by its threshold (threshold 1). */
  let signalSeq = 0;
  const signal = $derived.by(() => {
    const parts = analysed.map((v) => {
      const a = review.analyses[v.id]!;
      return { offsetS: offsetOf(v.id), durationS: v.durationS, sampleHz: a.sampleHz, values: a.C, threshold: a.threshold };
    });
    const hz = Math.max(1, ...parts.map((p) => p.sampleHz));
    return { values: combinedSignal(parts, timelineS, hz), sampleHz: hz, version: ++signalSeq };
  });

  const spans = $derived<Span[]>(
    visible.map((e) => {
      const o = offsetOf(e.videoId);
      return {
        id: e.key,
        startS: o + e.candidate.startS,
        endS: o + e.candidate.endS,
        bestS: o + e.candidate.bestS,
        alternatesS: e.candidate.alternatesS.map((t) => o + t),
        status: e.candidate.status === 'labeled' && e.hold ? 'labeled' : 'open',
        ...(e.hold ? { label: `${nameOf(e.hold.asanaId)}${e.hold.side ? ` ${e.hold.side}` : ''}` } : {}),
      };
    }),
  );

  const overview = $derived({
    segments: groupSegments(
      spans.map((sp, i) => ({
        startS: sp.startS,
        endS: sp.endS,
        status: sp.status === 'labeled' ? ('labeled' as const) : ('open' as const),
        group: visible[i]!.hold ? groups.get(visible[i]!.hold!.asanaId) : undefined,
      })),
    ),
    open: spans.filter((sp) => sp.status === 'open').map((sp) => ({ startS: sp.startS, endS: sp.endS })),
  });

  type Row = { kind: 'card'; entry: SessionEntry; number: number } | { kind: 'gap'; parts: GapPart[] };
  /**
   * The card list: every video's cards in session order, with a row for each uncovered stretch.
   * Stretches that meet at a video boundary are one row (`coverageRows`). "Not a pose" candidates
   * are not cards: they count as uncovered, and their gap row is always shown.
   */
  const rows = $derived.by(() => {
    let n = 0;
    const input = review.videos.map((video) => {
      if (!review.analyses[video.id]) return { id: video.id, durationS: video.durationS, cards: null };
      const all = review.entries.filter((e) => e.videoId === video.id);
      return {
        id: video.id,
        durationS: video.durationS,
        cards: all.filter((e) => e.candidate.status !== 'dismissed').map((e) => ({ startS: e.candidate.startS, endS: e.candidate.endS, entry: e })),
        skipped: all.filter((e) => e.candidate.status === 'dismissed').map((e) => e.candidate),
      };
    });
    return coverageRows(input).map((r): Row => (r.kind === 'card' ? { kind: 'card', entry: r.item.entry, number: ++n } : r));
  });

  // ----- sticky timeline: a detail window that follows the list -----

  type Target = Range & { animate?: boolean };
  /** Range requested for the detail graph (follow, overview taps); null = the start. */
  let target = $state.raw<Target | null>(null);
  /** Range the detail graph actually shows (it can be pinched and panned). */
  let shown = $state.raw<Range | null>(null);
  let stuck = $state(false);
  let head = $state<HTMLElement>();
  let defaultTarget: Target | null = null;

  function currentTarget(): Target {
    if (target) return target;
    // Stable object: a new one would move the graph back.
    const len = detailLength(timelineS);
    if (!defaultTarget || defaultTarget.endS - defaultTarget.startS !== len) defaultTarget = windowAround(0, len, timelineS);
    return defaultTarget;
  }

  /** What the detail graph shows (or would show while collapsed). */
  function currentWindow(): Range {
    return (graphOpen && shown) || currentTarget();
  }

  function onView(startS: number, endS: number) {
    if (shown && shown.startS === startS && shown.endS === endS) return;
    shown = { startS, endS };
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
  function scrollToCard(key: string, top = false) {
    const el = document.getElementById(`card-${key}`);
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
    const section = head?.parentElement?.getBoundingClientRect();
    if (!head || !section) return;
    const hr = head.getBoundingClientRect();
    const stickyTop = parseFloat(getComputedStyle(head).top) || 0;
    const nextStuck = hr.top <= stickyTop + 0.5 && section.top < hr.top - 0.5;
    if (nextStuck !== stuck) stuck = nextStuck;
    const list = visible;
    if (programmatic || !list.length || section.bottom < hr.bottom) return;
    const bottomOf = (i: number) => document.getElementById(`card-${list[i]!.key}`)?.getBoundingClientRect().bottom ?? -Infinity;
    const e = list[Math.min(list.length - 1, firstBelow(list.length, bottomOf, hr.bottom + 8))]!;
    const cur = currentWindow();
    const next = followWindow(cur, offsetOf(e.videoId) + (e.candidate.startS + e.candidate.endS) / 2, timelineS);
    if (next !== cur) target = next;
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
  function scrubOverview(t: number) {
    const cur = currentWindow();
    target = { ...windowAround(t, cur.endS - cur.startS, timelineS), animate: false };
  }

  /** Overview tap (or end of a drag): moves the window there and scrolls the list to the card at that time. */
  function pickOverview(t: number, dragged: boolean) {
    const cur = currentWindow();
    target = { ...windowAround(t, cur.endS - cur.startS, timelineS), animate: !dragged };
    const list = visible;
    const at = list.find((e) => offsetOf(e.videoId) + e.candidate.endS >= t) ?? list[list.length - 1];
    if (at) scrollToCard(at.key, true);
  }

  function frameOf(videoId: string) {
    const a = review.analyses[videoId];
    return { width: a?.frameWidth ?? 80, height: a?.frameHeight ?? 45, hz: a?.sampleHz ?? 4 };
  }

  async function selectFromGraph(key: string) {
    selectedKey = key;
    await tick();
    scrollToCard(key);
  }

  /** "Add missed hold" over the whole session: with several videos, asks which part it is in. */
  async function addMissed() {
    if (analysed.length <= 1) {
      if (analysed[0]) scrub = { mode: 'add', videoId: analysed[0].id };
      return;
    }
    const choice = await dialog.ask({
      title: 'Add missed hold',
      message: 'Which part of the session is it in?',
      options: [
        ...analysed.map((v) => {
          const o = offsetOf(v.id);
          return { id: v.id, label: `${formatTime(o)}–${formatTime(o + v.durationS)}`, detail: v.fileName };
        }),
        { id: 'cancel', label: 'Cancel', kind: 'quiet' as const },
      ],
    });
    if (review.analyses[choice]) scrub = { mode: 'add', videoId: choice };
  }

  async function more(entry: SessionEntry) {
    const prev = review.previousOf(entry.key);
    const hasFile = app.files.has(entry.videoId);
    const hasStill = !!entry.hold && app.assets.some((a) => a.holdId === entry.hold!.id && a.kind === 'still');
    const f = frameOf(entry.videoId);
    const choice = await dialog.ask({
      title: `Hold at ${formatTime(offsetOf(entry.videoId) + entry.candidate.startS)}`,
      frames: {
        videoId: entry.videoId,
        width: f.width,
        height: f.height,
        items: previewTimes(entry.candidate.startS, entry.candidate.endS).map((t) => ({ index: Math.floor(t * f.hz), label: formatTime(offsetOf(entry.videoId) + t) })),
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

  const gapLength = (parts: GapPart[]) => parts.reduce((sum, p) => sum + p.endS - p.startS, 0);
  const gapSkipped = (parts: GapPart[]) => parts.reduce((sum, p) => sum + (p.skipped ?? 0), 0);
  /** Session time of a gap: its parts are contiguous on the session timeline. */
  const gapStart = (parts: GapPart[]) => offsetOf(parts[0]!.videoId) + parts[0]!.startS;

  /** Which part of a gap that spans several videos (one part: that one). */
  async function pickPart(parts: GapPart[], title: string): Promise<GapPart | undefined> {
    if (parts.length === 1) return parts[0];
    const choice = await dialog.ask({
      title,
      message: 'This stretch spans several videos. Which part is it in?',
      options: [
        ...parts.map((p, i) => {
          const o = offsetOf(p.videoId);
          return { id: String(i), label: `${formatTime(o + p.startS)}–${formatTime(o + p.endS)}`, detail: review.videos.find((v) => v.id === p.videoId)?.fileName ?? '' };
        }),
        { id: 'cancel', label: 'Cancel', kind: 'quiet' as const },
      ],
    });
    return parts[Number(choice)];
  }

  /**
   * An uncovered stretch (possibly across a video boundary): analyse it on its own (several holds
   * at once), add a hold by hand, or bring back what was marked "Not a pose" there.
   */
  async function gapMenu(parts: GapPart[]) {
    const first = parts[0]!;
    const f = frameOf(first.videoId);
    const total = gapLength(parts);
    const skipped = gapSkipped(parts);
    // Preview frames across the whole stretch, shared out by length, each from its own video.
    const count = previewTimes(0, total).length;
    const items = parts.flatMap((p) => {
      const o = offsetOf(p.videoId);
      const hz = frameOf(p.videoId).hz;
      const n = Math.max(1, Math.round((count * (p.endS - p.startS)) / total));
      const times = n === 1 ? [(p.startS + p.endS) / 2] : Array.from({ length: n }, (_, i) => p.startS + ((i + 0.5) * (p.endS - p.startS)) / n);
      return times.map((t) => ({ index: Math.floor(t * hz), label: formatTime(o + t), videoId: p.videoId }));
    });
    const choice = await dialog.ask({
      title: `${formatDuration(total)} not covered`,
      message: `${formatTime(gapStart(parts))}–${formatTime(gapStart(parts) + total)}`,
      frames: { videoId: first.videoId, width: f.width, height: f.height, items },
      options: [
        { id: 'find', label: 'Find holds here', kind: 'primary', detail: 'Analyses this stretch on its own.' },
        { id: 'add', label: 'Add a hold by hand…' },
        ...(skipped ? [{ id: 'restore', label: `Show ${skipped === 1 ? 'the skipped hold' : `${skipped} skipped holds`}`, detail: 'Marked “Not a pose”.' }] : []),
        { id: 'cancel', label: 'Cancel', kind: 'quiet' },
      ],
    });
    if (choice === 'add') await addInGap(parts);
    else if (choice === 'restore') {
      for (const p of parts) if (p.skipped) await review.restoreIn(p.videoId, { fromS: p.startS, toS: p.endS });
    } else if (choice === 'find') {
      const keys: string[] = [];
      for (const p of parts) keys.push(...(await review.findHolds(p.videoId, { fromS: p.startS, toS: p.endS })));
      if (keys[0]) {
        void selectFromGraph(keys[0]);
        return;
      }
      const minHold = review.analyses[first.videoId]?.params.minHoldS ?? 6;
      const next = await dialog.ask({
        title: 'No hold found',
        message: `Nothing in this stretch stays still for ${minHold} s${skipped ? ', apart from what was marked “Not a pose”' : ''}.`,
        options: [
          { id: 'add', label: 'Add a hold by hand…', kind: 'primary' },
          { id: 'cancel', label: 'Cancel', kind: 'quiet' },
        ],
      });
      if (next === 'add') await addInGap(parts);
    }
  }

  async function addInGap(parts: GapPart[]) {
    const part = await pickPart(parts, 'Add a hold');
    if (part) scrub = { mode: 'add', videoId: part.videoId, gap: part };
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

  /**
   * Videos whose file is needed: for stills and clips of labeled holds, or for the poses of open
   * cards (suggestions and "Confirm all" use them; not with the debug null cropper).
   */
  const needFile = $derived.by(() => {
    const stills = capture.waitingForFile(review.holds);
    const poseModel = debugCropper() !== 'none';
    const poses = new Set(
      review.videos.filter((v) => poseModel && review.analyses[v.id] && missingPoseFrames(review.analyses[v.id]!, true).length).map((v) => v.id),
    );
    return { stills, poses, videos: review.videos.filter((v) => !app.files.has(v.id) && (stills.has(v.id) || poses.has(v.id))) };
  });
  let attachMessage = $state<string | null>(null);
  const needText = $derived.by(() => {
    const { videos, stills } = needFile;
    const one = videos.length === 1;
    const files = one ? 'the video' : `the ${videos.length} videos`;
    const forStills = videos.some((v) => stills.has(v.id));
    const forPoses = videos.some((v) => needFile.poses.has(v.id));
    if (forStills && forPoses) return `Select ${files} again to save full-resolution stills and clips of the labeled holds and to read the poses of the open cards.`;
    if (forStills) return `Select ${files} again to save full-resolution stills and clips of the labeled holds.`;
    return `Select ${files} again to read the poses of the open cards (better suggestions and “Confirm all”).`;
  });

  const scrubEntry = $derived(scrub?.key ? review.entry(scrub.key) : undefined);
  const pickerEntry = $derived(pickerKey ? review.entry(pickerKey) : undefined);
  const sessionLabels = $derived(review.items.filter((i) => i.status === 'labeled' && i.label).map((i) => i.label!));
</script>

<main class="review-screen">
  <header class="top">
    <button class="btn quiet" type="button" onclick={() => router.go({ name: 'home', tab: 'sessions' })}>‹ Sessions</button>
    {#if review.session}
      {@const n = review.session.videoIds.length}
      <a class="btn quiet videos-link" href={routeHash({ name: 'session-videos', id })}>{n} {n === 1 ? 'video' : 'videos'} ›</a>
    {/if}
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

    {#if confirmable}
      <div class="card notice">
        <p class="small">{confirmable} open {confirmable === 1 ? 'card has' : 'cards have'} a suggestion from the template order and the pose.</p>
        <button class="btn primary" type="button" onclick={confirmAll} disabled={confirmingAll}>Confirm all {confirmable}</button>
      </div>
    {/if}

    {#if needFile.videos.length || attachMessage || unanalysed.length}
      <div class="card notice">
        {#if needFile.videos.length}
          <p class="small">{needText}</p>
          <VideoFinder videos={needFile.videos} onresult={(m) => (attachMessage = m)} />
        {/if}
        {#if attachMessage}<p class="small" aria-live="polite">{attachMessage}</p>{/if}
        {#each unanalysed as video (video.id)}
          <p class="small muted">{video.fileName} is not analysed yet. Import the file again to process it.</p>
        {/each}
      </div>
    {/if}

    {#if analysed.length}
      <section class="timeline">
        <div class="timeline-head" class:stuck bind:this={head}>
          <div class="overview-row">
            <TimelineOverview
              durationS={timelineS}
              segments={overview.segments}
              open={overview.open}
              window={currentWindow()}
              onscrub={scrubOverview}
              onpick={pickOverview}
            />
            <button class="chev-btn" type="button" aria-expanded={graphOpen} aria-label="Timeline graph" onclick={() => (graphOpen = !graphOpen)}>
              <span class="chev" class:open={graphOpen} aria-hidden="true">›</span>
            </button>
          </div>
          {#if graphOpen}
            <div class="card graph">
              <TimelineGraph
                durationS={timelineS}
                sampleHz={signal.sampleHz}
                values={signal.values}
                version={signal.version}
                threshold={1}
                {spans}
                {boundaries}
                selectedId={selectedKey}
                height={136}
                range={currentTarget()}
                onselect={selectFromGraph}
                onview={onView}
              />
            </div>
          {/if}
        </div>

        {#snippet gapRow(parts: GapPart[])}
          {@const total = gapLength(parts)}
          {@const skipped = gapSkipped(parts)}
          <button
            class="gap"
            type="button"
            aria-haspopup="dialog"
            aria-label="{formatDuration(total)} not covered at {formatTime(gapStart(parts))}{skipped ? `, ${skipped} skipped` : ''}: find or add holds"
            onclick={() => gapMenu(parts)}
          >
            <span class="tabular">{formatDuration(total)} not covered{#if skipped}<span class="faint"> · {skipped} skipped</span>{/if}</span>
            <span class="gap-add">+ Add holds</span>
          </button>
        {/snippet}

        <div class="cards">
          {#each rows as row (row.kind === 'card' ? row.entry.key : `gap-${row.parts[0]!.videoId}-${row.parts[0]!.startS}`)}
            {#if row.kind === 'gap'}
              {@render gapRow(row.parts)}
            {:else}
              {@const entry = row.entry}
              <ReviewCard
                {entry}
                number={row.number}
                offsetS={offsetOf(entry.videoId)}
                suggestion={review.suggestions[entry.key]?.[0]}
                {nameOf}
                frame={frameOf(entry.videoId)}
                selected={selectedKey === entry.key}
                thumb={entry.hold ? app.assets.find((a) => a.holdId === entry.hold!.id && a.kind === 'thumb') : undefined}
                captureStatus={entry.hold ? capture.status[entry.hold.id] : undefined}
                captureError={entry.hold ? capture.errors[entry.hold.id] || undefined : undefined}
                rep={entry.hold ? reps.get(entry.hold.id) : undefined}
                expected={expectedAt(entry)}
                onsplit={(k) => review.splitInto(entry.key, k)}
                onframe={() => (scrub = { mode: 'nudge', videoId: entry.videoId, key: entry.key })}
                oncrop={entry.hold ? () => (cropHoldId = entry.hold?.id ?? null) : undefined}
                onfullframe={app.files.has(entry.videoId) ? () => (probe = { videoId: entry.videoId, t: entry.candidate.bestS }) : undefined}
                onselect={() => (selectedKey = entry.key)}
                onconfirm={() => review.confirm(entry.key)}
                onpick={() => (pickerKey = entry.key)}
                onmore={() => more(entry)}
              />
            {/if}
          {:else}
            <p class="muted">No holds found in this session. Add one by hand below.</p>
          {/each}
        </div>
        <button class="btn add" type="button" onclick={addMissed}>+ Add missed hold</button>
      </section>
    {/if}
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
      title={scrub.gap ? `Add hold · ${formatTime(offsetOf(scrub.videoId) + from)}–${formatTime(offsetOf(scrub.videoId) + to)}` : 'Add missed hold'}
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
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 0 calc(-1 * var(--space-3));
  }

  /* The video files are a technical detail: a quiet link to their own page. */
  .videos-link {
    color: var(--color-text-2);
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

  .notice {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
  }

  .notice .btn {
    align-self: flex-start;
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

  .timeline {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  /* inline-block: a transform does not apply to an inline span (the expanded state would not show). */
  .chev {
    display: inline-block;
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
