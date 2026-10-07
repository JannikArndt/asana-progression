import { describe, expect, it } from 'vitest';
import { assessHandover, formatBytes } from './diagnostics';
import type { VideoMeta } from '../source';

const base: VideoMeta = {
  fileName: 'IMG_1234.MOV', fileType: 'video/quicktime', fileSize: 1, fileLastModified: 0, mimeType: '',
  codec: 'hevc', codecString: 'hvc1.2.4.L153.B0', profile: 'HEVC Main 10', codedWidth: 3840, codedHeight: 2160,
  displayWidth: 3840, displayHeight: 2160, rotation: 0, fps: 60, packetCount: null, averageBitrate: 60e6,
  durationS: 60, firstTimestampS: 0, color: { primaries: 'bt2020', transfer: 'hlg', matrix: 'bt2020-ncl', fullRange: false },
  hdr: true, hasAudio: true, recordedAt: null, recordedAtSource: null, quicktimeCreationDate: '2024-05-12T07:31:22+0200',
  mvhdCreationTime: null, make: 'Apple', model: 'iPhone', software: null,
};

describe('assessHandover', () => {
  it('recognises camera originals', () => {
    const a = assessHandover(base);
    expect(a.verdict).toBe('original');
    expect(a.reasons.join(' ')).toMatch(/IMG_####/);
    expect(a.reasons.join(' ')).toMatch(/60\.0 Mbit/);
  });
  it('flags H.264 without Apple metadata as transcoded', () => {
    const a = assessHandover({ ...base, codec: 'avc', profile: 'H.264 High', hdr: false, make: null, model: null, quicktimeCreationDate: null, fileName: 'trim.ABC.MOV', color: null, averageBitrate: null });
    expect(a.verdict).toBe('transcoded');
    expect(a.reasons.join(' ')).toMatch(/No Apple/);
  });
  it('keeps H.264 originals (Most Compatible) as original, unknown otherwise', () => {
    expect(assessHandover({ ...base, codec: 'avc', hdr: false }).verdict).toBe('original');
    expect(assessHandover({ ...base, make: null, model: null, quicktimeCreationDate: null }).verdict).toBe('unknown');
  });
});

describe('formatBytes', () => {
  it('uses SI units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1234)).toBe('1.2 KB');
    expect(formatBytes(123_456_789)).toBe('123 MB');
    expect(formatBytes(64e9)).toBe('64.0 GB');
    expect(formatBytes(null)).toBe('–');
  });
});
