/**
 * MediaPipe Pose Landmarker as a Cropper. Meant for a module Web Worker: tasks-vision loads the
 * ES-module wasm loader with a dynamic import() there. The loader, the wasm binary and the model
 * are fetched cache-first through Cache Storage, so detection keeps working offline.
 */
import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import type { Cropper, CropperInput, PoseDetection } from './types';
import { boxFromLandmarks, postureFromLandmarks } from './landmarks';

export interface MediaPipeCropperOptions {
  /** ES-module wasm loader (vision_wasm_module_internal.js). */
  wasmLoaderUrl: string;
  /** Wasm binary (vision_wasm_module_internal.wasm). */
  wasmBinaryUrl: string;
  /** Pose landmarker model (.task). */
  modelUrl: string;
  /** Cache Storage name; bump it when tasks-vision or the model change (default 'mediapipe-pose-v1'). */
  cacheName?: string;
}

export const MEDIAPIPE_CACHE = 'mediapipe-pose-v1';

/** URLs of the self-hosted files below the app base (see the mediapipe plugin in vite.config.ts). */
export function mediaPipeAssetUrls(base: string): Omit<MediaPipeCropperOptions, 'cacheName'> {
  return {
    wasmLoaderUrl: `${base}mediapipe/vision_wasm_module_internal.js`,
    wasmBinaryUrl: `${base}mediapipe/vision_wasm_module_internal.wasm`,
    modelUrl: `${base}models/pose_landmarker_lite.task`,
  };
}

type WasmFileset = Parameters<typeof PoseLandmarker.createFromOptions>[0];

/** import() resolves relative to the bundled tasks-vision chunk, so make URLs absolute first. */
function absolute(url: string): string {
  const base = globalThis.location?.href;
  return base ? new URL(url, base).href : url;
}

/** Cache-first fetch. Without Cache Storage (insecure context, private mode) it just fetches. */
async function cachedBlob(url: string, cacheName: string, type: string): Promise<Blob> {
  const cache = await globalThis.caches?.open(cacheName).catch(() => undefined);
  let res = await cache?.match(url);
  if (!res) {
    res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    await cache?.put(url, res.clone()).catch(() => {});
  }
  return new Blob([await res.blob()], { type });
}

/**
 * Loads the landmarker (single pose, IMAGE mode, CPU). The wasm files are handed over as blob:
 * URLs of the cached copies; if that fails, it retries once with the plain URLs. Rejects when the
 * model cannot be created (callers fall back to `nullCropper`).
 */
export async function createMediaPipeCropper(opts: MediaPipeCropperOptions): Promise<Cropper> {
  const cacheName = opts.cacheName ?? MEDIAPIPE_CACHE;
  const loaderUrl = absolute(opts.wasmLoaderUrl);
  const wasmUrl = absolute(opts.wasmBinaryUrl);
  const [vision, loader, wasm, model] = await Promise.all([
    import('@mediapipe/tasks-vision'),
    cachedBlob(loaderUrl, cacheName, 'text/javascript'),
    cachedBlob(wasmUrl, cacheName, 'application/wasm'),
    cachedBlob(absolute(opts.modelUrl), cacheName, 'application/octet-stream'),
  ]);
  const create = async (fileset: WasmFileset) =>
    vision.PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: new Uint8Array(await model.arrayBuffer()), delegate: 'CPU' },
      runningMode: 'IMAGE',
      numPoses: 1,
    });

  const loaderBlobUrl = URL.createObjectURL(loader);
  const wasmBlobUrl = URL.createObjectURL(wasm);
  let landmarker: PoseLandmarker;
  try {
    landmarker = await create({ wasmLoaderPath: loaderBlobUrl, wasmBinaryPath: wasmBlobUrl });
  } catch {
    landmarker = await create({ wasmLoaderPath: loaderUrl, wasmBinaryPath: wasmUrl });
  } finally {
    URL.revokeObjectURL(loaderBlobUrl);
    URL.revokeObjectURL(wasmBlobUrl);
  }

  let closed = false;
  return {
    name: 'mediapipe-pose',
    async detect(image: CropperInput): Promise<PoseDetection | null> {
      if (closed) throw new Error('Cropper is closed');
      const pose = landmarker.detect(image).landmarks[0];
      const box = pose ? boxFromLandmarks(pose) : null;
      if (!pose || !box) return null;
      const aspect = image.height > 0 ? image.width / image.height : 1;
      return { box, posture: postureFromLandmarks(pose, { aspect }) };
    },
    close() {
      if (closed) return;
      closed = true;
      landmarker.close();
    },
  };
}
