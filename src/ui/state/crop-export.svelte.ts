import { createZip, OpfsAssetStore } from '../../storage';
import { cropFileName, cropPixels, displayCrop, type ProgressionItem } from '../../progression';

/** JPEG quality of exported crops (stills are captured at 0.9; re-encoding keeps close to that). */
const QUALITY = 0.92;

export interface CropExportReady {
  /** Which screen prepared it (e.g. "session:<id>"); other screens don't offer it. */
  scope: string;
  images: File[];
  zip: File;
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

/** The full-resolution still of a hold cut to its display crop, as a JPEG. */
async function cropStill(store: OpfsAssetStore, item: ProgressionItem): Promise<Blob | null> {
  if (!item.still) return null;
  const blob = await store.get(item.still.storageKey);
  if (!blob) return null;
  const bitmap = await createImageBitmap(blob);
  try {
    const r = cropPixels(displayCrop(item.hold), bitmap.width, bitmap.height);
    return await encode(r.w, r.h, (ctx) => ctx.drawImage(bitmap, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h));
  } finally {
    bitmap.close();
  }
}

/**
 * Exports the cropped stills of a list of holds: one JPEG per hold (display crop, full
 * resolution), named by date, position, asana, side and rep, as a ZIP or shared as images.
 * Saving needs a fresh tap (iOS), so `prepare` keeps the result in `ready`.
 */
class CropExportState {
  preparing = $state<{ scope: string; done: number; total: number } | null>(null);
  ready = $state.raw<CropExportReady | null>(null);
  error = $state<{ scope: string; message: string } | null>(null);
  private url: string | null = null;

  /** `items` in export order; `name` gives the asana name of a hold; `title` names the ZIP. */
  async prepare(scope: string, items: ProgressionItem[], name: (item: ProgressionItem) => string, title: string) {
    if (this.preparing) return;
    this.ready = null;
    this.error = null;
    const store = new OpfsAssetStore();
    const digits = Math.max(2, String(items.length).length);
    const images: File[] = [];
    let skipped = 0;
    this.preparing = { scope, done: 0, total: items.length };
    try {
      for (const [i, item] of items.entries()) {
        const jpeg = await cropStill(store, item);
        if (jpeg) images.push(new File([jpeg], cropFileName(item, name(item), i + 1, digits), { type: 'image/jpeg' }));
        else skipped++;
        this.preparing = { scope, done: i + 1, total: items.length };
      }
      if (!images.length) {
        this.error = { scope, message: 'No full-resolution stills to export yet.' };
        return;
      }
      const zip = await createZip(images.map((f) => ({ name: f.name, data: f })));
      this.ready = { scope, images, zip: new File([zip], `${title}.zip`, { type: 'application/zip' }), skipped };
    } catch (e) {
      this.error = { scope, message: `Export failed: ${(e as Error).message}` };
    } finally {
      this.preparing = null;
    }
  }

  get canShare(): boolean {
    const r = this.ready;
    return !!r && typeof navigator.canShare === 'function' && navigator.canShare({ files: r.images });
  }

  /** Downloads the ZIP (must run in a tap handler). */
  save() {
    const r = this.ready;
    if (!r) return;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(r.zip);
    const a = document.createElement('a');
    a.href = this.url;
    a.download = r.zip.name;
    document.body.append(a);
    a.click();
    a.remove();
  }

  /** Share sheet with the images themselves (iOS: "Save N Images" to Photos). Must run in a tap handler. */
  async share() {
    const r = this.ready;
    if (!r) return;
    try {
      await navigator.share({ files: r.images });
    } catch (e) {
      if ((e as DOMException).name !== 'AbortError') this.error = { scope: r.scope, message: `Sharing failed: ${(e as Error).message}` };
    }
  }

  dismiss() {
    this.ready = null;
    this.error = null;
  }
}

export const cropExport = new CropExportState();
