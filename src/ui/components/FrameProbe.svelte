<script lang="ts">
  import { onMount } from 'svelte';
  import { describeFrame, drawRotated, rotatedSize, toneMapHlgFrame, type FrameDescription } from '../../source';
  import { app } from '../state/app.svelte';
  import { formatTime } from './timeline';

  interface Props {
    videoId: string;
    timestampS: number;
    onclose: () => void;
  }
  let { videoId, timestampS, onclose }: Props = $props();

  let srgb: HTMLCanvasElement;
  let p3: HTMLCanvasElement;
  let tone: HTMLCanvasElement;
  let videoEl = $state<HTMLVideoElement | null>(null);
  let status = $state<'loading' | 'ready' | 'error'>('loading');
  let error = $state('');
  let desc = $state<FrameDescription | null>(null);
  let decodeMs = $state(0);
  let toneReason = $state<string | null>(null);
  let ranges = $state<Record<string, string>>({});
  let videoUrl = $state<string | null>(null);
  let verdict = $state<string | null>(null);
  let saved = $state(false);

  const LONG_SIDE = 1600;

  /** 1st–99th percentile of luma, as a quick "washed out?" indicator. */
  function lumaRange(c: HTMLCanvasElement): string {
    const ctx = c.getContext('2d');
    if (!ctx || !c.width) return '–';
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const hist = new Uint32Array(256);
    let n = 0;
    for (let i = 0; i < d.length; i += 16) {
      hist[(77 * d[i]! + 150 * d[i + 1]! + 29 * d[i + 2]!) >> 8]!++;
      n++;
    }
    let acc = 0;
    let lo = 0;
    let hi = 255;
    for (let v = 0; v < 256; v++) {
      acc += hist[v]!;
      if (acc < n * 0.01) lo = v + 1;
      if (acc <= n * 0.99) hi = v;
    }
    return `${lo}–${hi}`;
  }

  onMount(() => {
    let closed = false;
    void (async () => {
      const src = app.source(videoId);
      const file = app.files.get(videoId);
      if (!src || !file) {
        status = 'error';
        error = 'Select the video file again (Debug → Attach file) to see full-resolution frames.';
        return;
      }
      try {
        const source = await src;
        const t0 = performance.now();
        const ef = await source.frameAt(timestampS);
        decodeMs = performance.now() - t0;
        if (!ef || closed) {
          ef?.frame.close();
          if (!ef) throw new Error('No frame at this time');
          return;
        }
        try {
          desc = describeFrame(ef.frame);
          const r = rotatedSize(ef.frame.displayWidth, ef.frame.displayHeight, ef.rotation);
          const k = Math.min(1, LONG_SIDE / Math.max(r.width, r.height));
          const w = Math.round(r.width * k);
          const h = Math.round(r.height * k);
          for (const [canvas, colorSpace] of [
            [srgb, 'srgb'],
            [p3, 'display-p3'],
          ] as const) {
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d', { colorSpace });
            if (ctx) drawRotated(ctx, ef.frame, ef.rotation, w, h);
          }
          const tm = await toneMapHlgFrame(ef.frame, LONG_SIDE);
          if ('image' in tm) {
            const tmp = document.createElement('canvas');
            tmp.width = tm.image.width;
            tmp.height = tm.image.height;
            tmp.getContext('2d')?.putImageData(tm.image, 0, 0);
            const tr = rotatedSize(tm.image.width, tm.image.height, ef.rotation);
            tone.width = tr.width;
            tone.height = tr.height;
            const ctx = tone.getContext('2d');
            if (ctx) drawRotated(ctx, tmp, ef.rotation, tr.width, tr.height);
            toneReason = null;
          } else {
            toneReason = tm.reason;
          }
          ranges = { srgb: lumaRange(srgb), p3: lumaRange(p3), ...(toneReason ? {} : { tone: lumaRange(tone) }) };
        } finally {
          ef.frame.close();
        }
        videoUrl = URL.createObjectURL(file);
        status = 'ready';
      } catch (e) {
        status = 'error';
        error = e instanceof Error ? e.message : String(e);
      }
    })();
    return () => {
      closed = true;
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  });

  function seekVideo() {
    if (videoEl) videoEl.currentTime = timestampS;
  }

  async function save() {
    await app.db.settings.set('diag.hdrProbe', {
      at: new Date().toISOString(),
      videoId,
      timestampS,
      frame: desc ? { ...desc } : null,
      decodeMs: Math.round(decodeMs),
      lumaRanges: { ...ranges },
      toneMapAvailable: toneReason === null,
      toneMapReason: toneReason,
      verdict,
    });
    saved = true;
  }
</script>

<div class="overlay" role="dialog" aria-modal="true" aria-label="Full-resolution frame">
  <header>
    <span class="tabular">Frame at {formatTime(timestampS)}</span>
    <button class="btn quiet close" type="button" onclick={onclose}>Done</button>
  </header>
  <div class="scroll">
    {#if status === 'loading'}<p class="note">Decoding…</p>{/if}
    {#if status === 'error'}<p class="note">{error}</p>{/if}

    <figure>
      <canvas bind:this={srgb}></canvas>
      <figcaption>Canvas 2D, sRGB · luma {ranges.srgb ?? '–'}</figcaption>
    </figure>
    <figure>
      <canvas bind:this={p3}></canvas>
      <figcaption>Canvas 2D, Display P3 · luma {ranges.p3 ?? '–'}</figcaption>
    </figure>
    <figure class:hidden={toneReason !== null && status === 'ready'}>
      <canvas bind:this={tone}></canvas>
      <figcaption>Software HLG → SDR tone map · luma {ranges.tone ?? '–'}</figcaption>
    </figure>
    {#if toneReason}<p class="note">Software tone map unavailable: {toneReason}.</p>{/if}
    {#if videoUrl}
      <figure>
        <!-- svelte-ignore a11y_media_has_caption -->
        <video bind:this={videoEl} src={videoUrl} muted playsinline preload="auto" onloadedmetadata={seekVideo}></video>
        <figcaption>Native &lt;video&gt; (reference)</figcaption>
      </figure>
    {/if}

    {#if desc}
      <dl class="kv">
        <dt>Pixel format</dt><dd>{desc.format ?? 'opaque (null)'}</dd>
        <dt>Coded size</dt><dd>{desc.codedWidth}×{desc.codedHeight}</dd>
        <dt>Primaries</dt><dd>{desc.primaries ?? '–'}</dd>
        <dt>Transfer</dt><dd>{desc.transfer ?? '–'}</dd>
        <dt>Matrix</dt><dd>{desc.matrix ?? '–'}</dd>
        <dt>Full range</dt><dd>{String(desc.fullRange)}</dd>
        <dt>Seek + decode</dt><dd>{Math.round(decodeMs)} ms</dd>
      </dl>
      <fieldset>
        <legend>Which canvas matches the native video?</legend>
        {#each [['srgb', 'sRGB canvas'], ['p3', 'P3 canvas'], ['tone', 'Software tone map'], ['none', 'All look washed out / wrong']] as [id, label] (id)}
          <label class="choice"><input type="radio" name="verdict" value={id} bind:group={verdict} /> {label}</label>
        {/each}
      </fieldset>
      <button class="btn" type="button" onclick={save} disabled={!verdict}>{saved ? 'Saved to diagnostics' : 'Save HDR result'}</button>
    {/if}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: flex;
    flex-direction: column;
    background: var(--color-bg);
    padding-top: var(--safe-top);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 var(--space-2) 0 var(--space-4);
    border-bottom: 1px solid var(--color-hairline);
    min-height: var(--touch);
  }

  .scroll {
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    padding: var(--space-4) var(--space-4) calc(var(--space-7) + var(--safe-bottom));
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  figure {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  figure.hidden {
    display: none;
  }

  canvas,
  video {
    width: 100%;
    height: auto;
    border-radius: var(--radius-m);
    background: var(--color-neutral-tint);
  }

  figcaption,
  .note {
    font-size: var(--text-s);
    color: var(--color-text-2);
  }

  fieldset {
    border: 1px solid var(--color-hairline);
    border-radius: var(--radius-m);
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
  }

  legend {
    font-size: var(--text-s);
    color: var(--color-text-2);
  }

  .choice {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--touch);
  }
</style>
