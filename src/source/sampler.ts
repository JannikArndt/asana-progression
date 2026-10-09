import { EncodedPacketSink, type InputVideoTrack } from 'mediabunny';
import { targetSize } from './gray';
import { canvasConverter, lumaBits, lumaConverter, timeConverter, type GrayConverter, type GrayMethod } from './convert';
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

/** How often held frames are converted while the decoder flushes. */
const FLUSH_DRAIN_MS = 10;

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

/**
 * Decodes a track sequentially with WebCodecs and yields grayscale frames on the grid t = k / hz.
 * Sample k uses the first decoded frame with timestamp ≥ k / hz. Conversion to gray uses the
 * faster of a canvas path and a luma-plane path (see convert.ts), chosen on the first frame unless
 * `opts.grayMethod` pins it (resume must keep the method of the first run).
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
  const converters: Record<GrayMethod, () => GrayConverter> = {
    canvas: () => canvasConverter(rotation, mid, target),
    luma: () => lumaConverter(rotation, target),
  };
  let converter: GrayConverter | null = opts.grayMethod ? converters[opts.grayMethod]() : null;

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
    grayMethod: converter?.method ?? null,
    grayBenchmark: null,
    pixelFormat: null,
  };
  /** Decoded frames needed for samples, with the sample indices they cover; converted in order. */
  const pending: Array<{ frame: VideoFrame; indices: number[] }> = [];
  const ready: GraySample[] = [];
  let failure: unknown = null;

  const decoder = new VideoDecoder({
    output(frame) {
      stats.framesDecoded++;
      const ts = frame.timestamp / 1e6;
      if (ts > stats.mediaTimeS) stats.mediaTimeS = ts;
      if (ts + GRID_TOLERANCE_S < next / hz) {
        frame.close();
        return;
      }
      const indices: number[] = [];
      while (next / hz <= ts + GRID_TOLERANCE_S) indices.push(next++);
      pending.push({ frame, indices });
    },
    error(e) {
      failure ??= e;
    },
  });

  /** Picks the faster converter on the first frame (luma only if the pixel format allows it). */
  async function choose(frame: VideoFrame): Promise<GrayConverter> {
    stats.pixelFormat = (frame.format as string | null) ?? null;
    const canvas = converters.canvas();
    if (!lumaBits(stats.pixelFormat)) {
      stats.grayMethod = 'canvas';
      return canvas;
    }
    const luma = converters.luma();
    try {
      const [c, l] = [await timeConverter(canvas, frame), await timeConverter(luma, frame)];
      stats.grayBenchmark = { canvas: Math.round(c * 10) / 10, luma: Math.round(l * 10) / 10 };
      const winner = l < c ? luma : canvas;
      stats.grayMethod = winner.method;
      return winner;
    } catch {
      stats.grayMethod = 'canvas';
      return canvas;
    }
  }

  async function convertPending() {
    while (pending.length) {
      const { frame, indices } = pending.shift()!;
      try {
        converter ??= await choose(frame);
        const ts = frame.timestamp / 1e6;
        const t0 = performance.now();
        const data = await converter.convert(frame);
        stats.convertMs += performance.now() - t0;
        for (const index of indices) ready.push({ index, timestampS: ts, width: target.width, height: target.height, data });
      } finally {
        frame.close();
      }
    }
  }

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
      // Convert (and so release) held frames while waiting: decoders with a fixed output pool
      // stall when the app keeps too many frames open.
      while (decoder.decodeQueueSize >= MAX_DECODE_QUEUE) {
        await convertPending();
        if (failure) throw failure;
        await waitForDequeue(decoder);
      }
      decoder.decode(packet.toEncodedVideoChunk());
      if (decoder.decodeQueueSize > stats.maxDecodeQueue) stats.maxDecodeQueue = decoder.decodeQueueSize;
      await convertPending();
      while (ready.length) {
        stats.samplesEmitted++;
        yield ready.shift()!;
      }
      report();
    }
    if (!opts.signal?.aborted) {
      let flushed = false;
      const flushing = decoder.flush().finally(() => (flushed = true));
      while (!flushed) {
        await Promise.race([flushing, new Promise((r) => setTimeout(r, FLUSH_DRAIN_MS))]);
        await convertPending();
      }
      await flushing;
      if (failure) throw failure;
      await convertPending();
      while (ready.length) {
        stats.samplesEmitted++;
        yield ready.shift()!;
      }
    }
    report(true);
    return stats;
  } finally {
    for (const p of pending.splice(0)) p.frame.close();
    if (decoder.state !== 'closed') decoder.close();
  }
}
