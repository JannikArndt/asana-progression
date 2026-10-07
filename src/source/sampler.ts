import { EncodedPacketSink, type InputVideoTrack } from 'mediabunny';
import { drawRotated, rgbaToGray, targetSize } from './gray';
import { isNonReference, nalLengthSize, type NalCodec } from './nal';
import type { GraySample, Rotation, SampleOptions, SamplerStats } from './types';

const MAX_DECODE_QUEUE = 8;
const STATS_INTERVAL_MS = 250;
/** Frames whose timestamp is within this tolerance before a grid point count as "at" it. */
const GRID_TOLERANCE_S = 0.0015;

function bytesOf(src: AllowSharedBufferSource | undefined): Uint8Array | undefined {
  if (!src) return undefined;
  if (src instanceof ArrayBuffer || (typeof SharedArrayBuffer !== 'undefined' && src instanceof SharedArrayBuffer)) {
    return new Uint8Array(src);
  }
  const v = src as ArrayBufferView;
  return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
}

/** Codec-string variants worth trying (HEVC can be signalled as hvc1 or hev1 with the same hvcC). */
export function codecVariants(codec: string): string[] {
  if (/^hvc1\./.test(codec)) return [codec, codec.replace(/^hvc1/, 'hev1')];
  if (/^hev1\./.test(codec)) return [codec, codec.replace(/^hev1/, 'hvc1')];
  return [codec];
}

/**
 * The track's decoder config, switched to the first codec-string variant the browser accepts.
 * `variants` maps every tried codec string to its isConfigSupported() result.
 */
export async function resolveDecoderConfig(
  track: InputVideoTrack,
): Promise<{ config: VideoDecoderConfig | null; supported: boolean; variants: Record<string, boolean>; error?: string }> {
  const config = await track.getDecoderConfig();
  if (!config) return { config: null, supported: false, variants: {}, error: 'Unknown codec' };
  if (typeof VideoDecoder === 'undefined') {
    return { config, supported: false, variants: {}, error: 'WebCodecs VideoDecoder is not available' };
  }
  const variants: Record<string, boolean> = {};
  let chosen: VideoDecoderConfig | null = null;
  for (const codec of codecVariants(config.codec)) {
    try {
      const r = await VideoDecoder.isConfigSupported({ ...config, codec });
      variants[codec] = r.supported === true;
      if (r.supported && !chosen) chosen = { ...config, codec };
    } catch (e) {
      variants[codec] = false;
    }
  }
  return { config: chosen ?? config, supported: chosen !== null, variants };
}

function waitForDequeue(decoder: VideoDecoder): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const target = decoder as Partial<EventTarget>;
    const events = typeof target.addEventListener === 'function';
    const finish = () => {
      if (done) return;
      done = true;
      if (events) target.removeEventListener!('dequeue', finish);
      resolve();
    };
    if (events) target.addEventListener!('dequeue', finish);
    // Fallback for engines without the dequeue event.
    setTimeout(finish, 4);
  });
}

function getContext(canvas: OffscreenCanvas, readback: boolean): OffscreenCanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: readback });
  if (!ctx) throw new Error('OffscreenCanvas 2D is not available');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return ctx;
}

/**
 * Decodes a track sequentially with WebCodecs and yields grayscale frames on the grid t = k / hz.
 * Sample k uses the first decoded frame with timestamp ≥ k / hz. Frames are downscaled in two
 * steps (to ~4× the target, then to the target) to limit aliasing, then converted to luma.
 */
export async function* sampleTrack(track: InputVideoTrack, opts: SampleOptions): AsyncGenerator<GraySample, SamplerStats, void> {
  const resolved = await resolveDecoderConfig(track);
  const config = resolved.config;
  if (!config) throw new Error(resolved.error ?? 'Unsupported codec');
  if (!resolved.supported) throw new Error(`This browser cannot decode ${config.codec}`);
  const codec = await track.getCodec();
  const nalCodec: NalCodec | null = codec === 'hevc' ? 'hevc' : codec === 'avc' ? 'avc' : null;
  const lengthSize = nalCodec ? nalLengthSize(nalCodec, bytesOf(config.description)) : 4;
  const skip = opts.skipNonReference === true && nalCodec !== null;
  const rotation = (await track.getRotation()) as Rotation;
  const dw = await track.getDisplayWidth();
  const dh = await track.getDisplayHeight();
  const target = targetSize(dw, dh, opts.longSide);
  const mid = targetSize(dw, dh, Math.min(Math.max(dw, dh), opts.longSide * 4));
  const midCanvas = new OffscreenCanvas(mid.width, mid.height);
  const midCtx = getContext(midCanvas, false);
  const outCanvas = new OffscreenCanvas(target.width, target.height);
  const outCtx = getContext(outCanvas, true);

  const hz = opts.hz;
  let next = Math.max(0, opts.startIndex ?? 0);
  const startT = next / hz;
  const started = performance.now();
  const stats: SamplerStats = {
    packetsRead: 0,
    packetsSkipped: 0,
    framesDecoded: 0,
    samplesEmitted: 0,
    mediaTimeS: startT,
    convertMs: 0,
    maxDecodeQueue: 0,
    wallMs: 0,
  };
  const ready: GraySample[] = [];
  let failure: unknown = null;

  const decoder = new VideoDecoder({
    output(frame) {
      stats.framesDecoded++;
      try {
        const ts = frame.timestamp / 1e6;
        if (ts > stats.mediaTimeS) stats.mediaTimeS = ts;
        if (ts + GRID_TOLERANCE_S < next / hz) return;
        const t0 = performance.now();
        drawRotated(midCtx, frame, rotation, mid.width, mid.height);
        outCtx.drawImage(midCanvas, 0, 0, target.width, target.height);
        const data = rgbaToGray(outCtx.getImageData(0, 0, target.width, target.height).data);
        stats.convertMs += performance.now() - t0;
        while (next / hz <= ts + GRID_TOLERANCE_S) {
          ready.push({ index: next, timestampS: ts, width: target.width, height: target.height, data });
          next++;
        }
      } catch (e) {
        failure ??= e;
      } finally {
        frame.close();
      }
    },
    error(e) {
      failure ??= e;
    },
  });

  const sink = new EncodedPacketSink(track);
  let lastStats = 0;
  const report = (force = false) => {
    const now = performance.now();
    if (!force && now - lastStats < STATS_INTERVAL_MS) return;
    lastStats = now;
    stats.wallMs = now - started;
    opts.onStats?.({ ...stats });
  };

  try {
    decoder.configure(config);
    const first =
      (await sink.getKeyPacket(startT, { verifyKeyPackets: true })) ??
      (await sink.getFirstKeyPacket({ verifyKeyPackets: true })) ??
      (await sink.getFirstPacket());
    if (!first) return stats;
    for await (const packet of sink.packets(first)) {
      if (opts.signal?.aborted) break;
      if (failure) throw failure;
      stats.packetsRead++;
      if (skip && packet.type === 'delta' && isNonReference(nalCodec!, packet.data, lengthSize)) {
        stats.packetsSkipped++;
        continue;
      }
      while (decoder.decodeQueueSize >= MAX_DECODE_QUEUE) await waitForDequeue(decoder);
      decoder.decode(packet.toEncodedVideoChunk());
      if (decoder.decodeQueueSize > stats.maxDecodeQueue) stats.maxDecodeQueue = decoder.decodeQueueSize;
      while (ready.length) {
        stats.samplesEmitted++;
        yield ready.shift()!;
      }
      report();
    }
    if (!opts.signal?.aborted) {
      await decoder.flush();
      if (failure) throw failure;
      while (ready.length) {
        stats.samplesEmitted++;
        yield ready.shift()!;
      }
    }
    report(true);
    return stats;
  } finally {
    if (decoder.state !== 'closed') decoder.close();
  }
}
