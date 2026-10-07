/**
 * Public contract of the source module: File → metadata, fingerprint, sampled tiny gray frames,
 * exact full-resolution frames, and packets for a time range. Knows nothing about detection,
 * asanas or storage.
 */

export type Rotation = 0 | 90 | 180 | 270;

export interface ColorInfo {
  primaries: string | null;
  transfer: string | null;
  matrix: string | null;
  fullRange: boolean | null;
}

export interface VideoMeta {
  fileName: string;
  fileType: string;
  fileSize: number;
  fileLastModified: number;
  /** Container MIME type incl. codecs, e.g. `video/quicktime; codecs="hvc1.2.4.L153.B0"`. */
  mimeType: string;
  /** Mediabunny codec id, e.g. "hevc", "avc", "vp9". */
  codec: string | null;
  /** WebCodecs codec string, e.g. "hvc1.2.4.L153.B0". */
  codecString: string | null;
  /** Human readable profile, e.g. "HEVC Main 10". */
  profile: string | null;
  codedWidth: number;
  codedHeight: number;
  /** After rotation. */
  displayWidth: number;
  displayHeight: number;
  /** Clockwise rotation to apply for display. */
  rotation: Rotation;
  fps: number | null;
  packetCount: number | null;
  averageBitrate: number | null;
  durationS: number;
  firstTimestampS: number;
  color: ColorInfo | null;
  hdr: boolean;
  hasAudio: boolean;
  /** Best available recording time, ISO 8601 with offset when known. */
  recordedAt: string | null;
  recordedAtSource: 'quicktime' | 'mvhd' | 'file' | null;
  /** Raw `com.apple.quicktime.creationdate` (includes the time zone). */
  quicktimeCreationDate: string | null;
  /** `mvhd` creation_time (UTC). May be the export time rather than the recording time. */
  mvhdCreationTime: string | null;
  make: string | null;
  model: string | null;
  software: string | null;
}

export interface GraySample {
  /** Sample index on the fixed grid t = index / hz. */
  index: number;
  /** Presentation timestamp (s) of the frame used for this sample. */
  timestampS: number;
  width: number;
  height: number;
  /** Grayscale, row-major, one byte per pixel. */
  data: Uint8Array;
}

export interface SamplerStats {
  packetsRead: number;
  packetsSkipped: number;
  framesDecoded: number;
  samplesEmitted: number;
  /** Media time of the last decoded frame (s). */
  mediaTimeS: number;
  /** Total time spent converting frames to gray (ms). */
  convertMs: number;
  maxDecodeQueue: number;
  wallMs: number;
  /** Frame → gray implementation in use, and the first-frame benchmark (ms per frame). */
  grayMethod: 'canvas' | 'luma' | null;
  grayBenchmark: { canvas: number; luma: number } | null;
  /** VideoFrame.format of decoded frames (e.g. NV12). */
  pixelFormat: string | null;
}

export interface SampleOptions {
  hz: number;
  /** Long side of the gray frames in pixels. */
  longSide: number;
  /** First sample index to emit (resume support). */
  startIndex?: number;
  /** Skip packets that no other frame references (faster; frames between samples are not needed). */
  skipNonReference?: boolean;
  /** Pin the frame → gray implementation (otherwise benchmarked on the first frame). */
  grayMethod?: 'canvas' | 'luma';
  signal?: AbortSignal;
  onStats?: (s: SamplerStats) => void;
}

export interface DecoderSupport {
  supported: boolean;
  config: { codec: string; codedWidth?: number; codedHeight?: number } | null;
  /** isConfigSupported() result per tried codec string (e.g. hvc1 and hev1 variants). */
  variants?: Record<string, boolean>;
  error?: string;
}

export interface ExactFrame {
  /** Caller must close(). */
  frame: VideoFrame;
  rotation: Rotation;
  timestampS: number;
}

/** Opaque encoded packet for stream-copy (clip capture). */
export interface SourcePacket {
  data: Uint8Array;
  type: 'key' | 'delta';
  timestampS: number;
  durationS: number;
}

export interface VideoSource {
  readonly meta: VideoMeta;
  decoderSupport(): Promise<DecoderSupport>;
  /** Decodes the video sequentially and yields gray frames on the grid t = k / hz. */
  sampleGray(opts: SampleOptions): AsyncGenerator<GraySample, SamplerStats, void>;
  /** Exact full-resolution frame at (the last frame starting at or before) t. */
  frameAt(timestampS: number): Promise<ExactFrame | null>;
  /** Encoded packets from the key frame at or before `startS` up to `endS` (decode order). */
  packets(startS: number, endS: number): AsyncGenerator<SourcePacket, void, void>;
  close(): void;
}
