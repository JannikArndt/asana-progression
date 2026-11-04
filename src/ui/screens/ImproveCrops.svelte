<script lang="ts">
  import AssetImage from '../components/AssetImage.svelte';
  import CropEditor from '../components/CropEditor.svelte';
  import FrameScrubber from '../components/FrameScrubber.svelte';
  import VideoFinder from '../components/VideoFinder.svelte';
  import { displayCrop, repLabel, sessionItems, sidePartner, type ProgressionItem } from '../../progression';
  import { app } from '../state/app.svelte';
  import { capture } from '../state/capture.svelte';
  import { cropAspect, cropWithAspect } from '../state/crop-frame';
  import { chooseBestFrame, setManualCrop } from '../state/hold-actions';
  import { routeHash, router } from '../state/router.svelte';
  import { formatDay } from '../format';

  interface Props {
    id: string;
  }
  let { id }: Props = $props();

  /**
   * "Improve crops": the session's labeled holds one after another (R and L of an asana together),
   * each with its photo as cropped now. Crop and Frame fine-tune it; "Confirm & next" keeps the
   * current crop as the hold's own (manual) crop and moves on. Choosing a frame re-captures the
   * still from the video file, so it is fastest while the files are selected.
   */
  const session = $derived(app.sessions.find((s) => s.id === id));
  const items = $derived(sessionItems(id, app.holds, app.sessions, app.assets));
  const nameById = $derived(new Map(app.asanas.map((a) => [a.id, a.name])));
  const nameOf = (item: ProgressionItem) => nameById.get(item.hold.asanaId) ?? 'Unknown asana';

  /** Steps: indices into `items`; a sided hold with its other side directly at hand is one step (R first). */
  const steps = $derived.by(() => {
    const used = new Set<number>();
    const out: number[][] = [];
    items.forEach((_, i) => {
      if (used.has(i)) return;
      const p = sidePartner(items, i);
      const group = p !== null && !used.has(p) ? [i, p].sort((a, b) => (items[a]!.hold.side === 'R' ? -1 : items[b]!.hold.side === 'R' ? 1 : a - b)) : [i];
      for (const k of group) used.add(k);
      out.push(group);
    });
    return out;
  });
  const done = (i: number) => !!items[i]?.hold.crop.manual;
  const confirmed = $derived(steps.filter((g) => g.every(done)).length);

  let step = $state(0);
  let started = false;
  // Start at the first step that still has a hold without its own crop.
  $effect(() => {
    if (started || !steps.length) return;
    started = true;
    const first = steps.findIndex((g) => !g.every(done));
    step = first >= 0 ? first : 0;
  });

  const group = $derived((steps[Math.min(step, steps.length - 1)] ?? []).map((i) => items[i]!).filter(Boolean));
  const missing = $derived.by(() => {
    const ids = new Set(items.map((i) => i.hold.videoId));
    return app.videos.filter((v) => ids.has(v.id) && !app.files.has(v.id));
  });
  let attachMessage = $state<string | null>(null);
  let editing = $state<ProgressionItem | null>(null);
  let framing = $state<ProgressionItem | null>(null);
  let busy = $state(false);

  const FULL = { x: 0, y: 0, w: 1, h: 1 };
  const cropOf = (item: ProgressionItem) => displayCrop(item.hold) ?? FULL;

  function aspectOf(item: ProgressionItem): number | null {
    return item.still ? cropAspect(cropOf(item), item.still.width, item.still.height) : null;
  }

  /** The other side's crop gets this one's shape (same centre and area, inside the frame). */
  async function copyShape(from: ProgressionItem, to: ProgressionItem) {
    const a = aspectOf(from);
    if (a === null || !to.still) return;
    await setManualCrop(to.hold.id, cropWithAspect(cropOf(to), a, to.still.width, to.still.height));
  }

  async function confirmAndNext() {
    busy = true;
    try {
      for (const item of group) if (item.still && !item.hold.crop.manual) await setManualCrop(item.hold.id, cropOf(item));
    } finally {
      busy = false;
    }
    if (step >= steps.length - 1) router.go({ name: 'session-poses', id });
    else step += 1;
  }

  function sideWord(item: ProgressionItem): string {
    return [item.hold.side === 'R' ? 'Right' : item.hold.side === 'L' ? 'Left' : '', repLabel(item) ? `rep ${repLabel(item)}` : ''].filter(Boolean).join(' · ');
  }

  function onKey(e: KeyboardEvent) {
    if (editing || framing) return;
    if (e.key === 'ArrowRight') step = Math.min(steps.length - 1, step + 1);
    else if (e.key === 'ArrowLeft') step = Math.max(0, step - 1);
  }
</script>

<svelte:window onkeydown={onKey} />

<main class="crops">
  <header class="top">
    <a class="btn quiet" href={routeHash({ name: 'session-poses', id })}>‹ Poses</a>
    {#if steps.length}<span class="count tabular">{Math.min(step, steps.length - 1) + 1} / {steps.length}</span>{/if}
  </header>

  {#if session}
    <div class="title">
      <h2>Improve crops</h2>
      <p class="muted small">
        {formatDay(session.date, true)} · {confirmed} of {steps.length} confirmed. Adjust the crop or the frame, then confirm: the next pose follows.
      </p>
    </div>

    {#if missing.length || attachMessage}
      <div class="card notice">
        {#if missing.length}
          <p class="small">Select the video{missing.length === 1 ? '' : 's'} to choose frames in full quality and save the new stills.</p>
          <VideoFinder videos={missing} onresult={(m) => (attachMessage = m)} />
        {/if}
        {#if attachMessage}<p class="small" aria-live="polite">{attachMessage}</p>{/if}
      </div>
    {/if}

    {#if !group.length}
      <p class="muted">No labeled holds in this session yet.</p>
    {:else}
      <h3 class="pose-name">{nameOf(group[0]!)}</h3>
      <div class="pair" class:two={group.length === 2}>
        {#each group as item, k (item.hold.id)}
          {@const crop = displayCrop(item.hold)}
          {@const a = aspectOf(item) ?? 3 / 4}
          {@const st = capture.status[item.hold.id]}
          <section class="pose" aria-label="{nameOf(item)} {sideWord(item)}">
            <button class="photo" type="button" style:--a={a} onclick={() => item.still && (editing = item)} disabled={!item.still} aria-label="Edit crop">
              <AssetImage asset={item.still ?? item.thumb} {crop} aspect={a} alt="{nameOf(item)} {sideWord(item)}">
                {#snippet fallback()}<span class="empty small">No still yet</span>{/snippet}
              </AssetImage>
            </button>
            <p class="meta small tabular">
              {sideWord(item) || ' '}{item.hold.crop.manual ? ' · ✓' : ''}
              {#if st === 'queued' || st === 'capturing'}<span class="muted"> · saving still…</span>{/if}
            </p>
            <div class="tools">
              <button class="btn small" type="button" onclick={() => (editing = item)} disabled={!item.still}>Crop</button>
              <button class="btn small" type="button" onclick={() => (framing = item)} disabled={!app.summaries[item.hold.videoId]}>Frame</button>
            </div>
            {#if group.length === 2}
              {@const other = group[1 - k]!}
              <button class="btn quiet small copy" type="button" onclick={() => copyShape(item, other)} disabled={!item.still || !other.still}>
                Use this shape for {other.hold.side === 'L' ? 'Left' : 'Right'}
              </button>
            {/if}
          </section>
        {/each}
      </div>
    {/if}
  {:else if app.ready}
    <p class="muted">This session no longer exists.</p>
  {/if}
</main>

{#if group.length}
  <footer class="nav">
    <button class="btn" type="button" onclick={() => (step = Math.max(0, step - 1))} disabled={step === 0} aria-label="Previous pose">‹</button>
    <button class="btn primary confirm" type="button" onclick={confirmAndNext} disabled={busy}>
      {step >= steps.length - 1 ? 'Confirm & finish' : 'Confirm & next'}
    </button>
    <button class="btn" type="button" onclick={() => (step = Math.min(steps.length - 1, step + 1))} disabled={step >= steps.length - 1} aria-label="Skip">›</button>
  </footer>
{/if}

{#if framing}
  {@const hold = app.holds.find((h) => h.id === framing!.hold.id) ?? framing.hold}
  {@const sum = app.summaries[hold.videoId]}
  {#if sum}
    <FrameScrubber
      title="Choose frame · {nameOf(framing)}{hold.side ? ` ${hold.side}` : ''}"
      confirmLabel="Use this frame"
      videoId={hold.videoId}
      frameWidth={sum.frameWidth}
      frameHeight={sum.frameHeight}
      sampleHz={sum.sampleHz}
      fromS={hold.startS}
      toS={hold.endS}
      valueS={hold.bestS}
      marks={sum.candidates.find((c) => c.holdId === hold.id)?.alternatesS ?? []}
      onconfirm={async (t) => {
        const holdId = hold.id;
        framing = null;
        await chooseBestFrame(holdId, t);
      }}
      onclose={() => (framing = null)}
    />
  {/if}
{/if}

{#if editing?.still}
  {@const hold = app.holds.find((h) => h.id === editing!.hold.id) ?? editing.hold}
  <CropEditor
    {hold}
    still={editing.still}
    title="Crop · {nameOf(editing)}{hold.side ? ` ${hold.side}` : ''}"
    onsave={async (manual) => {
      await setManualCrop(hold.id, manual);
      editing = null;
    }}
    onclose={() => (editing = null)}
  />
{/if}

<style>
  .crops {
    padding: calc(var(--space-2) + var(--safe-top)) calc(var(--space-4) + var(--safe-right)) calc(96px + var(--safe-bottom)) calc(var(--space-4) + var(--safe-left));
    max-width: 960px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin: 0 calc(-1 * var(--space-3));
  }

  .top a {
    text-decoration: none;
  }

  .count {
    padding: 0 var(--space-3);
    font-size: var(--text-s);
    color: var(--color-text-2);
  }

  .title {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .title p,
  .notice p,
  .meta {
    margin: 0;
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

  .pose-name {
    margin: var(--space-2) 0 0;
    text-align: center;
  }

  .pair {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-3);
    align-items: end;
  }

  .pair.two {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .pose {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }

  /* As large as fits: the crop's own shape, at most 58 % of the screen height. */
  .photo {
    width: min(100%, calc(58vh * var(--a)));
    padding: 0;
    border: 0;
    background: transparent;
  }

  .empty {
    color: var(--color-text-2);
  }

  .meta {
    text-align: center;
    color: var(--color-text-2);
  }

  .tools {
    display: flex;
    gap: var(--space-2);
  }

  .btn.small {
    min-height: 40px;
    padding: 0 var(--space-3);
  }

  .copy {
    white-space: normal;
    text-align: center;
  }

  .nav {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 10;
    display: flex;
    gap: var(--space-2);
    padding: var(--space-3) calc(var(--space-4) + var(--safe-right)) calc(var(--space-3) + var(--safe-bottom)) calc(var(--space-4) + var(--safe-left));
    background: var(--color-bg);
    border-top: 1px solid var(--color-hairline);
  }

  .nav .btn {
    min-width: 52px;
  }

  .nav .confirm {
    flex: 1;
  }
</style>
