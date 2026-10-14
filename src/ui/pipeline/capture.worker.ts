/**
 * Capture worker: wires source → capture → crop → asset store. For each hold it renders the
 * still + thumbnail (and the clip), finds the body box on a small preview, writes the files to
 * OPFS and reports asset records back; the main thread stores records and crops in IndexedDB.
 * `recrop` runs pose detection again on stored stills (after the crop algorithm changed); `pose`
 * returns the landmarks of one stored still for the viewer's overlay; `frame-poses` the compact
 * poses of review candidates' best frames (both independent of the queue).
 */
import { captureHold, framePreview, previewFromStill, type CapturedAsset } from '../../capture';
import type { Cropper, PoseDetection } from '../../crop';
import { encodePose, newId, type Asset, type CompactPose } from '../../model';
import { openVideo } from '../../source';
import { OpfsAssetStore } from '../../storage';
import type { CaptureEvent, CaptureRequest } from './capture-protocol';
import { workerCropper } from './cropper';

const scope = self as unknown as {
  postMessage(message: CaptureEvent): void;
  onmessage: ((e: MessageEvent<CaptureRequest>) => void) | null;
};

const store = new OpfsAssetStore();
const getCropper = workerCropper();
let current: AbortController | null = null;

function post(e: CaptureEvent) {
  scope.postMessage(e);
}

/** The compact pose to store: undefined without a pose model (nothing was tried). */
function compactPose(cropper: Cropper, detection: PoseDetection | null): CompactPose | null | undefined {
  if (cropper.name === 'none') return undefined;
  return detection ? encodePose(detection.worldLandmarks, detection.posture) : null;
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
    const source = await openVideo(req.file, req.exactDecoder ? { exactDecoder: req.exactDecoder } : {});
    const cropper = await getCropper(req.cropper, req.baseUrl);
    cropperName = cropper.name;
    try {
      for (const h of req.holds) {
        if (abort.signal.aborted) break;
        post({ type: 'hold-start', jobId, holdId: h.id });
        try {
          const { assets, preview, clipError } = await captureHold(h, source, { clipQuality: req.quality, signal: abort.signal, clip: h.clip });
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
          if (!wanted.length && clipError) throw new Error(`Clip: ${clipError}`);
          const records: Asset[] = [];
          for (const a of wanted) records.push(await save(h.id, a));
          post({
            type: 'hold-done',
            jobId,
            holdId: h.id,
            assets: records,
            crop: detection?.box ?? null,
            posture: detection?.posture ?? null,
            pose: compactPose(cropper, detection),
            cropper: cropper.name,
            ...(clipError ? { clipError } : {}),
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
          post({ type: 'recrop-done', jobId, holdId: h.id, crop: detection?.box ?? null, pose: compactPose(cropper, detection), cropper: cropper.name });
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

async function framePoses(req: Extract<CaptureRequest, { type: 'frame-poses' }>) {
  const { jobId, videoId } = req;
  try {
    const cropper = await getCropper(req.cropper, req.baseUrl);
    if (cropper.name === 'none') throw new Error('No pose model');
    const source = await openVideo(req.file, req.exactDecoder ? { exactDecoder: req.exactDecoder } : {});
    try {
      for (const f of [...req.frames].sort((a, b) => a.atS - b.atS)) {
        let detection = null;
        const preview = await framePreview(source, f.atS);
        if (preview) {
          try {
            detection = await cropper.detect(preview);
          } finally {
            preview.close();
          }
        }
        post({ type: 'frame-pose', jobId, videoId, key: f.key, pose: detection ? encodePose(detection.worldLandmarks, detection.posture) : null });
      }
    } finally {
      source.close();
    }
    post({ type: 'frame-poses-done', jobId, videoId });
  } catch (e) {
    post({ type: 'frame-poses-done', jobId, videoId, message: e instanceof Error ? e.message : String(e) });
  }
}

async function pose(req: Extract<CaptureRequest, { type: 'pose' }>) {
  const { jobId } = req;
  let cropperName = 'none';
  try {
    const cropper = await getCropper(req.cropper, req.baseUrl);
    cropperName = cropper.name;
    const still = await store.get(req.stillKey);
    if (!still) throw new Error('Still file missing');
    const preview = await previewFromStill(still);
    try {
      post({ type: 'pose-done', jobId, detection: await cropper.detect(preview), cropper: cropper.name });
    } finally {
      preview.close();
    }
  } catch (e) {
    post({ type: 'pose-done', jobId, detection: null, cropper: cropperName, message: e instanceof Error ? e.message : String(e) });
  }
}

scope.onmessage = (e) => {
  const req = e.data;
  if (req.type === 'capture') void capture(req);
  else if (req.type === 'recrop') void recrop(req);
  else if (req.type === 'pose') void pose(req);
  else if (req.type === 'frame-poses') void framePoses(req);
  else current?.abort();
};
