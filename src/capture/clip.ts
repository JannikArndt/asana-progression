import {
  BufferTarget,
  EncodedPacket,
  EncodedVideoPacketSource,
  Mp4OutputFormat,
  Output,
  Quality,
  VideoSample,
  VideoSampleSource,
  canEncodeVideo,
  type VideoSource as OutputVideoSource,
  type VideoTrackMetadata,
} from 'mediabunny';
import { drawRotated } from '../source';
import type { SourcePacket, VideoSource } from '../source/types';
import { canvas2d, release } from './canvas';
import { clipSize, rebaseTimestamps } from './sizes';
import type { CaptureOptions, CaptureStrategy, CapturedAsset, ClipQuality, HoldSpan } from './types';

const MP4 = 'video/mp4';
const BITRATE: Record<Exclude<ClipQuality, 'original'>, number> = { '720p': 4e6, '1080p': 8e6 };

/** Muxes into an in-memory MP4: start → write → finalize; cancels the output on any error. */
async function writeMp4<T>(
  source: OutputVideoSource,
  track: VideoTrackMetadata,
  write: () => Promise<T>,
): Promise<{ blob: Blob; result: T }> {
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  output.addVideoTrack(source, track);
  let result: T;
  try {
    await output.start();
    result = await write();
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => {});
    throw e;
  }
  if (!target.buffer) throw new Error('The MP4 muxer produced no data');
  return { blob: new Blob([target.buffer], { type: MP4 }), result };
}

/** Stream copy: no re-encoding, so the range snaps to key frames. */
async function copyClip(hold: HoldSpan, source: VideoSource, signal?: AbortSignal): Promise<CapturedAsset> {
  const { meta } = source;
  const codec = new Mp4OutputFormat().getSupportedVideoCodecs().find((c) => c === meta.codec);
  if (!codec) throw new Error(`Cannot copy ${meta.codec ?? 'unknown'} video into an MP4 clip`);
  const packets: SourcePacket[] = [];
  for await (const p of source.packets(hold.clipStartS, hold.clipEndS)) {
    signal?.throwIfAborted();
    packets.push(p);
  }
  const range = rebaseTimestamps(packets);
  if (!range) throw new Error(`No video packets between ${hold.clipStartS.toFixed(2)} s and ${hold.clipEndS.toFixed(2)} s`);
  const decoderConfig = await source.decoderConfig();
  if (!decoderConfig) throw new Error('Unknown decoder configuration; cannot copy the clip');
  const track = new EncodedVideoPacketSource(codec);
  const { blob } = await writeMp4(track, { rotation: meta.rotation }, async () => {
    for (const [i, p] of packets.entries()) {
      signal?.throwIfAborted();
      const packet = new EncodedPacket(p.data, p.type, p.timestampS - range.offsetS, p.durationS, i);
      await track.add(packet, i === 0 ? { decoderConfig } : undefined);
    }
  });
  return {
    kind: 'clip',
    mime: MP4,
    width: meta.displayWidth,
    height: meta.displayHeight,
    blob,
    startS: range.startS,
    endS: range.endS,
    quality: 'original',
  };
}

/** Re-encodes to H.264 at 720p/1080p (display orientation, no audio). Null if the encoder is unsupported. */
async function encodeClip(
  hold: HoldSpan,
  source: VideoSource,
  quality: Exclude<ClipQuality, 'original'>,
  signal?: AbortSignal,
): Promise<CapturedAsset | null> {
  const { meta } = source;
  const { width, height } = clipSize(meta.displayWidth, meta.displayHeight, quality);
  const encodeQuality = new Quality({ bitrate: BITRATE[quality] });
  if (!(await canEncodeVideo('avc', { width, height, quality: encodeQuality }))) return null;
  const fps = meta.fps && Number.isFinite(meta.fps) && meta.fps > 0 ? meta.fps : null;
  const track = new VideoSampleSource({ codec: 'avc', quality: encodeQuality, keyFrameInterval: 1 });
  const { canvas, ctx } = canvas2d(width, height);
  try {
    const { blob, result } = await writeMp4(track, fps ? { frameRate: fps } : {}, async () => {
      let startS: number | null = null;
      let endS = 0;
      for await (const f of source.frames(hold.clipStartS, hold.clipEndS)) {
        try {
          signal?.throwIfAborted();
          drawRotated(ctx, f.frame, f.rotation, width, height);
        } finally {
          f.frame.close();
        }
        startS ??= f.timestampS;
        const durationS = f.durationS > 0 ? f.durationS : 1 / (fps ?? 30);
        endS = f.timestampS + durationS;
        const sample = new VideoSample(canvas, { timestamp: f.timestampS - startS, duration: durationS });
        try {
          await track.add(sample);
        } finally {
          sample.close();
        }
      }
      if (startS === null) {
        throw new Error(`No video frames between ${hold.clipStartS.toFixed(2)} s and ${hold.clipEndS.toFixed(2)} s`);
      }
      return { startS, endS };
    });
    return { kind: 'clip', mime: MP4, width, height, blob, startS: result.startS, endS: result.endS, quality };
  } finally {
    release(canvas);
  }
}

/**
 * Video clip of the hold's clip window as MP4. 'original' copies the encoded packets (exact
 * quality, key-frame snapped range); 720p/1080p re-encode with H.264 and fall back to 'original'
 * when the encoder is unavailable.
 */
export class ClipStrategy implements CaptureStrategy {
  readonly kind = 'clip' as const;

  async capture(hold: HoldSpan, source: VideoSource, opts: CaptureOptions): Promise<CapturedAsset[]> {
    opts.signal?.throwIfAborted();
    if (opts.clipQuality !== 'original') {
      const encoded = await encodeClip(hold, source, opts.clipQuality, opts.signal);
      if (encoded) return [encoded];
    }
    return [await copyClip(hold, source, opts.signal)];
  }
}
