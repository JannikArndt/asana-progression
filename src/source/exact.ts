import { EncodedPacketSink, type InputVideoTrack } from 'mediabunny';
import { waitForDequeue } from './sampler';
import type { Rotation, TimedFrame } from './types';

/** A frame at most this much after the requested time still counts as "at" it (like the sampler's grid). */
const TOLERANCE_S = 0.0015;
const MAX_DECODE_QUEUE = 4;

/**
 * Decoded frames (presentation order, as the sampler relies on too) from the key frame at or before
 * `startS`, with our own VideoDecoder and `config`. Mediabunny's sinks configure the decoder with
 * the track's codec string as is; when the browser rejects that string but accepts a variant (e.g.
 * `hvc1` for `hev1`), exact frames come from here. The consumer closes every frame it receives.
 */
async function* decodeFrom(track: InputVideoTrack, config: VideoDecoderConfig, startS: number): AsyncGenerator<VideoFrame, void, void> {
  const sink = new EncodedPacketSink(track);
  const first =
    (await sink.getKeyPacket(startS, { verifyKeyPackets: true })) ??
    (await sink.getFirstKeyPacket({ verifyKeyPackets: true })) ??
    (await sink.getFirstPacket());
  if (!first) return;
  const out: VideoFrame[] = [];
  let failure: unknown = null;
  const decoder = new VideoDecoder({ output: (f) => out.push(f), error: (e) => (failure ??= e) });
  try {
    decoder.configure(config);
    for await (const packet of sink.packets(first)) {
      while (decoder.decodeQueueSize >= MAX_DECODE_QUEUE) {
        while (out.length) yield out.shift()!;
        if (failure) throw failure;
        await waitForDequeue(decoder);
      }
      if (failure) throw failure;
      decoder.decode(packet.toEncodedVideoChunk());
      while (out.length) yield out.shift()!;
    }
    await decoder.flush();
    if (failure) throw failure;
    while (out.length) yield out.shift()!;
  } finally {
    for (const f of out.splice(0)) f.close();
    if (decoder.state !== 'closed') decoder.close();
  }
}

const seconds = (us: number | null | undefined) => (us ?? 0) / 1e6;

/** The frame shown at `atS`: the last one starting at or before it (else the first one). Caller closes it. */
export async function exactFrame(track: InputVideoTrack, config: VideoDecoderConfig, atS: number): Promise<VideoFrame | null> {
  let best: VideoFrame | null = null;
  try {
    for await (const f of decodeFrom(track, config, atS)) {
      if (best && seconds(f.timestamp) > atS + TOLERANCE_S) {
        f.close();
        break;
      }
      best?.close();
      best = f;
      if (seconds(f.timestamp) > atS + TOLERANCE_S) break;
    }
  } catch (e) {
    best?.close();
    throw e;
  }
  return best;
}

/** Frames covering [startS, endS), from the one shown at `startS` on (like Mediabunny's `samples`). */
export async function* exactFrames(track: InputVideoTrack, config: VideoDecoderConfig, rotation: Rotation, startS: number, endS: number): AsyncGenerator<TimedFrame, void, void> {
  let held: VideoFrame | null = null;
  const timed = (frame: VideoFrame, durationS: number): TimedFrame => ({ frame, rotation, timestampS: seconds(frame.timestamp), durationS });
  try {
    for await (const f of decodeFrom(track, config, startS)) {
      const ts = seconds(f.timestamp);
      if (held && ts <= startS + TOLERANCE_S) {
        held.close();
        held = f;
        continue;
      }
      if (held) {
        const out = held;
        held = null;
        yield timed(out, ts - seconds(out.timestamp));
      }
      if (ts >= endS) {
        f.close();
        return;
      }
      held = f;
    }
    if (held) {
      const out = held;
      held = null;
      yield timed(out, seconds(out.duration));
    }
  } finally {
    held?.close();
  }
}
