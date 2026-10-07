import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_FORMATS, BlobSource, EncodedPacketSink, Input } from 'mediabunny';
import { openVideo } from './media';
import { fingerprint } from './fingerprint';
import { parseQuickTimeDate, toLocalIso } from './quicktime-date';
import { blobReader, findBox, readMvhdCreationTime } from './isobmff';
import { isNonReference, nalLengthSize } from './nal';
import { drawRotated, rgbaToGray, rotatedSize, targetSize } from './gray';
import { describeCodec } from './profile';
import { codecVariants } from './sampler';
import { hlgInverseOetf, hlgPixelToSrgb, softKnee, srgbOetf, yuv10ToRgb } from './hdr';

const fixtures = join(import.meta.dirname, '../../tests/fixtures');
function fixture(name: string, type = 'video/quicktime'): File {
  return new File([readFileSync(join(fixtures, name))], name, { type, lastModified: Date.UTC(2025, 0, 2, 3, 4, 5) });
}

describe('openVideo (iPhone-like HEVC Main 10 HLG, rotated)', () => {
  it('reads metadata', async () => {
    const src = await openVideo(fixture('hevc-hlg-rot90.mov'));
    const m = src.meta;
    expect(m.codec).toBe('hevc');
    expect(m.codecString).toMatch(/^h(vc|ev)1\.2\./);
    expect(m.profile).toBe('HEVC Main 10');
    expect(m.codedWidth).toBe(320);
    expect(m.codedHeight).toBe(180);
    expect(m.rotation).toBe(90);
    expect(m.displayWidth).toBe(180);
    expect(m.displayHeight).toBe(320);
    expect(m.hdr).toBe(true);
    expect(m.color?.transfer).toBe('hlg');
    expect(m.color?.primaries).toBe('bt2020');
    expect(m.fps).toBeCloseTo(30, 0);
    expect(m.durationS).toBeCloseTo(2, 1);
    expect(m.hasAudio).toBe(true);
    expect(m.quicktimeCreationDate).toBe('2024-05-12T07:31:22+0200');
    expect(m.recordedAt).toBe('2024-05-12T07:31:22+02:00');
    expect(m.recordedAtSource).toBe('quicktime');
    expect(m.mvhdCreationTime).toBe('2024-06-01T10:00:00.000Z');
    expect(m.make).toBe('Apple');
    expect(m.model).toBe('iPhone 15 Pro');
    expect(m.fileName).toBe('hevc-hlg-rot90.mov');
    expect(m.mimeType).toMatch(/^video\/quicktime; codecs="h(vc|ev)1/);
    const support = await src.decoderSupport();
    expect(support.supported).toBe(false); // no WebCodecs in Node
    expect(support.config?.codec).toBe(m.codecString);
    const packets = [];
    for await (const p of src.packets(0.5, 1)) packets.push(p);
    expect(packets[0]?.type).toBe('key');
    expect(packets.length).toBeGreaterThan(10);
    src.close();
  });

  it('falls back to mvhd and file dates', async () => {
    const h264 = await openVideo(fixture('h264-bframes.mp4', 'video/mp4'));
    expect(h264.meta.codec).toBe('avc');
    expect(h264.meta.profile).toBe('H.264 High');
    expect(h264.meta.rotation).toBe(0);
    expect(h264.meta.hdr).toBe(false);
    expect(h264.meta.hasAudio).toBe(false);
    // ffmpeg writes no creation time by default → file.lastModified
    expect(h264.meta.recordedAtSource === 'mvhd' || h264.meta.recordedAtSource === 'file').toBe(true);
    h264.close();
  });

  it('rejects files without video', async () => {
    await expect(openVideo(new File([new Uint8Array(100)], 'x.bin'))).rejects.toThrow();
  });
});

async function nonRefCount(name: string): Promise<{ total: number; nonRef: number; keyNonRef: number }> {
  const input = new Input({ source: new BlobSource(fixture(name)), formats: ALL_FORMATS });
  const track = (await input.getPrimaryVideoTrack())!;
  const config = (await track.getDecoderConfig())!;
  const codec = (await track.getCodec()) === 'hevc' ? 'hevc' : 'avc';
  const desc = config.description as Uint8Array;
  const ls = nalLengthSize(codec, desc instanceof Uint8Array ? desc : new Uint8Array(desc as ArrayBuffer));
  let total = 0;
  let nonRef = 0;
  let keyNonRef = 0;
  for await (const p of new EncodedPacketSink(track).packets()) {
    total++;
    if (isNonReference(codec, p.data, ls)) {
      nonRef++;
      if (p.type === 'key') keyNonRef++;
    }
  }
  input.dispose();
  return { total, nonRef, keyNonRef };
}

describe('non-reference detection', () => {
  it('finds non-reference B-frames in H.264', async () => {
    const r = await nonRefCount('h264-bframes.mp4');
    expect(r.total).toBe(60);
    expect(r.nonRef).toBeGreaterThan(20);
    expect(r.keyNonRef).toBe(0);
  });
  it('finds sub-layer non-reference pictures in HEVC', async () => {
    const r = await nonRefCount('hevc-hlg-rot90.mov');
    expect(r.nonRef).toBeGreaterThan(5);
    expect(r.nonRef).toBeLessThan(r.total);
    expect(r.keyNonRef).toBe(0);
  });
  it('handles malformed data and length sizes', () => {
    expect(isNonReference('hevc', new Uint8Array([0, 0, 0, 9, 1]), 4)).toBe(false);
    expect(isNonReference('hevc', new Uint8Array([0, 0, 0, 0]), 4)).toBe(false);
    expect(isNonReference('avc', new Uint8Array([0, 0, 0, 1, 0x06]), 4)).toBe(false); // SEI only
    expect(isNonReference('avc', new Uint8Array([0, 0, 0, 1, 0x01]), 4)).toBe(true); // ref_idc 0 slice
    expect(isNonReference('avc', new Uint8Array([0, 0, 0, 1, 0x05]), 4)).toBe(false); // IDR
    expect(isNonReference('hevc', new Uint8Array([0, 2, 0, 1]), 2)).toBe(true); // TRAIL_N
    expect(nalLengthSize('hevc', undefined)).toBe(4);
    expect(nalLengthSize('avc', new Uint8Array([1, 2, 3, 4, 0xfd]))).toBe(2);
    expect(nalLengthSize('avc', new Uint8Array(2))).toBe(4);
    expect(nalLengthSize('hevc', new Uint8Array(10))).toBe(4);
  });
});

describe('quicktime dates', () => {
  it('keeps the original offset', () => {
    expect(parseQuickTimeDate('2024-05-12T07:31:22+0200')).toEqual({
      iso: '2024-05-12T07:31:22+02:00',
      epochMs: Date.UTC(2024, 4, 12, 5, 31, 22),
    });
    expect(parseQuickTimeDate('2024-05-12T07:31:22-05:30')?.epochMs).toBe(Date.UTC(2024, 4, 12, 13, 1, 22));
    expect(parseQuickTimeDate('2024-05-12T07:31:22.5Z')?.iso).toBe('2024-05-12T07:31:22.500Z');
    expect(parseQuickTimeDate('2024-05-12 07:31')?.iso).toBe('2024-05-12T07:31:00');
    expect(parseQuickTimeDate('yesterday')).toBeNull();
    expect(parseQuickTimeDate(null)).toBeNull();
  });
  it('formats local ISO with offset', () => {
    expect(toLocalIso(Date.UTC(2024, 0, 1, 12, 0, 0), 90)).toBe('2024-01-01T13:30:00+01:30');
    expect(toLocalIso(Date.UTC(2024, 0, 1, 12, 0, 0), -300)).toBe('2024-01-01T07:00:00-05:00');
    expect(toLocalIso(0)).toMatch(/^19(69|70)-/);
  });
});

describe('isobmff', () => {
  function box(type: string, payload: Uint8Array, large = false): Uint8Array {
    const head = large ? 16 : 8;
    const out = new Uint8Array(head + payload.length);
    const v = new DataView(out.buffer);
    if (large) {
      v.setUint32(0, 1);
      v.setBigUint64(8, BigInt(out.length));
    } else v.setUint32(0, out.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(payload, head);
    return out;
  }
  const cat = (...a: Uint8Array[]) => {
    const out = new Uint8Array(a.reduce((s, x) => s + x.length, 0));
    let o = 0;
    for (const x of a) {
      out.set(x, o);
      o += x.length;
    }
    return out;
  };
  it('reads version 1 mvhd inside a large moov', async () => {
    const mvhd = new Uint8Array(4 + 8 + 8);
    mvhd[0] = 1;
    new DataView(mvhd.buffer).setBigUint64(4, BigInt(2082844800 + 86400));
    const file = cat(box('ftyp', new Uint8Array(8)), box('moov', cat(box('trak', new Uint8Array(4)), box('mvhd', mvhd)), true));
    const blob = new Blob([file as Uint8Array<ArrayBuffer>]);
    expect(await readMvhdCreationTime(blobReader(blob), blob.size)).toBe('1970-01-02T00:00:00.000Z');
  });
  it('returns null for zero time, missing boxes and garbage', async () => {
    const zero = new Blob([box('moov', box('mvhd', new Uint8Array(12))) as Uint8Array<ArrayBuffer>]);
    expect(await readMvhdCreationTime(blobReader(zero), zero.size)).toBeNull();
    const noMvhd = new Blob([box('moov', box('trak', new Uint8Array(4))) as Uint8Array<ArrayBuffer>]);
    expect(await readMvhdCreationTime(blobReader(noMvhd), noMvhd.size)).toBeNull();
    const garbage = new Blob([new Uint8Array([0, 0, 0, 2, 1, 2, 3, 4, 5])]);
    expect(await readMvhdCreationTime(blobReader(garbage), garbage.size)).toBeNull();
    const short = new Blob([new Uint8Array([0, 0])]);
    expect(await readMvhdCreationTime(blobReader(short), short.size)).toBeNull();
    // size 0 = box extends to end of file
    const toEnd = new Uint8Array(box('free', new Uint8Array(4)));
    new DataView(toEnd.buffer).setUint32(0, 0);
    expect(await findBox(blobReader(new Blob([toEnd as Uint8Array<ArrayBuffer>])), 'free', 0, toEnd.length)).toMatchObject({ type: 'free', size: 12 });
    const largeTrunc = new Uint8Array([0, 0, 0, 1, 109, 111, 111, 118, 0, 0]);
    expect(await findBox(blobReader(new Blob([largeTrunc])), 'moov', 0, largeTrunc.length)).toBeNull();
  });
});

describe('fingerprint', () => {
  it('is stable and depends on content, size and duration', async () => {
    const a = new Blob([new Uint8Array(10_000).fill(1)]);
    const b = new Blob([new Uint8Array(10_000).fill(2)]);
    const fa = await fingerprint(a, 12.3456);
    expect(fa).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(await fingerprint(a, 12.3456)).toBe(fa);
    expect(await fingerprint(b, 12.3456)).not.toBe(fa);
    expect(await fingerprint(a, 12.4)).not.toBe(fa);
  });
  it('hashes only head and tail of large files', async () => {
    const big = new Uint8Array(9 * 1024 * 1024);
    const f1 = await fingerprint(new Blob([big]), 1);
    big[4.5 * 1024 * 1024] = 7; // middle byte is not part of the hash
    expect(await fingerprint(new Blob([big]), 1)).toBe(f1);
    big[big.length - 1] = 7;
    expect(await fingerprint(new Blob([big]), 1)).not.toBe(f1);
  });
});

describe('gray helpers', () => {
  it('converts RGBA to luma', () => {
    expect(Array.from(rgbaToGray(new Uint8Array([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255])))).toEqual([255, 0, 77]);
  });
  it('computes target and rotated sizes', () => {
    expect(targetSize(3840, 2160, 160)).toEqual({ width: 160, height: 90 });
    expect(targetSize(2160, 3840, 160)).toEqual({ width: 90, height: 160 });
    expect(rotatedSize(3840, 2160, 90)).toEqual({ width: 2160, height: 3840 });
    expect(rotatedSize(3840, 2160, 180)).toEqual({ width: 3840, height: 2160 });
  });
  it('applies rotation transforms', () => {
    for (const rot of [0, 90, 180, 270] as const) {
      const calls: string[] = [];
      const ctx = {
        save: () => calls.push('save'),
        restore: () => calls.push('restore'),
        translate: (x: number, y: number) => calls.push(`t${x},${y}`),
        rotate: (a: number) => calls.push(`r${Math.round((a * 180) / Math.PI)}`),
        drawImage: (_i: unknown, x: number, y: number, w: number, h: number) => calls.push(`d${x},${y},${w},${h}`),
      };
      drawRotated(ctx as unknown as CanvasRenderingContext2D, {} as CanvasImageSource, rot, 90, 160);
      const expected: Record<number, string[]> = {
        0: ['save', 'd0,0,90,160', 'restore'],
        90: ['save', 't90,0', 'r90', 'd0,0,160,90', 'restore'],
        180: ['save', 't90,160', 'r180', 'd0,0,90,160', 'restore'],
        270: ['save', 't0,160', 'r-90', 'd0,0,160,90', 'restore'],
      };
      expect(calls).toEqual(expected[rot]);
    }
  });
});

describe('codec description', () => {
  it('names common profiles', () => {
    expect(describeCodec('hvc1.2.4.L153.B0')).toBe('HEVC Main 10');
    expect(describeCodec('hev1.1.6.L93.B0')).toBe('HEVC Main');
    expect(describeCodec('hvc1.9.4.L93')).toBe('HEVC profile 9');
    expect(describeCodec('avc1.640028')).toBe('H.264 High');
    expect(describeCodec('avc1.FF0028')).toBe('H.264 profile 255');
    expect(describeCodec('vp09.00.10.08')).toBe('VP9 profile 0');
    expect(describeCodec('av01.0.04M.08')).toBe('AV1 profile 0');
    expect(describeCodec('mp4v.20.9')).toBe('mp4v');
    expect(describeCodec(null)).toBeNull();
  });
});

describe('HLG tone mapping', () => {
  it('implements the BT.2100 HLG inverse OETF', () => {
    expect(hlgInverseOetf(0)).toBe(0);
    expect(hlgInverseOetf(-1)).toBe(0);
    expect(hlgInverseOetf(0.5)).toBeCloseTo(1 / 12, 6);
    expect(hlgInverseOetf(1)).toBeCloseTo(1, 3);
  });
  it('maps HLG 75% grey near SDR white and black to black', () => {
    const out = new Uint8ClampedArray(8);
    hlgPixelToSrgb(0.75, 0.75, 0.75, out, 0);
    expect(out[0]).toBeGreaterThan(230);
    expect(out[0]).toBe(out[1]);
    expect(out[3]).toBe(255);
    hlgPixelToSrgb(0, 0, 0, out, 4);
    expect(Array.from(out.subarray(4))).toEqual([0, 0, 0, 255]);
  });
  it('soft knee and sRGB OETF behave', () => {
    expect(softKnee(0.5)).toBe(0.5);
    expect(softKnee(100)).toBeCloseTo(1, 5);
    expect(srgbOetf(0)).toBe(0);
    expect(srgbOetf(2)).toBeCloseTo(1);
    expect(srgbOetf(0.001)).toBeCloseTo(0.01292);
  });
  it('converts 10-bit YCbCr', () => {
    expect(yuv10ToRgb(64, 512, 512, false).map((v) => Math.round(v * 1000) / 1000)).toEqual([0, 0, 0]);
    expect(yuv10ToRgb(940, 512, 512, false).map((v) => Math.round(v * 1000) / 1000)).toEqual([1, 1, 1]);
    expect(yuv10ToRgb(1023, 512, 512, true)[0]).toBeCloseTo(1);
  });
});

describe('codec variants', () => {
  it('tries hvc1 and hev1 for HEVC', () => {
    expect(codecVariants('hev1.2.4.L60.90')).toEqual(['hev1.2.4.L60.90', 'hvc1.2.4.L60.90']);
    expect(codecVariants('hvc1.1.6.L93.B0')).toEqual(['hvc1.1.6.L93.B0', 'hev1.1.6.L93.B0']);
    expect(codecVariants('avc1.640028')).toEqual(['avc1.640028']);
  });
});
