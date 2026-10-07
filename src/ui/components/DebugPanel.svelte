<script lang="ts">
  import { buildAnalysisExport, DEFAULT_PARAMS, needsResample, normalizeParams, PARAM_SPECS, type DetectionParams } from '../../detection';
  import { fingerprint, openVideo, type DecoderSupport, type VideoMeta } from '../../source';
  import { deleteFile, sampleFileName } from '../../storage';
  import type { Analysis, Video } from '../../model';
  import { app } from '../state/app.svelte';
  import { router } from '../state/router.svelte';
  import { dialog } from '../state/dialog.svelte';
  import { invalidateSamples, sampleReader } from '../state/samples';
  import { pipeline } from '../pipeline/controller.svelte';
  import { assessHandover, copyText, deviceInfo, formatBytes, shareOrDownload } from '../diagnostics';
  import { formatDuration } from './timeline';

  interface Props {
    video: Video;
    analysis: Analysis | null;
    onchanged: () => void;
  }
  let { video, analysis, onchanged }: Props = $props();

  let params = $state<DetectionParams>({ ...DEFAULT_PARAMS });
  let busy = $state<string | null>(null);
  let message = $state<string | null>(null);
  let support = $state<DecoderSupport | null>(null);

  $effect(() => {
    params = normalizeParams(analysis?.params ?? app.params);
  });

  const meta = $derived(video.meta as unknown as VideoMeta | undefined);
  const handover = $derived(meta ? assessHandover(meta) : null);
  const resample = $derived(analysis ? needsResample(analysis.params, params) : false);
  const stats = $derived(analysis?.stats ?? null);
  const hasFile = $derived(app.files.has(video.id));

  async function rerun() {
    if (!analysis) return;
    busy = 'Re-running detection…';
    message = null;
    try {
      await pipeline.reanalyze(video.id, $state.snapshot(params), (d, t) => (busy = `Re-running detection… ${Math.round((100 * d) / Math.max(1, t))}%`));
      invalidateSamples(video.id);
      await app.refresh();
      onchanged();
      message = 'Detection updated.';
    } catch (e) {
      message = `Failed: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      busy = null;
    }
  }

  async function saveDefault() {
    await app.saveParams($state.snapshot(params));
    message = 'Saved as default for future imports.';
  }

  function reset() {
    params = { ...DEFAULT_PARAMS };
  }

  async function exportJson() {
    if (!analysis) return;
    busy = 'Exporting…';
    try {
      const reader = await sampleReader(video.id, analysis.frameWidth * analysis.frameHeight);
      if (!reader) throw new Error('Stored samples are missing');
      const x = await buildAnalysisExport(
        { sampleHz: analysis.sampleHz, m: analysis.m, C: analysis.C },
        { threshold: analysis.threshold, singleStill: analysis.singleStill, candidates: analysis.candidates, preMerge: analysis.preMerge },
        analysis.params,
        { width: analysis.frameWidth, height: analysis.frameHeight },
        { frame: (i) => reader.read(i) },
        { video: { ...video, meta: undefined }, source: meta ?? null, stats },
      );
      const name = `${video.fileName.replace(/\.[^.]+$/, '')}-analysis.json`;
      await shareOrDownload(name, new Blob([JSON.stringify(x)], { type: 'application/json' }));
    } catch (e) {
      message = `Export failed: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      busy = null;
    }
  }

  async function checkSupport() {
    const src = app.source(video.id);
    if (!src) return;
    support = await (await src).decoderSupport();
  }

  async function attach(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    busy = 'Checking file…';
    try {
      const src = await openVideo(file);
      const fp = await fingerprint(file, src.meta.durationS);
      src.close();
      if (fp !== video.fingerprint) {
        message = 'This is a different video (fingerprint does not match).';
        return;
      }
      app.attachFile(video.id, file);
      message = 'File attached for this session.';
      void checkSupport();
    } catch (e) {
      message = `Cannot read file: ${String(e)}`;
    } finally {
      busy = null;
    }
  }

  async function copyDiagnostics() {
    const report = {
      app: { version: __APP_VERSION__, builtAt: __BUILT_AT__ },
      device: deviceInfo(),
      video: { ...video, meta: undefined },
      source: meta ?? null,
      handover,
      decoderSupport: support,
      processing: stats,
      analysis: analysis
        ? { samples: analysis.sampleCount, frame: `${analysis.frameWidth}×${analysis.frameHeight}`, candidates: analysis.candidates.length, threshold: analysis.threshold, singleStill: analysis.singleStill }
        : null,
      hdrProbe: await app.db.settings.get('diag.hdrProbe'),
      quotaProbe: await app.db.settings.get('diag.quotaProbe'),
    };
    message = (await copyText(JSON.stringify(report, null, 2))) ? 'Diagnostics copied.' : 'Copy failed.';
  }

  async function remove() {
    const ok = await dialog.ask({
      title: 'Delete this video?',
      message: 'Removes the analysis and stored samples. The original video file is not touched.',
      options: [
        { id: 'delete', label: 'Delete', kind: 'danger' },
        { id: 'cancel', label: 'Cancel', kind: 'quiet' },
      ],
    });
    if (ok !== 'delete') return;
    await app.db.analyses.delete(video.id);
    await app.db.jobs.delete(video.id);
    await app.db.videos.delete(video.id);
    await deleteFile(sampleFileName(video.id));
    invalidateSamples(video.id);
    await app.refresh();
    router.go({ name: 'home' }, true);
  }

  $effect(() => {
    if (hasFile && !support) void checkSupport();
  });
</script>

<section class="debug">
  {#if busy || message}<p class="status" aria-live="polite">{busy ?? message}</p>{/if}

  <div class="group">
    <h3 class="section-title">Detection parameters</h3>
    <div class="params">
      {#each PARAM_SPECS as spec (spec.key)}
        <label class="param">
          <span class="plabel">{spec.label}{spec.key === 'sampleHz' || spec.key === 'sampleLongSide' || spec.key === 'pool' ? ' *' : ''}</span>
          <span class="pinput">
            <input type="number" inputmode="decimal" min={spec.min} max={spec.max} step={spec.step} bind:value={params[spec.key]} />
            <span class="unit">{spec.unit ?? ''}</span>
          </span>
        </label>
      {/each}
    </div>
    <p class="faint small">* Sampling parameters apply to the next import (they need decoding again).</p>
    <div class="actions">
      <button class="btn primary" type="button" onclick={rerun} disabled={!analysis || resample || !!busy || pipeline.running}>Re-run detection</button>
      <button class="btn" type="button" onclick={saveDefault} disabled={!!busy}>Save as default</button>
      <button class="btn quiet" type="button" onclick={reset}>Reset</button>
    </div>
    <label class="toggle">
      <input type="checkbox" checked={app.skipNonReference} onchange={(e) => app.setSkipNonReference(e.currentTarget.checked)} />
      Skip non-reference frames while decoding (next imports)
    </label>
  </div>

  <div class="group">
    <h3 class="section-title">Export</h3>
    <div class="actions">
      <button class="btn" type="button" onclick={exportJson} disabled={!analysis || !!busy}>Export analysis JSON</button>
      <button class="btn" type="button" onclick={copyDiagnostics}>Copy diagnostics</button>
    </div>
  </div>

  {#if meta}
    <div class="group">
      <h3 class="section-title">Source</h3>
      <dl class="kv">
        <dt>File</dt><dd>{meta.fileName} · {meta.fileType || 'no type'} · {formatBytes(meta.fileSize)}</dd>
        <dt>Container</dt><dd>{meta.mimeType}</dd>
        <dt>Codec</dt><dd>{meta.profile ?? meta.codec} ({meta.codecString})</dd>
        <dt>Resolution</dt><dd>{meta.codedWidth}×{meta.codedHeight}, rotation {meta.rotation}°</dd>
        <dt>Frame rate</dt><dd>{meta.fps ?? '–'} fps</dd>
        <dt>Duration</dt><dd>{formatDuration(meta.durationS)}</dd>
        <dt>Bitrate</dt><dd>{meta.averageBitrate ? `${(meta.averageBitrate / 1e6).toFixed(1)} Mbit/s` : '–'}</dd>
        <dt>Colour</dt><dd>{meta.color?.transfer ? `${meta.color.primaries ?? '?'} / ${meta.color.transfer} / ${meta.color.matrix ?? '?'}` : '–'}{meta.hdr ? ' (HDR)' : ''}</dd>
        <dt>QuickTime date</dt><dd>{meta.quicktimeCreationDate ?? '–'}</dd>
        <dt>mvhd creation</dt><dd>{meta.mvhdCreationTime ?? '–'}</dd>
        <dt>Recorded at</dt><dd>{meta.recordedAt ?? '–'} ({meta.recordedAtSource})</dd>
        <dt>Device</dt><dd>{[meta.make, meta.model, meta.software].filter(Boolean).join(' · ') || '–'}</dd>
        <dt>Handover</dt><dd>{handover?.verdict} — {handover?.reasons.join('; ')}</dd>
        <dt>Decoder</dt>
        <dd>
          {#if support}
            {support.supported ? 'supported' : 'NOT supported'} · {Object.entries(support.variants ?? {}).map(([k, v]) => `${k}: ${v ? 'yes' : 'no'}`).join(', ')}
          {:else}
            {hasFile ? 'checking…' : 'attach the file to check'}
          {/if}
        </dd>
      </dl>
    </div>
  {/if}

  {#if stats}
    <div class="group">
      <h3 class="section-title">Processing</h3>
      <dl class="kv">
        <dt>Wall time</dt><dd>{formatDuration(stats.decodeWallMs / 1000)}</dd>
        <dt>Speed</dt><dd>{stats.realtimeFactor.toFixed(2)}× real time</dd>
        <dt>Frames decoded</dt><dd>{stats.framesDecoded.toLocaleString()} ({(stats.framesDecoded / Math.max(1e-3, stats.decodeWallMs / 1000)).toFixed(0)} fps)</dd>
        <dt>Packets skipped</dt><dd>{stats.packetsSkipped.toLocaleString()} of {stats.packetsRead.toLocaleString()} {stats.skipNonReference ? '' : '(skipping off)'}</dd>
        <dt>Frame → gray</dt><dd>{analysis ? (stats.convertMs / Math.max(1, analysis.sampleCount)).toFixed(1) : '–'} ms per sample</dd>
        <dt>Resumed</dt><dd>{stats.resumedCount}×</dd>
        <dt>Samples</dt><dd>{analysis?.sampleCount.toLocaleString()} × {analysis?.frameWidth}×{analysis?.frameHeight} px = {formatBytes((analysis?.sampleCount ?? 0) * (analysis?.frameWidth ?? 0) * (analysis?.frameHeight ?? 0))}</dd>
        <dt>Threshold C</dt><dd>{analysis?.threshold.toFixed(3)}{analysis?.singleStill ? ' (single-still clip)' : ''}</dd>
      </dl>
    </div>
  {/if}

  <div class="group">
    <div class="actions">
      {#if !hasFile}
        <label class="btn">
          Attach file
          <input class="visually-hidden" type="file" accept="video/*" onchange={attach} />
        </label>
      {/if}
      <button class="btn danger" type="button" onclick={remove}>Delete video</button>
    </div>
  </div>
</section>

<style>
  .debug {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .status {
    font-size: var(--text-s);
    color: var(--color-accent-strong);
  }

  .params {
    display: flex;
    flex-direction: column;
  }

  .param {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    min-height: var(--touch);
    border-bottom: 1px solid var(--color-hairline);
    font-size: var(--text-s);
  }

  .pinput {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex: none;
  }

  .pinput input {
    width: 76px;
    min-height: 36px;
    padding: 0 var(--space-2);
    border: 1px solid var(--color-hairline);
    border-radius: var(--radius-s);
    background: var(--color-surface);
    font-size: 16px; /* prevents iOS zoom on focus */
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .unit {
    width: 64px;
    color: var(--color-text-3);
    font-size: var(--text-xs);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .toggle {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--touch);
    font-size: var(--text-s);
  }

  .small {
    font-size: var(--text-xs);
  }
</style>
