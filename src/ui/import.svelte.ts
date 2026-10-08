import { fingerprint, openVideo, targetSize, type VideoMeta } from '../source';
import { estimateStorage, requestPersistence, wouldExceedQuota } from '../storage';
import { newId, PRIMARY_SERIES_ID, type Session, type Video } from '../model';
import { dayOf, sessionOfVideo, SHORT_CLIP_S } from './state/session-data';
import { app } from './state/app.svelte';
import { dialog } from './state/dialog.svelte';
import { router } from './state/router.svelte';
import { invalidateSamples } from './state/samples';
import { pipeline } from './pipeline/controller.svelte';
import { capture } from './state/capture.svelte';
import { formatTime } from './components/timeline';

export const importQueue = $state({ index: 0, total: 0 });

function estimateSampleBytes(meta: VideoMeta): number {
  const p = app.params;
  const g = targetSize(meta.displayWidth, meta.displayHeight, p.sampleLongSide);
  const frame = Math.floor(g.width / p.pool) * Math.floor(g.height / p.pool);
  return Math.ceil(meta.durationS * p.sampleHz) * frame;
}

function day(meta: VideoMeta): string {
  return dayOf(meta.recordedAt);
}

function dateLabel(iso: string | null): string {
  if (!iso) return 'unknown date';
  return iso.slice(0, 16).replace('T', ' ');
}

/** Asks which template drives suggestions for a new session. Null = cancelled. */
async function chooseTemplate(meta: VideoMeta): Promise<string | undefined | null> {
  const short = meta.durationS < SHORT_CLIP_S;
  const primary = { id: 'primary', label: 'Primary series', detail: 'Suggest labels in series order.' };
  const none = { id: 'none', label: 'None', detail: 'Single pose or freeform practice: suggest by recent use.' };
  const choice = await dialog.ask({
    title: 'Suggestions for this session',
    message: `${meta.fileName} · ${Math.round(meta.durationS / 60)} min`,
    options: [
      ...(short ? [{ ...none, kind: 'primary' as const }, primary] : [{ ...primary, kind: 'primary' as const }, none]),
      { id: 'cancel', label: 'Cancel', kind: 'quiet' },
    ],
  });
  if (choice === 'cancel') return null;
  return choice === 'primary' ? PRIMARY_SERIES_ID : undefined;
}

/** Import flow: probe → fingerprint → duplicate/resume dialog → session → quota check → process. */
export async function importFiles(files: File[]): Promise<void> {
  const db = app.db;
  importQueue.total = files.length;
  let lastVideoId: string | null = null;
  /** Videos recorded on the same day in one batch share a session. */
  const batchSessions = new Map<string, Session>();
  /** Last video imported per recording day in this batch (to find its session after a combine). */
  const batchVideos = new Map<string, string>();
  const sessionContaining = async (videoId: string | undefined): Promise<Session | undefined> =>
    videoId ? (await db.sessions.findBy('videoIds', videoId))[0] : undefined;
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
          capture.request(app.holds.filter((h) => h.videoId === existing.id));
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

    let newSession: Session | null = null;
    let joinSession: Session | null = null;
    if (!videoId) {
      const recDay = dayOf(meta.recordedAt);
      joinSession = (recDay && batchSessions.get(recDay)) || null;
      const sameDay = !joinSession && recDay ? app.sessions.find((s) => dayOf(s.date) === recDay) : undefined;
      if (sameDay) {
        const choice = await dialog.ask({
          title: 'Same day as an existing session',
          message: `${meta.fileName} was recorded on ${recDay}, like a session you already have.`,
          options: [
            { id: 'join', label: 'Add to that session', detail: 'For clips cut from the same practice.', kind: 'primary' },
            { id: 'new', label: 'New session' },
            { id: 'cancel', label: 'Cancel', kind: 'quiet' },
          ],
        });
        if (choice === 'cancel') continue;
        if (choice === 'join') joinSession = { ...sameDay };
      }
      if (!joinSession) {
        const templateId = await chooseTemplate(meta);
        if (templateId === null) continue;
        newSession = {
          id: newId('ses'),
          date: meta.recordedAt ?? new Date().toISOString(),
          note: '',
          videoIds: [],
          ...(templateId ? { templateId } : {}),
        };
      }
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
      // Re-read the session: it may have been edited, combined or deleted while the previous file processed.
      const target = newSession ?? (await db.sessions.get(joinSession!.id)) ?? (await sessionContaining(batchVideos.get(day(meta)))) ?? null;
      const session: Session = target
        ? { ...($state.snapshot(target) as Session) }
        : { id: newId('ses'), date: meta.recordedAt ?? new Date().toISOString(), note: '', videoIds: [], ...(joinSession?.templateId ? { templateId: joinSession.templateId } : {}) };
      session.videoIds = [...session.videoIds.filter((v) => v !== videoId), videoId];
      await db.sessions.put(session);
      if (day(meta)) {
        batchSessions.set(day(meta), session);
        batchVideos.set(day(meta), videoId);
      }
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
  if (lastVideoId) {
    await app.refresh();
    const s = sessionOfVideo(app.sessions, lastVideoId);
    router.go(s ? { name: 'session', id: s.id } : { name: 'home' }, true);
  }
}
