import { createMediaPipeCropper, nullCropper, type Cropper } from '../../crop';

/**
 * Pose model for a worker (one per worker, loaded lazily): MediaPipe from the self-hosted files
 * below `baseUrl`, or the null cropper (debug switch, or when the model cannot be loaded).
 */
export function workerCropper(): (kind: 'mediapipe' | 'none', baseUrl: string) => Promise<Cropper> {
  let promise: Promise<Cropper> | null = null;
  let current: 'mediapipe' | 'none' | null = null;
  return (kind, baseUrl) => {
    if (promise && current === kind) return promise;
    current = kind;
    if (kind === 'none') return (promise = Promise.resolve(nullCropper));
    const url = (p: string) => new URL(baseUrl + p, self.location.origin).toString();
    promise = createMediaPipeCropper({
      wasmLoaderUrl: url('mediapipe/vision_wasm_module_internal.js'),
      wasmBinaryUrl: url('mediapipe/vision_wasm_module_internal.wasm'),
      modelUrl: url('models/pose_landmarker_lite.task'),
    }).catch((e) => {
      console.warn('[worker] pose model unavailable, using full frames', e);
      return nullCropper;
    });
    return promise;
  };
}
