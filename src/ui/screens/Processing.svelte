<script lang="ts">
  import TimelineGraph from '../components/TimelineGraph.svelte';
  import { formatDuration, formatTime } from '../components/timeline';
  import { pipeline } from '../pipeline/controller.svelte';
  import { importQueue } from '../import.svelte';
  import { router } from '../state/router.svelte';
  import { formatBytes } from '../diagnostics';

  // After a reload nothing is running any more (interrupted jobs are offered on Home).
  $effect(() => {
    if (pipeline.status === 'idle') router.go({ name: 'home' }, true);
  });

  const meta = $derived(pipeline.meta);
  const duration = $derived(meta?.durationS ?? 0);
  const progress = $derived(duration > 0 ? Math.min(1, pipeline.mediaTimeS / duration) : 0);
  const s = $derived(pipeline.sampler);
  const skippedPct = $derived(s && s.packetsRead ? Math.round((100 * s.packetsSkipped) / s.packetsRead) : 0);
  const decodeFps = $derived(s && s.wallMs > 0 ? s.framesDecoded / (s.wallMs / 1000) : 0);
  const convertMs = $derived(s && s.samplesEmitted ? s.convertMs / s.samplesEmitted : 0);
  const statusText = $derived(
    pipeline.status === 'detecting'
      ? 'Finding holds…'
      : pipeline.status === 'done'
        ? 'Done'
        : pipeline.status === 'cancelled'
          ? 'Stopped — import the same file again to resume'
          : pipeline.status === 'error'
            ? 'Stopped with an error'
            : meta
              ? 'Processing'
              : 'Opening…',
  );
</script>

<main class="processing">
  <header class="top">
    <button class="btn quiet back" type="button" onclick={() => router.go({ name: 'home' })} aria-label="Back">‹ Videos</button>
    {#if pipeline.running}
      <button class="btn quiet danger" type="button" onclick={() => pipeline.cancel()}>Stop</button>
    {/if}
  </header>

  <div class="title">
    <h2>{pipeline.fileName || 'Processing'}</h2>
    {#if importQueue.total > 1}<p class="muted">{importQueue.index + 1} of {importQueue.total}</p>{/if}
    {#if meta}
      <p class="muted small">
        {meta.profile ?? meta.codec} · {meta.displayWidth}×{meta.displayHeight} · {meta.fps ?? '?'} fps{meta.hdr ? ` · HDR ${meta.color?.transfer ?? ''}` : ''}
        · {formatDuration(meta.durationS)} · {formatBytes(meta.fileSize)}
      </p>
    {/if}
  </div>

  <section class="progress-block" aria-live="polite">
    <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(progress * 100)}>
      <div class="fill" style:transform="scaleX({progress})"></div>
    </div>
    <div class="line tabular">
      <span>{statusText}</span>
      <span class="muted">{formatTime(pipeline.mediaTimeS)} / {formatTime(duration)}</span>
    </div>
    {#if pipeline.running && pipeline.rate > 0}
      <p class="muted small tabular">
        {pipeline.rate.toFixed(2)}× real time{pipeline.etaS !== null ? ` · about ${formatDuration(pipeline.etaS)} left` : ''}
      </p>
    {/if}
    {#if pipeline.error}
      <p class="error small">{pipeline.error}</p>
    {/if}
    {#if pipeline.retries > 0}
      <p class="muted small">Resumed automatically {pipeline.retries}× after an interruption.</p>
    {/if}
  </section>

  {#if meta}
    <section class="graph card">
      <TimelineGraph
        durationS={duration}
        sampleHz={pipeline.sampleHz}
        values={pipeline.C}
        available={pipeline.cAvailable}
        version={pipeline.cVersion}
        playheadS={pipeline.running ? pipeline.mediaTimeS : null}
      />
    </section>
  {/if}

  {#if s}
    <dl class="kv stats">
      <dt>Decoded frames</dt>
      <dd>{s.framesDecoded.toLocaleString()} ({decodeFps.toFixed(0)} fps)</dd>
      <dt>Packets skipped</dt>
      <dd>
        {#if meta?.codec !== 'hevc' && meta?.codec !== 'avc'}not applicable ({meta?.codec}){:else}{skippedPct}% {pipeline.skipNonReference ? '(non-reference)' : '(skipping off)'}{/if}
      </dd>
      <dt>Frame → gray</dt>
      <dd>{convertMs.toFixed(1)} ms per sample</dd>
      <dt>Decoder queue max</dt>
      <dd>{s.maxDecodeQueue}</dd>
      <dt>Screen wake lock</dt>
      <dd>{pipeline.wakeLock}</dd>
      <dt>Sample storage</dt>
      <dd>{pipeline.opfs ? 'OPFS (resumable)' : 'memory (not resumable)'}</dd>
    </dl>
  {/if}

  {#if pipeline.status === 'done' && pipeline.videoId}
    <button class="btn primary" type="button" onclick={() => router.go({ name: 'video', id: pipeline.videoId! })}>Review holds</button>
  {/if}
</main>

<style>
  .processing {
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
    justify-content: space-between;
    margin: 0 calc(-1 * var(--space-3));
  }

  .title {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .title h2 {
    overflow-wrap: anywhere;
  }

  .small {
    font-size: var(--text-s);
  }

  .progress-block {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .bar {
    height: 6px;
    border-radius: var(--radius-pill);
    background: var(--color-neutral-tint);
    overflow: hidden;
  }

  .fill {
    height: 100%;
    background: var(--color-accent);
    transform-origin: left;
    transition: transform var(--duration) linear;
  }

  .line {
    display: flex;
    justify-content: space-between;
    font-size: var(--text-s);
  }

  .graph {
    padding: var(--space-2) 0 var(--space-1);
    overflow: hidden;
  }

  .error {
    color: var(--color-danger);
  }
</style>
