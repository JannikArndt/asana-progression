import { describe, expect, it } from 'vitest';
import { nullCropper } from './null';

describe('nullCropper', () => {
  it('never finds a body', async () => {
    expect(nullCropper.name).toBe('none');
    const image = { width: 4, height: 4, data: new Uint8ClampedArray(64), colorSpace: 'srgb' } as ImageData;
    await expect(nullCropper.detect(image)).resolves.toBeNull();
    expect(() => nullCropper.close()).not.toThrow();
  });
});
