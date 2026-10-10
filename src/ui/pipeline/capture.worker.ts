/**
 * Capture worker: wires source → capture → crop → asset store. For each hold it renders the
 * still + thumbnail (and the clip), finds the body box on a small preview, writes the files to
 * OPFS and reports asset records back; the main thread stores records and crops in IndexedDB.
 * `recrop` runs pose detection again on stored stills (after the crop algorithm changed).
 */
import { captureHold, previewFromStill, type CapturedAsset } from '../../capture';
import { createMediaPipeCropper, nullCropper, type Cropper } from '../../crop';
import { newId, type Asset } from '../../model';
import { openVideo } from '../../source';
import { OpfsAssetStore } from '../../storage';
import type { CaptureEvent, CaptureRequest } from './capture-protocol';

const scope = self as unknown as {
  postMessage(message: CaptureEvent): void;
  onmessage: ((e: MessageEvent<CaptureRequest>) => void) | null;
};

const store = new OpfsAssetStore();
let cropperPromise: Promise<Cropper> | null = null;
let cropperKind: 'mediapipe' | 'none' | null = null;
let current: AbortController | null = null;

function post(e: CaptureEvent) {
  scope.postMessage(e);
}

function getCropper(kind: 'mediapipe' | 'none', baseUrl: string): Promise<Cropper> {
  if (cropperPromise && cropperKind === kind) return cropperPromise;
  cropperKind = kind;
  if (kind === 'none') return (cropperPromise = Promise.resolve(nullCropper));
  const url = (p: string) => new URL(baseUrl + p, self.location.origin).toString();
  cropperPromise = createMediaPipeCropper({
    wasmLoaderUrl: url('mediapipe/vision_wasm_module_internal.js'),
    wasmBinaryUrl: url('mediapipe/vision_wasm_module_internal.wasm'),
    modelUrl: url('models/pose_landmarker_lite.task'),
  }).catch((e) => {
    console.warn('[capture] pose model unavailable, using full frames', e);
    return nullCropper;
  });
  return cropperPromise;
}

function extension(mime: string): string {
  return mime === 'image/jpeg' ? 'jpg' : mime === 'video/mp4' ? 'mp4' : mime.split('/')[1] ?? 'bin';
}

async function save(holdId: string, a: CapturedAsset): Promise<Asset> {
  const id = newId('ast');
  const storageKey = `assets/${id}.${extension(a.mime)}`;
  await store.put(storageKey, a.blob);
  return {
    id,
    holdId,
    kind: a.kind,
    mime: a.mime,
    width: a.width,
    height: a.height,
    bytes: a.blob.size,
    storageKey,
    ...(a.atS !== undefined ? { atS: a.atS } : {}),
    ...(a.startS !== undefined ? { startS: a.startS } : {}),
    ...(a.endS !== undefined ? { endS: a.endS } : {}),
    ...(a.quality ? { quality: a.quality } : {}),
    createdAt: new Date().toISOString(),
  };
}

async function capture(req: Extract<CaptureRequest, { type: 'capture' }>) {
  const { jobId } = req;
  const abort = new AbortController();
  current = abort;
  let cropperName = 'none';
  try {
    const source = await openVideo(req.file);
    const cropper = await getCropper(req.cropper, req.baseUrl);
    cropperName = cropper.name;
    try {
      for (const h of req.holds) {
        if (abort.signal.aborted) break;
        post({ type: 'hold-start', jobId, holdId: h.id });
        try {
          const { assets, preview } = await captureHold(h, source, { clipQuality: req.quality, signal: abort.signal });
          let detection = null;
          if (preview) {
            try {
              detection = await cropper.detect(preview);
            } catch (e) {
              console.warn('[capture] pose detection failed', e);
            } finally {
              preview.close();
            }
          }
          const wanted = assets.filter((a) => (a.kind === 'clip' ? h.clip : h.still));
          const records: Asset[] = [];
          for (const a of wanted) records.push(await save(h.id, a));
          post({
            type: 'hold-done',
            jobId,
            holdId: h.id,
            assets: records,
            crop: detection?.box ?? null,
            posture: detection?.posture ?? null,
            cropper: cropper.name,
          });
        } catch (e) {
          post({ type: 'hold-error', jobId, holdId: h.id, message: e instanceof Error ? e.message : String(e) });
        }
      }
    } finally {
      source.close();
    }
    post({ type: 'done', jobId, cropper: cropperName });
  } catch (e) {
    post({ type: 'error', jobId, message: e instanceof Error ? e.message : String(e) });
  } finally {
    current = null;
  }
}

async function recrop(req: Extract<CaptureRequest, { type: 'recrop' }>) {
  const { jobId } = req;
  const abort = new AbortController();
  current = abort;
  let cropperName = 'none';
  try {
    const cropper = await getCropper(req.cropper, req.baseUrl);
    cropperName = cropper.name;
    for (const h of req.holds) {
      if (abort.signal.aborted) break;
      try {
        const still = await store.get(h.stillKey);
        if (!still) throw new Error('Still file missing');
        const preview = await previewFromStill(still);
        try {
          const detection = await cropper.detect(preview);
          post({ type: 'recrop-done', jobId, holdId: h.id, crop: detection?.box ?? null, cropper: cropper.name });
        } finally {
          preview.close();
        }
      } catch (e) {
        post({ type: 'hold-error', jobId, holdId: h.id, message: e instanceof Error ? e.message : String(e) });
      }
    }
    post({ type: 'done', jobId, cropper: cropperName });
  } catch (e) {
    post({ type: 'error', jobId, message: e instanceof Error ? e.message : String(e) });
  } finally {
    current = null;
  }
}

scope.onmessage = (e) => {
  const req = e.data;
  if (req.type === 'capture') void capture(req);
  else if (req.type === 'recrop') void recrop(req);
  else current?.abort();
};
