<script lang="ts">
  import TinyFrame from './TinyFrame.svelte';
  import RecordedAtSheet from './RecordedAtSheet.svelte';
  import { formatTime } from './timeline';
  import { copyText } from '../diagnostics';
  import type { Video } from '../../model';
  import { app } from '../state/app.svelte';
  import { attachPicked } from '../state/hold-actions';
  import { photosSearchDate, recordedClock } from '../state/file-match';
  import { weakRecordedAt } from '../state/session-data';
  import { formatDay } from '../format';

  interface Props {
    /** The videos whose files are needed. */
    videos: Video[];
    /**
     * After a pick: one line about it (the host shows it, also once the notice around this is gone
     * because every file was found) and the attached videos.
     */
    onresult: (message: string, attached: Video[]) => void;
  }
  let { videos, onresult }: Props = $props();

  /**
   * Helps re-select video files: the date to search for in Photos (copyable), each video's first
   * frame, time and length to recognise it, and one picker for all of them in any order (files
   * are matched to their videos by content).
   */
  const days = $derived.by(() => {
    const out: Array<{ query: string; videos: Video[] }> = [];
    // The app's copy: a recording time set here shows at once.
    for (const v of videos.map((x) => app.videos.find((y) => y.id === x.id) ?? x)) {
      // Only the camera's date finds the video in Photos; an export or file date is no help.
      const query = weakRecordedAt(v) ? '' : photosSearchDate(v.recordedAt);
      const day = out.find((d) => d.query === query);
      if (day) day.videos.push(v);
      else out.push({ query, videos: [v] });
    }
    return out;
  });

  let busy = $state(false);
  /** Video whose recording time is being set (null = sheet closed). */
  let dating = $state<Video | null>(null);
  let copied = $state<string | null>(null);

  async function copy(query: string) {
    copied = (await copyText(query)) ? query : null;
  }

  async function pick(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    if (!files.length) return;
    busy = true;
    try {
      const r = await attachPicked(files, videos);
      onresult(r.message, r.attached);
    } finally {
      busy = false;
    }
  }
</script>

<div class="finder">
  {#each days as day (day.query)}
    {#if !day.query}
      <p class="small muted">
        Recording date unknown: the {day.videos.length === 1 ? 'file only carries' : 'files only carry'} the date of an export or conversion. Set the date
        Photos shows for {day.videos.length === 1 ? 'it' : 'them'} to search for it.
      </p>
    {:else}
      <div class="search">
        <span class="small muted">Search Photos for</span>
        <button class="btn query" type="button" onclick={() => copy(day.query)} aria-label="Copy {day.query}">
          <span>{day.query}</span>
          <span class="small copy" aria-hidden="true">{copied === day.query ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
    {/if}
    <ul class="videos">
      {#each day.videos as video (video.id)}
        {@const summary = app.summaries[video.id]}
        <li class="video" data-needed-video={video.id}>
          <div class="frame">
            {#if summary}
              <TinyFrame videoId={video.id} frameWidth={summary.frameWidth} frameHeight={summary.frameHeight} index={0} alt="First frame of {video.fileName}" />
            {/if}
          </div>
          <div class="info small">
            {#if day.query}
              <span class="tabular">{[recordedClock(video.recordedAt), formatTime(video.durationS)].filter(Boolean).join(' · ')}</span>
            {:else}
              <span class="tabular">{formatTime(video.durationS)}{#if video.recordedAt}<span class="faint"> · file date {formatDay(video.recordedAt)}</span>{/if}</span>
            {/if}
            <span class="name muted">{video.fileName}</span>
          </div>
          {#if !day.query}
            <button class="btn quiet set" type="button" onclick={() => (dating = video)}>Set date…</button>
          {/if}
        </li>
      {/each}
    </ul>
  {/each}
  <label class="btn primary pick" class:busy aria-disabled={busy}>
    {busy ? 'Checking…' : videos.length === 1 ? 'Select video' : `Select ${videos.length} videos`}
    <input class="visually-hidden" type="file" accept="video/*" multiple disabled={busy} onchange={pick} />
  </label>
  {#if videos.length > 1}<p class="small faint hint">Pick them together, in any order: each file finds its video.</p>{/if}
</div>

{#if dating}
  <RecordedAtSheet video={dating} onclose={() => (dating = null)} />
{/if}

<style>
  .finder {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .small {
    font-size: var(--text-s);
  }

  .finder p {
    margin: 0;
  }

  .search {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .query {
    gap: var(--space-3);
    padding: 0 var(--space-3);
  }

  .copy {
    color: var(--color-accent-strong);
  }

  .videos {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .video {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .frame {
    flex: none;
    width: 44px;
  }

  .info {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }

  .set {
    flex: none;
  }


  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pick {
    align-self: flex-start;
  }

  .pick.busy {
    opacity: 0.6;
  }
</style>
