import {
  BlobSource,
  MATROSKA,
  MP4,
  QTFF,
  WEBM,
  EncodedPacketSink,
  Input,
  VideoSampleSink,
  type InputVideoTrack,
} from 'mediabunny';
import { describeCodec } from './profile';
import { blobReader, readMvhdCreationTime } from './isobmff';
import { parseQuickTimeDate, toLocalIso } from './quicktime-date';
import { resolveDecoderConfig, sampleTrack } from './sampler';
import type {
  DecoderSupport,
  ExactFrame,
  Rotation,
  SampleOptions,
  SourcePacket,
  VideoMeta,
  VideoSource,
} from './types';

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

export async function readMeta(file: Blob, input: Input, track: InputVideoTrack): Promise<VideoMeta> {
  const f = file as Partial<File>;
  const [
    codec,
    codecString,
    codedWidth,
    codedHeight,
    displayWidth,
    displayHeight,
    rotation,
    color,
    hdr,
    durationS,
    firstTimestampS,
    tags,
    mimeType,
    audio,
    stats,
    bitrate,
    mvhd,
  ] = await Promise.all([
    track.getCodec(),
    track.getCodecParameterString(),
    track.getCodedWidth(),
    track.getCodedHeight(),
    track.getDisplayWidth(),
    track.getDisplayHeight(),
    track.getRotation(),
    safe(track.getColorSpace(), null),
    safe(track.hasHighDynamicRange(), false),
    input.computeDuration(),
    safe(track.getFirstTimestamp(), 0),
    safe(input.getMetadataTags(), {}),
    safe(input.getMimeType(), ''),
    safe(input.getPrimaryAudioTrack(), null),
    safe(track.computePacketStats(240), null),
    safe(track.getAverageBitrate(), null),
    safe(readMvhdCreationTime(blobReader(file), file.size), null),
  ]);
  const raw = (tags as { raw?: Record<string, unknown> }).raw ?? {};
  const qtRaw = str(raw['com.apple.quicktime.creationdate']);
  const qt = parseQuickTimeDate(qtRaw);
  const lastModified = typeof f.lastModified === 'number' ? f.lastModified : Date.now();
  let recordedAt: string | null;
  let recordedAtSource: VideoMeta['recordedAtSource'];
  if (qt) {
    recordedAt = qt.iso;
    recordedAtSource = 'quicktime';
  } else if (mvhd) {
    recordedAt = mvhd;
    recordedAtSource = 'mvhd';
  } else {
    recordedAt = toLocalIso(lastModified);
    recordedAtSource = 'file';
  }
  return {
    fileName: f.name ?? 'video',
    fileType: file.type,
    fileSize: file.size,
    fileLastModified: lastModified,
    mimeType,
    codec,
    codecString,
    profile: describeCodec(codecString),
    codedWidth,
    codedHeight,
    displayWidth,
    displayHeight,
    rotation: rotation as Rotation,
    fps: stats ? Math.round(stats.averagePacketRate * 100) / 100 : null,
    packetCount: null,
    averageBitrate: bitrate ?? (durationS > 0 ? Math.round((file.size * 8) / durationS) : null),
    durationS,
    firstTimestampS,
    color: color
      ? {
          primaries: color.primaries ?? null,
          transfer: color.transfer ?? null,
          matrix: color.matrix ?? null,
          fullRange: color.fullRange ?? null,
        }
      : null,
    hdr,
    hasAudio: audio !== null,
    recordedAt,
    recordedAtSource,
    quicktimeCreationDate: qtRaw,
    mvhdCreationTime: mvhd,
    make: str(raw['com.apple.quicktime.make']),
    model: str(raw['com.apple.quicktime.model']),
    software: str(raw['com.apple.quicktime.software']),
  };
}

class MediabunnyVideoSource implements VideoSource {
  private frameSink: VideoSampleSink | null = null;

  constructor(
    readonly meta: VideoMeta,
    private readonly input: Input,
    private readonly track: InputVideoTrack,
  ) {}

  async decoderSupport(): Promise<DecoderSupport> {
    const r = await resolveDecoderConfig(this.track);
    const c = r.config;
    return {
      supported: r.supported,
      config: c
        ? {
            codec: c.codec,
            ...(c.codedWidth ? { codedWidth: c.codedWidth } : {}),
            ...(c.codedHeight ? { codedHeight: c.codedHeight } : {}),
          }
        : null,
      variants: r.variants,
      ...(r.error ? { error: r.error } : {}),
    };
  }

  sampleGray(opts: SampleOptions) {
    return sampleTrack(this.track, opts);
  }

  async frameAt(timestampS: number): Promise<ExactFrame | null> {
    this.frameSink ??= new VideoSampleSink(this.track);
    const sample = await this.frameSink.getSample(timestampS);
    if (!sample) return null;
    try {
      return { frame: sample.toVideoFrame(), rotation: sample.rotation as Rotation, timestampS: sample.timestamp };
    } finally {
      sample.close();
    }
  }

  async *packets(startS: number, endS: number): AsyncGenerator<SourcePacket, void, void> {
    const sink = new EncodedPacketSink(this.track);
    const first = (await sink.getKeyPacket(startS, { verifyKeyPackets: true })) ?? (await sink.getFirstPacket());
    if (!first) return;
    for await (const p of sink.packets(first)) {
      if (p.type === 'key' && p.timestamp >= endS && p.sequenceNumber !== first.sequenceNumber) return;
      yield { data: p.data, type: p.type, timestampS: p.timestamp, durationS: p.duration };
    }
  }

  close(): void {
    this.input.dispose();
  }
}

/** Containers a phone or camera produces (MOV/MP4; WebM/MKV for tests and screen recordings). */
const FORMATS = [QTFF, MP4, WEBM, MATROSKA];

/** Opens a video file (MP4/MOV/WebM/…) for reading. Reads lazily; never loads the whole file. */
export async function openVideo(file: Blob): Promise<VideoSource> {
  const input = new Input({ source: new BlobSource(file), formats: FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('The file has no video track');
    const meta = await readMeta(file, input, track);
    return new MediabunnyVideoSource(meta, input, track);
  } catch (e) {
    input.dispose();
    throw e;
  }
}
