<script lang="ts">
  import TinyFrame from './TinyFrame.svelte';
  import AssetImage from './AssetImage.svelte';
  import type { Asset } from '../../model';
  import type { CaptureStatus } from '../state/capture.svelte';
  import { effectiveCrop } from '../state/capture-plan';
  import { formatDuration, formatTime } from './timeline';
  import type { Suggestion } from '../../labeling';
  import type { SessionEntry } from '../state/session-data';
  import type { RepInfo } from '../../progression';

  interface Props {
    entry: SessionEntry;
    number: number;
    suggestion: Suggestion | undefined;
    nameOf: (asanaId: string) => string;
    frame: { width: number; height: number; hz: number };
    selected: boolean;
    thumb?: Asset | undefined;
    captureStatus?: CaptureStatus | undefined;
    rep?: RepInfo | undefined;
    /** Holds the template expects in place of this card (≥ 2 offers a split). */
    expected?: number | undefined;
    onsplit?: (k: number) => void;
    onselect: () => void;
    onconfirm: () => void;
    onpick: () => void;
    onmore: () => void;
    onrestore: () => void;
  }
  let { entry, number, suggestion, nameOf, frame, selected, thumb, captureStatus, rep, expected, onsplit, onselect, onconfirm, onpick, onmore, onrestore }: Props = $props();
  const statusText: Record<CaptureStatus, string> = {
    queued: 'Waiting to save still…',
    capturing: 'Saving still and clip…',
    done: '',
    error: 'Saving the still failed',
    'needs-file': 'Select the video again to save the still',
  };

  const c = $derived(entry.candidate);
  const status = $derived(c.status === 'labeled' && entry.hold ? 'labeled' : c.status === 'dismissed' ? 'dismissed' : 'open');
  const label = $derived(
    status === 'labeled'
      ? `${nameOf(entry.hold!.asanaId)}${entry.hold!.side ? ` ${entry.hold!.side}` : ''}`
      : suggestion
        ? `${nameOf(suggestion.asanaId)}${suggestion.side ? ` ${suggestion.side}` : ''}`
        : null,
  );
</script>

<article id="card-{entry.key}" class="card review {status}" class:selected data-status={status}>
  <button class="thumb" type="button" onclick={onselect} aria-label="Show hold {number} on the timeline">
    {#if status === 'labeled' && thumb && entry.hold}
      <AssetImage asset={thumb} crop={effectiveCrop(entry.hold)} aspect={frame.width / frame.height} alt="Hold {number}" />
    {:else}
      <TinyFrame
        videoId={entry.videoId}
        frameWidth={frame.width}
        frameHeight={frame.height}
        index={Math.round(c.bestS * frame.hz)}
        alt="Best frame of hold {number}"
      />
    {/if}
  </button>
  <div class="info">
    <div class="meta tabular">
      <span>{formatTime(c.startS)}–{formatTime(c.endS)}</span>
      <span class="faint">· {formatDuration(c.endS - c.startS)}</span>
      <button class="more" type="button" onclick={onmore} aria-label="More actions for hold {number}">•••</button>
    </div>
    {#if status === 'dismissed'}
      <div class="row">
        <span class="faint">Not a pose</span>
        <button class="btn quiet small" type="button" onclick={onrestore}>Restore</button>
      </div>
    {:else if status === 'labeled'}
      <button class="label done" type="button" onclick={onpick}>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
        <span>{label}</span>
        {#if rep && rep.of > 1}<span class="rep tabular" aria-label="rep {rep.rep} of {rep.of}">{rep.rep}/{rep.of}</span>{/if}
      </button>
      {#if captureStatus && statusText[captureStatus]}
        <span class="capture {captureStatus}" data-capture={captureStatus}>{statusText[captureStatus]}</span>
      {:else if captureStatus === 'done'}
        <span class="visually-hidden" data-capture="done">Still saved</span>
      {/if}
    {:else}
      <div class="row">
        <button class="label suggested" type="button" onclick={onpick}>{label ?? 'Choose label…'}</button>
        {#if suggestion}
          <button class="confirm" type="button" onclick={onconfirm} aria-label="Confirm {label}">
            <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </button>
        {/if}
      </div>
      {#if expected && onsplit}
        <button class="hint" type="button" onclick={() => onsplit(expected)}>Template expects {expected} holds here · Split</button>
      {/if}
    {/if}
  </div>
</article>

<style>
  .review {
    display: grid;
    grid-template-columns: minmax(0, 40%) minmax(0, 1fr);
    gap: var(--space-3);
    padding: var(--space-2);
    transition: border-color var(--duration) var(--ease), opacity var(--duration) var(--ease);
    scroll-margin: var(--space-6);
  }

  .review.selected {
    border-color: var(--color-accent);
  }

  .hint {
    align-self: flex-start;
    min-height: var(--touch);
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--color-accent-strong);
    font-size: var(--text-s);
    text-align: left;
  }

  .rep {
    margin-left: var(--space-1);
    padding: 0 var(--space-1);
    border-radius: var(--radius-s);
    background: var(--color-accent-tint);
    font-size: var(--text-s);
    color: var(--color-text-2);
  }

  .review.dismissed {
    opacity: 0.55;
  }

  .thumb {
    padding: 0;
    border: 0;
    background: transparent;
    align-self: center;
  }

  .info {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--space-2);
    min-width: 0;
  }

  .meta {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-s);
    color: var(--color-text-2);
  }

  .more {
    margin-left: auto;
    min-width: var(--touch);
    min-height: 32px;
    border: 0;
    background: transparent;
    color: var(--color-text-3);
    letter-spacing: 1px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .label {
    min-height: var(--touch);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-m);
    font-weight: var(--weight-medium);
    line-height: 1.25;
    text-align: left;
    max-width: 100%;
    overflow-wrap: anywhere;
  }

  .label.suggested {
    flex: 1;
    min-width: 0;
    border: 1px dashed var(--color-accent);
    background: var(--color-surface);
    color: var(--color-accent-strong);
  }

  .label.done {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    align-self: flex-start;
    border: 0;
    background: var(--color-accent-tint);
    color: var(--color-accent-strong);
  }


  .confirm {
    flex: none;
    width: var(--touch);
    height: var(--touch);
    border: 0;
    border-radius: 50%;
    background: var(--color-accent);
    color: var(--color-on-accent);
    display: grid;
    place-items: center;
  }

  .confirm:active {
    background: var(--color-accent-strong);
  }

  .small {
    min-height: 36px;
    padding: 0 var(--space-2);
  }

  .capture {
    font-size: var(--text-xs);
    color: var(--color-text-3);
  }

  .capture.error,
  .capture.needs-file {
    color: var(--color-danger);
  }
</style>
