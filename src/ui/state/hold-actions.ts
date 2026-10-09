import type { Box, Hold, Video } from '../../model';
import { fingerprint, openVideo } from '../../source';
import { app } from './app.svelte';
import { capture } from './capture.svelte';

/**
 * Re-attaches a picked file to a known video (after checking its fingerprint) and captures the
 * missing stills and clips of its labeled holds. Returns an error message, or null on success.
 */
export async function reattachVideo(video: Video, file: File): Promise<string | null> {
  try {
    const src = await openVideo(file);
    const ok = (await fingerprint(file, src.meta.durationS)) === video.fingerprint;
    src.close();
    if (!ok) return `That is a different video (expected ${video.fileName}).`;
  } catch (err) {
    return `Cannot read the file: ${err instanceof Error ? err.message : String(err)}`;
  }
  app.attachFile(video.id, file);
  capture.request(app.holds.filter((h) => h.videoId === video.id));
  return null;
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
