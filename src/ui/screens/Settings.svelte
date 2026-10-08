<script lang="ts">
  import { onMount } from 'svelte';
  import {
    estimateStorage,
    listOpfs,
    planCleanup,
    removeOpfsPath,
    requestPersistence,
    sampleFileName,
    type CleanupPlan,
    type QuotaProbeResult,
    type StorageEstimateInfo,
  } from '../../storage';
  import { app } from '../state/app.svelte';
  import { router } from '../state/router.svelte';
  import { dialog } from '../state/dialog.svelte';
  import { pipeline } from '../pipeline/controller.svelte';
  import { updates } from '../update.svelte';
  import { copyText, deviceInfo, formatBytes, type DeviceInfo } from '../diagnostics';

  let est = $state<StorageEstimateInfo | null>(null);
  let opfs = $state<number | null>(null);
  let plan = $state<CleanupPlan | null>(null);
  let cleaning = $state(false);
  let cleanMessage = $state<string | null>(null);
  let device = $state<DeviceInfo | null>(null);
  let cap = $state(2e9);
  let probing = $state<number | null>(null);
  let probe = $state<(QuotaProbeResult & { at: string; capBytes: number; before: StorageEstimateInfo | null; after?: StorageEstimateInfo | null }) | null>(null);
  let hevc = $state<Record<string, boolean | string>>({});
  let message = $state<string | null>(null);

  async function refresh() {
    est = await estimateStorage();
    try {
      const entries = await listOpfs();
      opfs = entries.reduce((s, e) => s + Math.max(0, e.size), 0);
      // Read the references straight from the database so nothing referenced is ever planned for removal.
      const [videos, assets] = await Promise.all([app.db.videos.all(), app.db.assets.all()]);
      plan = planCleanup(entries, videos.map((v) => v.id), assets.map((a) => a.storageKey), sampleFileName);
    } catch {
      opfs = null;
      plan = null;
    }
  }

  async function cleanUp() {
    if (!plan || plan.remove.length === 0) return;
    const ok = await dialog.ask({
      title: 'Remove leftover files?',
      message: `${plan.remove.length} file(s), ${formatBytes(plan.removeBytes)}: storage tests and data of deleted videos. Your videos, analyses and labels stay.`,
      options: [
        { id: 'go', label: 'Remove', kind: 'primary' },
        { id: 'cancel', label: 'Cancel', kind: 'quiet' },
      ],
    });
    if (ok !== 'go') return;
    cleaning = true;
    const before = est?.usage ?? null;
    await refresh(); // re-plan against the current database right before deleting
    const removing = plan?.remove ?? [];
    const bytes = plan?.removeBytes ?? 0;
    for (const e of removing) await removeOpfsPath(e.path);
    await refresh();
    cleaning = false;
    cleanMessage = `Removed ${removing.length} file(s), ${formatBytes(bytes)}. Safari's usage estimate: ${formatBytes(before)} → ${formatBytes(est?.usage ?? null)}.`;
  }

  async function checkCodecs() {
    if (typeof VideoDecoder === 'undefined') {
      hevc = { webcodecs: 'not available' };
      return;
    }
    const configs: Record<string, VideoDecoderConfig> = {
      'HEVC Main 10 4K (hvc1)': { codec: 'hvc1.2.4.L153.B0', codedWidth: 3840, codedHeight: 2160 },
      'HEVC Main 10 4K (hev1)': { codec: 'hev1.2.4.L153.B0', codedWidth: 3840, codedHeight: 2160 },
      'HEVC Main 1080p': { codec: 'hvc1.1.6.L123.B0', codedWidth: 1920, codedHeight: 1080 },
      'H.264 High 1080p': { codec: 'avc1.640028', codedWidth: 1920, codedHeight: 1080 },
      'VP9 1080p': { codec: 'vp09.00.40.08', codedWidth: 1920, codedHeight: 1080 },
    };
    const out: Record<string, boolean | string> = {};
    for (const [name, c] of Object.entries(configs)) {
      try {
        out[name] = (await VideoDecoder.isConfigSupported(c)).supported === true;
      } catch (e) {
        out[name] = String(e);
      }
    }
    hevc = out;
  }

  $effect(() => {
    if (app.ready) void refresh();
  });

  onMount(() => {
    device = deviceInfo();
    void checkCodecs();
    void app.db.settings.get<typeof probe>('diag.quotaProbe').then((p) => (probe = p ?? null));
  });

  async function persist() {
    const r = await requestPersistence();
    await app.db.settings.set('persistGranted', r);
    await refresh();
  }

  async function runProbe() {
    const go = await dialog.ask({
      title: 'Measure writable storage?',
      message: `Writes up to ${formatBytes(cap)} of test data, then deletes it. This can take a few minutes.`,
      options: [
        { id: 'go', label: 'Start', kind: 'primary' },
        { id: 'cancel', label: 'Cancel', kind: 'quiet' },
      ],
    });
    if (go !== 'go') return;
    const before = await estimateStorage();
    probing = 0;
    try {
      const r = await pipeline.probeQuota(cap, (b) => (probing = b));
      probe = { ...r, at: new Date().toISOString(), capBytes: cap, before, after: await estimateStorage() };
      await app.db.settings.set('diag.quotaProbe', $state.snapshot(probe));
    } finally {
      probing = null;
      await refresh();
    }
  }

  async function copyAll() {
    const report = {
      app: { version: __APP_VERSION__, builtAt: __BUILT_AT__ },
      device,
      decoders: hevc,
      storage: { estimate: est, opfsBytes: opfs, persistRequested: await app.db.settings.get('persistRequested'), persistGranted: await app.db.settings.get('persistGranted') },
      quotaProbe: probe,
      hdrProbe: await app.db.settings.get('diag.hdrProbe'),
      videos: await Promise.all(
        app.videos.map(async (v) => {
          const a = await app.db.analyses.get(v.id);
          return { video: v, stats: a?.stats ?? null, candidates: a?.candidates.length ?? null };
        }),
      ),
    };
    message = (await copyText(JSON.stringify(report, null, 2))) ? 'Report copied.' : 'Copy failed.';
  }

  async function wipe() {
    const ok = await dialog.ask({
      title: 'Delete all data?',
      message: 'Removes every analysis, stored sample and setting. Original videos are not touched.',
      options: [
        { id: 'delete', label: 'Delete everything', kind: 'danger' },
        { id: 'cancel', label: 'Cancel', kind: 'quiet' },
      ],
    });
    if (ok !== 'delete') return;
    app.store?.close();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('asana-progression');
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
    try {
      const root = await navigator.storage.getDirectory();
      for await (const [name] of (root as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
        await root.removeEntry(name, { recursive: true }).catch(() => {});
      }
    } catch {
      // no OPFS
    }
    location.reload();
  }
</script>

<main class="settings">
  <header class="top">
    <button class="btn quiet back" type="button" onclick={() => router.go({ name: 'home' })}>‹ Videos</button>
  </header>
  <h2>Settings</h2>

  <section class="group">
    <h3 class="section-title">Catalog</h3>
    <button class="btn" type="button" onclick={() => router.go({ name: 'catalog' })}>Asanas and templates ›</button>
    <p class="small muted">Add or edit asanas, and edit the sequence templates used for suggestions.</p>
  </section>

  <section class="group">
    <h3 class="section-title">Clips</h3>
    <div class="segmented" role="radiogroup" aria-label="Clip quality">
      {#each [['720p', '720p'], ['1080p', '1080p'], ['original', 'Original']] as const as [q, label] (q)}
        <button type="button" role="radio" aria-checked={app.clipQuality === q} class:on={app.clipQuality === q} onclick={() => app.setClipQuality(q)}>{label}</button>
      {/each}
    </div>
    <p class="small muted">
      720p and 1080p are re-encoded to H.264. Original copies the recorded video without re-encoding (keeps HDR, starts and ends on
      key frames, larger files). Applies to new captures.
    </p>
  </section>

  <section class="group">
    <h3 class="section-title">Storage</h3>
    <dl class="kv">
      <dt>Quota (estimate)</dt><dd>{formatBytes(est?.quota)}</dd>
      <dt>Usage (estimate)</dt><dd>{formatBytes(est?.usage)}</dd>
      <dt>Files in app storage</dt><dd>{formatBytes(opfs)}</dd>
      <dt>Persistent</dt><dd>{est?.persisted === null || est === null ? 'unknown' : est.persisted ? 'yes' : 'no'}</dd>
    </dl>
    {#if plan}
      <dl class="kv">
        <dt>Kept</dt><dd>{plan.keep.length} file(s), {formatBytes(plan.keep.reduce((s, e) => s + Math.max(0, e.size), 0))}</dd>
        <dt>Leftovers</dt><dd>{plan.remove.length ? `${plan.remove.length} file(s), ${formatBytes(plan.removeBytes)}` : 'none'}</dd>
      </dl>
      {#if plan.remove.length}
        <ul class="leftovers small muted">
          {#each plan.remove as e (e.path)}<li>{e.path} · {formatBytes(e.size)}</li>{/each}
        </ul>
      {/if}
    {/if}
    <p class="small muted">
      Safari's usage estimate can stay high after files are deleted; the file list above is what is actually stored.
    </p>
    <div class="actions">
      <button class="btn" type="button" onclick={cleanUp} disabled={!plan || plan.remove.length === 0 || cleaning || pipeline.running}>
        {cleaning ? 'Removing…' : 'Remove leftovers'}
      </button>
      <button class="btn" type="button" onclick={persist}>Request persistent storage</button>
    </div>
    {#if cleanMessage}<p class="small muted">{cleanMessage}</p>{/if}
    <div class="probe">
      <label class="row">
        <span>Measure writable space up to</span>
        <select bind:value={cap}>
          <option value={1e9}>1 GB</option>
          <option value={2e9}>2 GB</option>
          <option value={5e9}>5 GB</option>
          <option value={20e9}>20 GB</option>
          <option value={1e12}>until full</option>
        </select>
      </label>
      <button class="btn" type="button" onclick={runProbe} disabled={probing !== null || pipeline.running}>
        {probing !== null ? `Writing… ${formatBytes(probing)}` : 'Measure'}
      </button>
      {#if probe}
        <p class="small muted">
          {probe.at.slice(0, 16).replace('T', ' ')}: wrote {formatBytes(probe.bytesWritten)} in {(probe.ms / 1000).toFixed(1)} s,
          stopped by {probe.stoppedBy}{probe.error ? ` (${probe.error})` : ''}. The test file was deleted right away{probe.after
            ? `; Safari's estimate afterwards: ${formatBytes(probe.after.usage)}`
            : ''}.
        </p>
      {/if}
    </div>
  </section>

  <section class="group">
    <h3 class="section-title">Video decoding</h3>
    <dl class="kv">
      {#each Object.entries(hevc) as [k, v] (k)}
        <dt>{k}</dt><dd>{typeof v === 'boolean' ? (v ? 'supported' : 'not supported') : v}</dd>
      {/each}
    </dl>
  </section>

  {#if device}
    <section class="group">
      <h3 class="section-title">Device</h3>
      <dl class="kv">
        <dt>User agent</dt><dd class="small">{device.userAgent}</dd>
        <dt>Screen</dt><dd>{device.screen}</dd>
        <dt>Home Screen app</dt><dd>{device.standalone ? 'yes' : 'no'}</dd>
        <dt>CPU cores</dt><dd>{device.hardwareConcurrency ?? '–'}</dd>
        <dt>WebCodecs</dt><dd>{device.webCodecs ? 'yes' : 'no'}</dd>
        <dt>OffscreenCanvas</dt><dd>{device.offscreenCanvas ? 'yes' : 'no'}</dd>
        <dt>Wake Lock</dt><dd>{device.wakeLock ? 'yes' : 'no'}</dd>
        <dt>OPFS</dt><dd>{device.opfs ? 'yes' : 'no'}</dd>
        <dt>JS heap</dt><dd>{device.jsHeapUsedMb !== null ? `${device.jsHeapUsedMb} MB` : 'not exposed (Safari)'}</dd>
      </dl>
    </section>
  {/if}

  <section class="group">
    <h3 class="section-title">App</h3>
    <dl class="kv">
      <dt>Version</dt><dd class="mono">{__APP_VERSION__}</dd>
      <dt>Built</dt><dd>{__BUILT_AT__.slice(0, 16).replace('T', ' ')} UTC</dd>
      <dt>Update</dt><dd>{updates.available ? `available (${updates.remoteVersion})` : updates.lastChecked ? 'up to date' : 'not checked'}</dd>
    </dl>
    <div class="actions">
      <button class="btn" type="button" onclick={() => updates.check()}>Check for update</button>
      <button class="btn" type="button" onclick={copyAll}>Copy diagnostics report</button>
    </div>
    {#if message}<p class="small muted">{message}</p>{/if}
  </section>

  <section class="group">
    <div class="actions">
      <button class="btn danger" type="button" onclick={wipe} disabled={pipeline.running}>Delete all data</button>
    </div>
  </section>
</main>

<style>
  .settings {
    padding: calc(var(--space-2) + var(--safe-top)) calc(var(--space-4) + var(--safe-right)) calc(var(--space-7) + var(--safe-bottom))
      calc(var(--space-4) + var(--safe-left));
    max-width: 720px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .top {
    margin: 0 calc(-1 * var(--space-3));
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .probe {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    min-height: var(--touch);
    font-size: var(--text-s);
  }

  select {
    min-height: 36px;
    font-size: 16px;
    border: 1px solid var(--color-hairline);
    border-radius: var(--radius-s);
    background: var(--color-surface);
    padding: 0 var(--space-2);
  }

  .small {
    font-size: var(--text-s);
  }

  .segmented {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    padding: 2px;
    border-radius: var(--radius-m);
    background: var(--color-neutral-tint);
  }

  .segmented button {
    min-height: 40px;
    border: 0;
    border-radius: calc(var(--radius-m) - 2px);
    background: transparent;
    font-weight: var(--weight-medium);
    color: var(--color-text-2);
  }

  .segmented button.on {
    background: var(--color-surface);
    color: var(--color-text);
  }

  .leftovers {
    margin: 0;
    padding-left: var(--space-4);
    overflow-wrap: anywhere;
  }
</style>
