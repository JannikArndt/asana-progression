import { holdFromCandidate, nudgeBest, sortCandidates } from '../../labeling';
import type { Box, Hold, Video } from '../../model';
import { fingerprint, openVideo } from '../../source';
import { formatBytes } from '../diagnostics';
import { formatRecordedAt } from '../format';
import { app } from './app.svelte';
import { capture } from './capture.svelte';
import { dialog } from './dialog.svelte';
import { attachSummary, matchFiles, type FileMatch } from './file-match';
import { missingPoseFrames } from './session-data';

async function probe(file: File): Promise<{ durationS: number; recordedAt: string | null }> {
  const src = await openVideo(file);
  try {
    return { durationS: src.meta.durationS, recordedAt: src.meta.recordedAt };
  } finally {
    src.close();
  }
}

/** Asks whether a converted copy of a video may stand in for it (it is the same recording). */
async function useConverted(m: Extract<FileMatch, { kind: 'converted' }>): Promise<boolean> {
  const v = m.video;
  const choice = await dialog.ask({
    title: 'Use a converted copy?',
    message:
      `${m.file.name} looks like ${v.fileName} (${formatRecordedAt(v.recordedAt)}, same length), but it is a different file ` +
      `(${formatBytes(m.file.size)} instead of ${formatBytes(v.fileSize)}): it was probably converted when picked. Stills and clips from it can look worse. ` +
      'To pick the original, set Format to “Current” in the photo picker’s options (iOS 18: the control icon at the bottom right; iOS 17: Options).',
    options: [
      { id: 'use', label: 'Use this copy', kind: 'primary' },
      { id: 'cancel', label: 'Cancel', kind: 'quiet' },
    ],
  });
  return choice === 'use';
}

/** Work that waited for a video's file: stills and clips of its labeled holds, poses of its candidates' best frames. */
export async function afterAttach(videoId: string): Promise<void> {
  capture.request(app.holds.filter((h) => h.videoId === videoId));
  const a = await app.db.analyses.get(videoId);
  const frames = a ? missingPoseFrames(a) : [];
  if (frames.length) capture.requestFramePoses(videoId, frames);
}

/**
 * Attaches picked files to the imported videos they are (any order, any session; matched by
 * fingerprint, `file-match.ts`), then captures the missing stills and clips of their labeled holds
 * and the missing poses of their candidates' best frames. A converted copy is used only after
 * asking. `expected`: the videos the screen asked for (for the message). Returns the attached
 * videos and one line for the user.
 */
export async function attachPicked(files: File[], expected: readonly Video[] = []): Promise<{ attached: Video[]; message: string }> {
  await app.whenReady();
  const matches = await matchFiles(files, app.videos, { fingerprint, probe });
  const attached: Video[] = [];
  const rest: FileMatch[] = [];
  for (const m of matches) {
    if (m.kind === 'video' || (m.kind === 'converted' && (await useConverted(m)))) {
      app.attachFile(m.video.id, m.file);
      attached.push(m.video);
    } else rest.push(m);
  }
  for (const v of attached) await afterAttach(v.id);
  return { attached, message: attachSummary(attached, rest, new Set(expected.map((v) => v.id))) };
}

/** Manual crop override (null removes it: the automatic crop or the full frame is shown). */
export async function setManualCrop(holdId: string, manual: Box | null): Promise<void> {
  const hold = app.holds.find((h) => h.id === holdId);
  if (!hold) return;
  const { manual: _, ...rest } = hold.crop;
  const updated: Hold = { ...hold, crop: manual ? { ...rest, manual } : rest };
  await app.db.holds.put(updated);
  app.upsertHold(updated);
}

/**
 * New best frame for a labeled hold outside the review screen (hold viewer): updates its review
 * candidate and the hold, then re-captures the still (needs the video file, else "re-attach").
 */
export async function chooseBestFrame(holdId: string, bestS: number): Promise<void> {
  const hold = app.holds.find((h) => h.id === holdId);
  if (!hold) return;
  let updated: Hold = { ...hold, bestS: Math.min(hold.endS, Math.max(hold.startS, bestS)) };
  const analysis = await app.updateAnalysis(hold.videoId, (a) => {
    const candidate = a.candidates.find((c) => c.holdId === holdId);
    if (!candidate) return null;
    const next = nudgeBest(candidate, bestS);
    return { ...a, candidates: sortCandidates(a.candidates.map((c) => (c.id === candidate.id ? next : c))) };
  });
  const moved = analysis?.candidates.find((c) => c.holdId === holdId);
  if (moved) updated = holdFromCandidate(hold, moved);
  await app.db.holds.put(updated);
  app.upsertHold(updated);
  capture.request([updated]);
}
