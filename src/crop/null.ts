import type { Cropper } from './types';

/** Cropper that never finds a body (no pose model available); stills are shown uncropped. */
export const nullCropper: Cropper = {
  name: 'none',
  detect: () => Promise.resolve(null),
  close: () => {},
};
