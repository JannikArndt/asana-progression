import { fingerprint, openVideo, targetSize, type VideoMeta } from '../source';
import { estimateStorage, requestPersistence, wouldExceedQuota } from '../storage';
import { newId, type Video } from '../model';
import { app } from './state/app.svelte';
import { dialog } from './state/dialog.svelte';
import { router } from './state/router.svelte';
import { invalidateSamples } from './state/samples';
import { pipeline } from './pipeline/controller.svelte';
import { formatTime } from './components/timeline';

export const importQueue = $state({ index: 0, total: 0 });

function estimateSampleBytes(meta: VideoMeta): number {
  const p = app.params;
  const g = targetSize(meta.displayWidth, meta.displayHeight, p.sampleLongSide);
  const frame = Math.floor(g.width / p.pool) * Math.floor(g.height / p.pool);
  return Math.ceil(meta.durationS * p.sampleHz) * frame;
}

function dateLabel(iso: string | null): string {
  if (!iso) return 'unknown date';
  return iso.slice(0, 16).replace('T', ' ');
}

/** Import flow: probe → fingerprint → duplicate/resume dialog → quota check → process. */
export async function importFiles(files: File[]): Promise<void> {
  const db = app.db;
  importQueue.total = files.length;
  let lastVideoId: string | null = null;
  for (const [i, file] of files.entries()) {
    importQueue.index = i;
    let meta: VideoMeta;
    try {
      const src = await openVideo(file);
      meta = src.meta;
      src.close();
    } catch (e) {
      await dialog.ask({
        title: 'Cannot read this file',
        message: `${file.name}: ${e instanceof Error ? e.message : String(e)}`,
        options: [{ id: 'ok', label: 'OK', kind: 'primary' }],
      });
      continue;
    }
    console.info('[import]', {
      name: meta.fileName,
      type: meta.fileType,
      size: meta.fileSize,
      codec: meta.codecString,
      profile: meta.profile,
      resolution: `${meta.displayWidth}×${meta.displayHeight}`,
      fps: meta.fps,
      durationS: meta.durationS,
      hdr: meta.hdr,
      recordedAt: meta.recordedAt,
    });
    const fp = await fingerprint(file, meta.durationS);

    let videoId: string | null = null;
    let resume = false;
    let params = $state.snapshot(app.params);
    let skip = app.skipNonReference;

    const job = (await db.jobs.findBy('fingerprint', fp))[0];
    if (job) {
      const choice = await dialog.ask({
        title: 'Resume processing?',
        message: `${file.name} was processed up to ${formatTime(job.nextIndex / job.params.sampleHz)} of ${formatTime(job.durationS)}.`,
        options: [
          { id: 'resume', label: 'Resume', kind: 'primary' },
          { id: 'restart', label: 'Start over' },
          { id: 'cancel', label: 'Cancel', kind: 'quiet' },
        ],
      });
      if (choice === 'cancel') continue;
      videoId = job.videoId;
      resume = choice === 'resume';
      if (resume) {
        params = job.params;
        skip = job.skipNonReference;
      }
    } else {
      const existing = (await db.videos.findBy('fingerprint', fp))[0];
      if (existing) {
        const choice = await dialog.ask({
          title: 'This video was imported before',
          message: `${file.name} matches “${existing.fileName}” recorded ${dateLabel(existing.recordedAt)}.`,
          options: [
            {
              id: 'reuse',
              label: 'Reuse labels and re-capture assets',
              detail: 'Keeps the existing analysis and attaches this file for full-resolution frames.',
              kind: 'primary',
            },
            { id: 'new', label: 'Import as a new session', detail: 'Analyses the video again as a separate entry.' },
            { id: 'cancel', label: 'Cancel', kind: 'quiet' },
          ],
        });
        if (choice === 'cancel') continue;
        if (choice === 'reuse') {
          app.attachFile(existing.id, file);
          if (await db.analyses.get(existing.id)) {
            lastVideoId = existing.id;
            continue;
          }
          videoId = existing.id;
        }
      }
    }

    if (!(await db.settings.get<boolean>('persistRequested'))) {
      const granted = await requestPersistence();
      await db.settings.set('persistRequested', true);
      await db.settings.set('persistGranted', granted);
    }

    const needed = estimateSampleBytes(meta) + 4_000_000;
    const est = await estimateStorage();
    if (wouldExceedQuota(est, needed)) {
      const go = await dialog.ask({
        title: 'Storage almost full',
        message: `Processing ${file.name} needs about ${Math.round(needed / 1e6)} MB, which may exceed the available storage.`,
        options: [
          { id: 'go', label: 'Process anyway' },
          { id: 'cancel', label: 'Cancel', kind: 'quiet' },
        ],
      });
      if (go !== 'go') continue;
    }

    if (!videoId) {
      videoId = newId('vid');
      const video: Video = {
        id: videoId,
        fingerprint: fp,
        fileName: meta.fileName,
        fileSize: meta.fileSize,
        durationS: meta.durationS,
        codec: meta.codecString,
        width: meta.displayWidth,
        height: meta.displayHeight,
        fps: meta.fps,
        recordedAt: meta.recordedAt,
        importedAt: new Date().toISOString(),
        meta: { ...meta } as unknown as Record<string, unknown>,
      };
      await db.videos.put(video);
    }
    app.attachFile(videoId, file);
    await app.refresh();
    const running = pipeline.run({ file, videoId, fingerprint: fp, params, skipNonReference: skip, resume });
    router.go({ name: 'process' });
    const status = await running;
    invalidateSamples(videoId);
    await app.refresh();
    lastVideoId = videoId;
    if (status === 'cancelled' || status === 'error') {
      importQueue.total = 0;
      return;
    }
  }
  importQueue.total = 0;
  if (lastVideoId) router.go({ name: 'video', id: lastVideoId }, true);
}
