import type { Box, Hold } from '../../model';
import { app } from './app.svelte';

/** Manual crop override (null removes it: the automatic crop or the full frame is shown). */
export async function setManualCrop(holdId: string, manual: Box | null): Promise<void> {
  const hold = app.holds.find((h) => h.id === holdId);
  if (!hold) return;
  const { manual: _, ...rest } = hold.crop;
  const updated: Hold = { ...hold, crop: manual ? { ...rest, manual } : rest };
  await app.db.holds.put(updated);
  app.upsertHold(updated);
}
