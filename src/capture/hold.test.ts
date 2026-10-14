import { describe, expect, it, vi } from 'vitest';
import type { VideoSource } from '../source/types';

const clipCapture = vi.fn();
const preview = { close: vi.fn() };
vi.mock('./still', () => ({
  StillStrategy: class {
    captureWithPreview = async () => ({ assets: [{ kind: 'still' }, { kind: 'thumb' }], preview });
  },
}));
vi.mock('./clip', () => ({
  ClipStrategy: class {
    capture = clipCapture;
  },
}));

const { captureHold } = await import('./hold');
const hold = { id: 'h', bestS: 5, clipStartS: 4, clipEndS: 8 };
const source = {} as VideoSource;

describe('captureHold', () => {
  it('keeps the still when the clip fails', async () => {
    clipCapture.mockRejectedValueOnce(new Error('encoder broke'));
    const r = await captureHold(hold, source, { clipQuality: '1080p' });
    expect(r.assets.map((a) => a.kind)).toEqual(['still', 'thumb']);
    expect(r.clipError).toBe('encoder broke');
    expect(r.preview).toBe(preview);
  });

  it('adds the clip, or skips it when not wanted', async () => {
    clipCapture.mockResolvedValueOnce([{ kind: 'clip' }]);
    expect((await captureHold(hold, source, { clipQuality: '720p' })).assets.map((a) => a.kind)).toEqual(['still', 'thumb', 'clip']);
    clipCapture.mockClear();
    const r = await captureHold(hold, source, { clipQuality: '720p', clip: false });
    expect(r.assets).toHaveLength(2);
    expect(clipCapture).not.toHaveBeenCalled();
  });

  it('passes a cancellation on and closes the preview', async () => {
    const abort = new AbortController();
    abort.abort();
    clipCapture.mockRejectedValueOnce(new Error('aborted'));
    await expect(captureHold(hold, source, { clipQuality: 'original', signal: abort.signal })).rejects.toThrow('aborted');
    expect(preview.close).toHaveBeenCalled();
  });
});
