import { describe, expect, it } from 'vitest';
import { exifSegment, toAscii, withPhotoMetadata, xmpPacket, type PhotoMetadata } from './metadata';

/** Minimal big-endian TIFF reader: tag → value (ASCII as string, numbers, rationals as [n, d]). */
function readIfds(seg: Uint8Array): Map<number, unknown>[] {
  expect([seg[0], seg[1]]).toEqual([0xff, 0xe1]);
  const len = (seg[2]! << 8) | seg[3]!;
  expect(len).toBe(seg.length - 2);
  expect(new TextDecoder().decode(seg.subarray(4, 10))).toBe('Exif\0\0');
  const tiff = seg.subarray(10);
  const v = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  expect(v.getUint16(0)).toBe(0x4d4d);
  expect(v.getUint16(2)).toBe(42);
  const sizes: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 };
  const read = (at: number): Map<number, unknown> => {
    const m = new Map<number, unknown>();
    const n = v.getUint16(at);
    for (let i = 0; i < n; i++) {
      const p = at + 2 + i * 12;
      const tag = v.getUint16(p);
      const type = v.getUint16(p + 2);
      const count = v.getUint32(p + 4);
      const bytes = count * sizes[type]!;
      const off = bytes <= 4 ? p + 8 : v.getUint32(p + 8);
      if (i > 0) expect(tag).toBeGreaterThan(v.getUint16(p - 12));
      if (type === 2) m.set(tag, new TextDecoder().decode(tiff.subarray(off, off + count - 1)));
      else if (type === 3) m.set(tag, v.getUint16(off));
      else if (type === 4) m.set(tag, v.getUint32(off));
      else if (type === 5) m.set(tag, Array.from({ length: count }, (_, k) => [v.getUint32(off + k * 8), v.getUint32(off + k * 8 + 4)]));
      else m.set(tag, tiff.slice(off, off + count));
    }
    expect(v.getUint32(at + 2 + n * 12)).toBe(0);
    return m;
  };
  const ifd0 = read(v.getUint32(4));
  const out = [ifd0, read(ifd0.get(0x8769) as number)];
  if (ifd0.has(0x8825)) out.push(read(ifd0.get(0x8825) as number));
  return out;
}

const full: PhotoMetadata = {
  title: 'Utthita Trikonasana',
  description: 'Utthita Trikonasana · Right',
  keywords: ['Utthita Trikonasana', 'Standing', 'yoga'],
  takenAt: { local: '2026-10-14T07:31:05.250', offset: '+02:00' },
  gps: { lat: 52.52, lon: -13.405, altM: 34.5 },
  make: 'Apple',
  model: 'iPhone 15',
  creatorTool: 'asana-progression',
  place: 'Park <& Co>',
  url: 'https://example.org/app/#/asana/utthita-trikonasana',
  width: 1240,
  height: 1860,
};

describe('photo metadata', () => {
  it('writes EXIF with date, offset, camera, size, link and GPS', () => {
    const [ifd0, exif, gps] = readIfds(exifSegment(full));
    expect(ifd0!.get(0x010e)).toBe('Utthita Trikonasana - Right');
    expect(ifd0!.get(0x010f)).toBe('Apple');
    expect(ifd0!.get(0x0110)).toBe('iPhone 15');
    expect(ifd0!.get(0x0112)).toBe(1);
    expect(ifd0!.get(0x0131)).toBe('asana-progression');
    expect(ifd0!.get(0x0132)).toBe('2026:10:14 07:31:05');
    expect(exif!.get(0x9003)).toBe('2026:10:14 07:31:05');
    expect(exif!.get(0x9291)).toBe('250');
    expect(exif!.get(0x9011)).toBe('+02:00');
    expect(exif!.get(0xa002)).toBe(1240);
    expect(exif!.get(0xa003)).toBe(1860);
    expect(new TextDecoder().decode(exif!.get(0x9286) as Uint8Array)).toBe(`ASCII\0\0\0${full.url}`);
    expect(gps!.get(0x0001)).toBe('N');
    expect(gps!.get(0x0002)).toEqual([[52, 1], [31, 1], [12000, 1000]]);
    expect(gps!.get(0x0003)).toBe('W');
    expect(gps!.get(0x0004)).toEqual([[13, 1], [24, 1], [18000, 1000]]);
    expect(gps!.get(0x0006)).toEqual([[3450, 100]]);
  });

  it('keeps EXIF text ASCII', () => {
    expect(toAscii('Ūrdhva Dhanurāsana · L ✓')).toBe('Urdhva Dhanurasana - L ?');
  });

  it('leaves out what is unknown', () => {
    const ifds = readIfds(exifSegment({ title: 'Navasana' }));
    expect(ifds).toHaveLength(2);
    expect([...ifds[0]!.keys()]).toEqual([0x010e, 0x0112, 0x8769]);
    expect([...ifds[1]!.keys()]).toEqual([0x9000]);
    expect(readIfds(exifSegment({ title: 'x', takenAt: { local: 'nonsense' } }))[0]!.has(0x0132)).toBe(false);
  });

  it('writes XMP with escaped text', () => {
    const x = xmpPacket(full);
    expect(x).toContain('<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Utthita Trikonasana</rdf:li></rdf:Alt></dc:title>');
    expect(x).toContain('<rdf:li>Standing</rdf:li>');
    expect(x).toContain('<photoshop:DateCreated>2026-10-14T07:31:05.250+02:00</photoshop:DateCreated>');
    expect(x).toContain('<Iptc4xmpCore:Location>Park &lt;&amp; Co&gt;</Iptc4xmpCore:Location>');
    expect(x).toContain(`<dc:source>${full.url}</dc:source>`);
    expect(xmpPacket({ title: 'x' })).not.toContain('DateCreated');
  });

  it('inserts both segments after SOI without touching the image data', async () => {
    const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 1, 2, 0xff, 0xd9])]);
    const out = new Uint8Array(await (await withPhotoMetadata(jpeg, full)).arrayBuffer());
    expect([...out.subarray(0, 4)]).toEqual([0xff, 0xd8, 0xff, 0xe1]);
    expect([...out.subarray(out.length - 8)]).toEqual([0xff, 0xe0, 0, 4, 1, 2, 0xff, 0xd9]);
    expect(new TextDecoder().decode(out)).toContain('http://ns.adobe.com/xap/1.0/\0<?xpacket');
    await expect(withPhotoMetadata(new Blob([new Uint8Array([1, 2])]), full)).rejects.toThrow('Not a JPEG');
  });
});
