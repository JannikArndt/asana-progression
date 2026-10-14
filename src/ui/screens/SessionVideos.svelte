<script lang="ts">
  import { onDestroy } from 'svelte';
  import DebugPanel from '../components/DebugPanel.svelte';
  import { formatDuration, formatTime } from '../components/timeline';
  import { videoOffsets } from '../components/session-timeline';
  import { formatDay, formatRecordedAt } from '../format';
  import type { Video } from '../../model';
  import type { VideoMeta } from '../../source';
  import { app } from '../state/app.svelte';
  import { capture } from '../state/capture.svelte';
  import { router } from '../state/router.svelte';
  import { SessionReview } from '../state/review.svelte';
  import { moveItem, orderVideoIds } from '../state/session-data';
  import VideoFinder from '../components/VideoFinder.svelte';
  import { copyText, deviceInfo, videoDiagnostics } from '../diagnostics';

  interface Props {
    id: string;
  }
  let { id }: Props = $props();

  /**
   * The video files of a session: a technical view (the session screen shows one timeline of
   * asanas). Order, recording times, re-attaching a file, debug panel and diagnostics per video.
   */
  const review = new SessionReview();
  let debugOpen = $state<Record<string, boolean>>({});
  let message = $state<string | null>(null);
  let attachMessage = $state<string | null>(null);

  $effect(() => {
    if (app.ready) void review.load(id);
  });
  onDestroy(() => review.dispose());

  const offsets = $derived(videoOffsets(review.videos));
  const total = $derived(review.videos.reduce((s, v) => s + v.durationS, 0));
  const ids = $derived(review.videos.map((v) => v.id));
  const byRecording = $derived(orderVideoIds(ids, review.videos));
  const sorted = $derived(byRecording.join('\n') === ids.join('\n'));
  /** Analysed videos whose file is not selected in this page session. */
  const missing = $derived(review.videos.filter((v) => review.analyses[v.id] && !app.files.has(v.id)));

  const recordedFrom: Record<string, string> = { quicktime: 'camera time', mvhd: 'container time, can be the export time', file: 'file date' };
  function sourceOf(video: Video): string | null {
    const src = (video.meta as unknown as VideoMeta | undefined)?.recordedAtSource;
    return src ? (recordedFrom[src] ?? src) : null;
  }

  /** Short codec name ("HEVC", "VP9"); the stored codec string is too long for a row. */
  function codecOf(video: Video): string {
    const c = (video.meta as unknown as VideoMeta | undefined)?.codec;
    return c ? ` ${c.toUpperCase()}` : '';
  }

  function holdsIn(videoId: string): number {
    return review.holds.filter((h) => h.videoId === videoId).length;
  }

  async function move(index: number, delta: number) {
    await review.setVideoOrder(moveItem(ids, index, delta));
  }

  async function supportOf(videoId: string) {
    const src = app.source(videoId);
    if (!src) return null;
    try {
      return await (await src).decoderSupport();
    } catch {
      return null;
    }
  }

  async function copyAll() {
    const session = review.session;
    if (!session) return;
    const report = {
      app: { version: __APP_VERSION__, builtAt: __BUILT_AT__ },
      device: deviceInfo(),
      session: { id: session.id, date: session.date, videoIds: session.videoIds, templateId: session.templateId ?? null },
      videos: await Promise.all(
        review.videos.map(async (v) => videoDiagnostics(v, review.analyses[v.id], await supportOf(v.id), capture.diagnostics(v.id, review.analyses[v.id]))),
      ),
      hdrProbe: await app.db.settings.get('diag.hdrProbe'),
      quotaProbe: await app.db.settings.get('diag.quotaProbe'),
    };
    message = (await copyText(JSON.stringify(report, null, 2))) ? 'Diagnostics of all videos copied.' : 'Copy failed.';
  }
</script>

<main class="videos-screen">
  <header class="top">
    <button class="btn quiet" type="button" onclick={() => router.go({ name: 'session', id })}>‹ Session</button>
  </header>

  {#if review.loaded && !review.session}
    <p class="muted">This session no longer exists.</p>
  {:else if review.session}
    <div class="title">
      <h2>Videos</h2>
      <p class="muted small tabular">
        {formatDay(review.session.date, true)} · {review.videos.length} {review.videos.length === 1 ? 'video' : 'videos'} · {formatDuration(total)}
      </p>
    </div>

    {#if review.videos.length > 1}
      <p class="muted small">The session timeline plays the videos back to back in this order.</p>
      {#if !sorted}
        <button class="btn sort" type="button" onclick={() => review.setVideoOrder(byRecording)}>Sort by recording time</button>
      {/if}
    {/if}

    {#if missing.length || attachMessage}
      <div class="card notice">
        {#if missing.length}
          <p class="small">
            {missing.length === 1 ? 'One video is' : `${missing.length} videos are`} not selected since the app was opened. Full-resolution stills, clips and
            poses need the files.
          </p>
          <VideoFinder videos={missing} onresult={(m) => (attachMessage = m)} />
        {/if}
        {#if attachMessage}<p class="small" aria-live="polite">{attachMessage}</p>{/if}
      </div>
    {/if}

    <ol class="list">
      {#each review.videos as video, i (video.id)}
        {@const offset = offsets.get(video.id) ?? 0}
        {@const analysis = review.analyses[video.id]}
        {@const source = sourceOf(video)}
        <li class="card item" data-video-id={video.id}>
          <div class="row">
            <div class="info">
              <h3 class="name">{video.fileName}</h3>
              <p class="small tabular">
                {#if video.recordedAt}
                  <span title={video.recordedAt}>{formatRecordedAt(video.recordedAt)}</span>{#if source}<span class="faint"> · {source}</span>{/if}
                {:else}
                  <span class="faint">No recording time</span>
                {/if}
              </p>
              <p class="small muted tabular">
                {formatTime(offset)}–{formatTime(offset + video.durationS)} · {formatDuration(video.durationS)}
                · {video.width}×{video.height}{codecOf(video)}
                {#if analysis}· {holdsIn(video.id)} labeled{/if}
              </p>
              {#if !analysis}<p class="small muted">Not analysed yet. Import the file again to process it.</p>{/if}
            </div>
            {#if review.videos.length > 1}
              <div class="order">
                <button class="order-btn" type="button" aria-label="Move {video.fileName} up" disabled={i === 0} onclick={() => move(i, -1)}>
                  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
                </button>
                <button class="order-btn" type="button" aria-label="Move {video.fileName} down" disabled={i === review.videos.length - 1} onclick={() => move(i, 1)}>
                  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
                </button>
              </div>
            {/if}
          </div>

          {#if analysis && !app.files.has(video.id)}<p class="small faint">File not selected</p>{/if}

          <button
            class="disclosure"
            type="button"
            aria-expanded={!!debugOpen[video.id]}
            onclick={() => (debugOpen = { ...debugOpen, [video.id]: !debugOpen[video.id] })}
          >
            <span class="section-title">Debug{review.videos.length > 1 ? ` · ${video.fileName}` : ''}</span>
            <span class="chev" class:open={debugOpen[video.id]} aria-hidden="true">›</span>
          </button>
          {#if debugOpen[video.id]}
            <DebugPanel
              {video}
              analysis={analysis ?? null}
              rerun={(p, onProgress) => review.rerun(video.id, p, onProgress)}
              onchanged={() => review.load(id)}
            />
          {/if}
        </li>
      {/each}
    </ol>

    {#if review.videos.length}
      <div class="all">
        <button class="btn" type="button" onclick={copyAll}>Copy diagnostics of all videos</button>
        {#if message}<p class="small muted" aria-live="polite">{message}</p>{/if}
      </div>
    {/if}
  {/if}
</main>

<style>
  .videos-screen {
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

  .title p,
  .info p,
  .videos-screen > p {
    margin: 0;
  }

  .small {
    font-size: var(--text-s);
  }

  .sort {
    align-self: flex-start;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .item {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4) var(--space-1);
  }

  .row {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
  }

  .info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .name {
    margin: 0;
    overflow: hidden;
    font-size: var(--text-m);
    font-weight: var(--weight-medium);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .order {
    flex: none;
    display: flex;
    flex-direction: column;
    margin-right: calc(-1 * var(--space-2));
  }

  .order-btn {
    display: grid;
    place-items: center;
    width: var(--touch);
    height: var(--touch);
    padding: 0;
    border: 0;
    border-radius: var(--radius-s);
    background: transparent;
    color: var(--color-text-2);
  }

  .order-btn:active {
    background: var(--color-neutral-tint);
  }

  .order-btn:disabled {
    color: var(--color-text-3);
    opacity: 0.4;
  }

  .notice {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
  }

  .notice p,
  .item > p {
    margin: 0;
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
    display: inline-block;
    color: var(--color-text-3);
    font-size: var(--text-xl);
    transition: transform var(--duration) var(--ease);
  }

  .chev.open {
    transform: rotate(90deg);
  }

  .all {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
  }
</style>
