import { describe, expect, it } from 'vitest';
import { assessHandover, formatBytes, videoDiagnostics, videoForReport, withoutLocation } from './diagnostics';
import type { VideoMeta } from '../source';

const base: VideoMeta = {
  fileName: 'IMG_1234.MOV', fileType: 'video/quicktime', fileSize: 1, fileLastModified: 0, mimeType: '',
  codec: 'hevc', codecString: 'hvc1.2.4.L153.B0', profile: 'HEVC Main 10', codedWidth: 3840, codedHeight: 2160,
  displayWidth: 3840, displayHeight: 2160, rotation: 0, fps: 60, packetCount: null, averageBitrate: 60e6,
  durationS: 60, firstTimestampS: 0, color: { primaries: 'bt2020', transfer: 'hlg', matrix: 'bt2020-ncl', fullRange: false },
  hdr: true, hasAudio: true, recordedAt: null, recordedAtSource: null, quicktimeCreationDate: '2024-05-12T07:31:22+0200',
  mvhdCreationTime: null, make: 'Apple', model: 'iPhone', software: null, location: null,
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

describe('withoutLocation', () => {
  it('keeps only whether the video has a location', () => {
    expect(withoutLocation({ ...base, location: { lat: 52.52, lon: 13.405, altM: 34 } }).location).toBe('present');
    expect(withoutLocation(base).location).toBeNull();
    expect(withoutLocation(base).model).toBe('iPhone');
  });
  it('redacts stored video snapshots', () => {
    const v = { id: 'v', meta: { model: 'iPhone', location: { lat: 1, lon: 2, altM: null } } };
    expect(videoForReport(v).meta).toEqual({ model: 'iPhone', location: 'present' });
    expect(v.meta.location).toEqual({ lat: 1, lon: 2, altM: null });
    const plain = { id: 'w', meta: { location: null } };
    expect(videoForReport(plain)).toBe(plain);
  });
});

describe('videoDiagnostics', () => {
  const video = {
    id: 'vid_1', fingerprint: 'fp', fileName: 'IMG_1234.MOV', fileSize: 1, durationS: 60, codec: 'hevc', width: 3840, height: 2160,
    fps: 60, recordedAt: '2024-05-12T07:31:22+02:00', importedAt: '2024-05-12T08:00:00Z',
    meta: { ...base, location: { lat: 52.5, lon: 13.4 } } as unknown as Record<string, unknown>,
  };
  it('reports the video without its coordinates, and the analysis in short', () => {
    const analysis = { sampleCount: 240, frameWidth: 80, frameHeight: 45, candidates: [{}, {}], threshold: 1.5, singleStill: false, stats: null };
    const d = videoDiagnostics(video, analysis as never);
    expect(d.video.meta).toBeUndefined();
    expect(d.video.recordedAt).toBe('2024-05-12T07:31:22+02:00');
    expect(d.source?.location).toBe('present');
    expect(JSON.stringify(d)).not.toContain('52.5');
    expect(d.handover?.verdict).toBe('original');
    expect(d.decoderSupport).toBeNull();
    expect(d.analysis).toEqual({ samples: 240, frame: '80×45', candidates: 2, threshold: 1.5, singleStill: false });
  });
  it('works without metadata and analysis', () => {
    const d = videoDiagnostics({ ...video, meta: undefined }, null);
    expect(d.source).toBeNull();
    expect(d.handover).toBeNull();
    expect(d.analysis).toBeNull();
  });
});
