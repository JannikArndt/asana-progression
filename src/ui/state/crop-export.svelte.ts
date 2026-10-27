import { createZip, OpfsAssetStore } from '../../storage';
import { withPhotoMetadata } from '../../capture';
import { cropFileName, cropPixels, displayCrop, type ProgressionItem } from '../../progression';
import { app } from './app.svelte';
import { holdPhotoMetadata } from './photo-meta';

/** JPEG quality of exported crops (stills are captured at 0.9; re-encoding keeps close to that). */
const QUALITY = 0.92;
const METADATA_KEY = 'asana.export.metadata';

/** A cropped photo in both variants: without metadata (for sharing) and with everything known. */
export interface PreparedPhoto {
  plain: File;
  tagged: File;
  width: number;
  height: number;
}

export interface CropExportReady {
  /** Which screen prepared it (e.g. "session:<id>"); other screens don't offer it. */
  scope: string;
  photos: PreparedPhoto[];
  /** The photos as a ZIP, without and with metadata (built ahead: saving must follow the tap directly). */
  zip: { plain: File; tagged: File };
  /** Holds without a full-resolution still (not exported). */
  skipped: number;
}

async function encode(width: number, height: number, draw: (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) => void): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D canvas');
    draw(ctx);
    return canvas.convertToBlob({ type: 'image/jpeg', quality: QUALITY });
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas');
  draw(ctx);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('JPEG encoding failed'))), 'image/jpeg', QUALITY));
}

const store = new OpfsAssetStore();

/**
 * The hold's full-resolution still (the whole video frame) cut to its current display crop, as a
 * JPEG at the crop's native size. Null without a still.
 */
async function cropStill(item: ProgressionItem): Promise<{ blob: Blob; width: number; height: number } | null> {
  if (!item.still) return null;
  const blob = await store.get(item.still.storageKey);
  if (!blob) return null;
  const bitmap = await createImageBitmap(blob);
  try {
    const r = cropPixels(displayCrop(item.hold), bitmap.width, bitmap.height);
    return { blob: await encode(r.w, r.h, (ctx) => ctx.drawImage(bitmap, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h)), width: r.w, height: r.h };
  } finally {
    bitmap.close();
  }
}

/** The photo of a hold as shown (the latest hold record, so a crop edited a moment ago counts). */
export async function preparePhoto(item: ProgressionItem, position?: number, digits?: number): Promise<PreparedPhoto | null> {
  const hold = app.holds.find((h) => h.id === item.hold.id) ?? item.hold;
  const current = { ...item, hold };
  const jpeg = await cropStill(current);
  if (!jpeg) return null;
  const asana = app.asanas.find((a) => a.id === hold.asanaId);
  const meta = holdPhotoMetadata({
    item: current,
    asana,
    video: app.videos.find((v) => v.id === hold.videoId),
    session: app.sessions.find((s) => s.id === hold.sessionId),
    href: location.href,
    width: jpeg.width,
    height: jpeg.height,
  });
  const name = cropFileName(current, asana?.name ?? 'asana', position, digits);
  return {
    plain: new File([jpeg.blob], name, { type: 'image/jpeg' }),
    tagged: new File([await withPhotoMetadata(jpeg.blob, meta)], name, { type: 'image/jpeg' }),
    width: jpeg.width,
    height: jpeg.height,
  };
}

/** Downloads a file (must run in a tap handler). */
export function saveFile(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function canShareFiles(files: File[]): boolean {
  return files.length > 0 && typeof navigator.canShare === 'function' && navigator.canShare({ files });
}

/** Share sheet with the files (iOS: "Save Image(s)" to Photos). Must run in a tap handler; null = shared or cancelled. */
export async function shareFiles(files: File[]): Promise<string | null> {
  try {
    await navigator.share({ files });
    return null;
  } catch (e) {
    return (e as DOMException).name === 'AbortError' ? null : `Sharing failed: ${(e as Error).message}`;
  }
}

/**
 * Exports the cropped stills of a list of holds: one JPEG per hold (display crop, full
 * resolution), named by date, position, asana, side and rep, as a ZIP or shared as images, with
 * or without metadata. Saving needs a fresh tap (iOS), so `prepare` keeps the result in `ready`.
 */
class CropExportState {
  preparing = $state<{ scope: string; done: number; total: number } | null>(null);
  ready = $state.raw<CropExportReady | null>(null);
  error = $state<{ scope: string; message: string } | null>(null);
  /** Date, place, camera, pose name and link in the files (remembered on this device). */
  metadata = $state(readMetadataChoice());

  setMetadata(on: boolean) {
    this.metadata = on;
    try {
      localStorage.setItem(METADATA_KEY, on ? '1' : '0');
    } catch {
      /* private mode */
    }
  }

  /** `items` in export order; `title` names the ZIP. */
  async prepare(scope: string, items: ProgressionItem[], title: string) {
    if (this.preparing) return;
    this.ready = null;
    this.error = null;
    const digits = Math.max(2, String(items.length).length);
    const photos: PreparedPhoto[] = [];
    let skipped = 0;
    this.preparing = { scope, done: 0, total: items.length };
    try {
      for (const [i, item] of items.entries()) {
        const photo = await preparePhoto(item, i + 1, digits);
        if (photo) photos.push(photo);
        else skipped++;
        this.preparing = { scope, done: i + 1, total: items.length };
      }
      if (!photos.length) {
        this.error = { scope, message: 'No full-resolution stills to export yet.' };
        return;
      }
      const zip = async (files: File[]) => new File([await createZip(files.map((f) => ({ name: f.name, data: f })))], `${title}.zip`, { type: 'application/zip' });
      this.ready = { scope, photos, zip: { plain: await zip(photos.map((p) => p.plain)), tagged: await zip(photos.map((p) => p.tagged)) }, skipped };
    } catch (e) {
      this.error = { scope, message: `Export failed: ${(e as Error).message}` };
    } finally {
      this.preparing = null;
    }
  }

  /** The prepared files in the chosen variant. */
  get files(): File[] {
    return this.ready?.photos.map((p) => (this.metadata ? p.tagged : p.plain)) ?? [];
  }

  get zip(): File | null {
    return this.ready ? this.ready.zip[this.metadata ? 'tagged' : 'plain'] : null;
  }

  get canShare(): boolean {
    return canShareFiles(this.files);
  }

  /** Downloads the ZIP (must run in a tap handler). */
  save() {
    if (this.zip) saveFile(this.zip);
  }

  async share() {
    const r = this.ready;
    if (!r) return;
    const message = await shareFiles(this.files);
    if (message) this.error = { scope: r.scope, message };
  }

  dismiss() {
    this.ready = null;
    this.error = null;
  }
}

function readMetadataChoice(): boolean {
  try {
    return localStorage.getItem(METADATA_KEY) === '1';
  } catch {
    return false;
  }
}

export const cropExport = new CropExportState();
