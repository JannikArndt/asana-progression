/**
 * Photo metadata for exported JPEGs: an EXIF segment (TIFF, big-endian) and an XMP segment,
 * inserted right after the JPEG's SOI marker. The image data is not touched (no re-encoding);
 * the result is a Blob made of the new segments and a slice of the original.
 */

export interface PhotoMetadata {
  /** Short title, e.g. the asana name. */
  title: string;
  /** Caption, e.g. "Utthita Trikonasana · Right · rep 2 of 5". */
  description?: string;
  keywords?: string[];
  /**
   * When the photographed moment happened: the wall-clock time of the recording, `YYYY-MM-DDTHH:MM:SS`
   * with optional fraction, and its UTC offset (`+02:00`) when known.
   */
  takenAt?: { local: string; offset?: string };
  gps?: { lat: number; lon: number; altM?: number | null };
  /** Camera of the source video (e.g. "Apple", "iPhone 15"). */
  make?: string;
  model?: string;
  /** Name of the app that made the photo (EXIF Software, XMP CreatorTool). */
  creatorTool?: string;
  /** Where the photo was taken (a place name). */
  place?: string;
  /** Link back to the app (e.g. the asana's progression page). */
  url?: string;
  width?: number;
  height?: number;
}

const ASCII = 2;
const SHORT = 3;
const LONG = 4;
const RATIONAL = 5;
const BYTE = 1;
const UNDEFINED = 7;
const TYPE_SIZE: Record<number, number> = { [BYTE]: 1, [ASCII]: 1, [SHORT]: 2, [LONG]: 4, [RATIONAL]: 8, [UNDEFINED]: 1 };

interface Entry {
  tag: number;
  type: number;
  /** Raw value bytes (big-endian); `count` is derived from them. */
  bytes: Uint8Array;
  /** For IFD pointers: index of the sub-IFD whose offset this entry holds. */
  pointsTo?: number;
}

const utf8 = new TextEncoder();

/** EXIF text is 7-bit ASCII: diacritics dropped, "·" → "-", anything else non-ASCII → "?" (XMP keeps Unicode). */
export function toAscii(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/·/g, '-')
    .replace(/[^\x20-\x7e]/g, '?');
}

function ascii(tag: number, text: string): Entry {
  const b = utf8.encode(toAscii(text));
  const bytes = new Uint8Array(b.length + 1);
  bytes.set(b);
  return { tag, type: ASCII, bytes };
}

function short(tag: number, v: number): Entry {
  return { tag, type: SHORT, bytes: new Uint8Array([(v >> 8) & 0xff, v & 0xff]) };
}

function long(tag: number, v: number): Entry {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, v);
  return { tag, type: LONG, bytes };
}

function rationals(tag: number, values: Array<[number, number]>): Entry {
  const bytes = new Uint8Array(values.length * 8);
  const v = new DataView(bytes.buffer);
  values.forEach(([n, d], i) => {
    v.setUint32(i * 8, n);
    v.setUint32(i * 8 + 4, d);
  });
  return { tag, type: RATIONAL, bytes };
}

/** Degrees → degrees, minutes, seconds (seconds with 1/1000 precision). */
function dms(deg: number): Array<[number, number]> {
  const a = Math.abs(deg);
  const d = Math.floor(a);
  const mFull = (a - d) * 60;
  const m = Math.floor(mFull);
  const s = Math.round((mFull - m) * 60 * 1000);
  return [
    [d, 1],
    [m, 1],
    [s, 1000],
  ];
}

/** Lays out IFDs (each: entries, then their out-of-line values) from TIFF offset `start`. */
function layoutIfds(ifds: Entry[][], start: number): Uint8Array {
  const sizes = ifds.map((entries) => 2 + entries.length * 12 + 4 + entries.reduce((s, e) => s + (e.bytes.length > 4 ? e.bytes.length + (e.bytes.length & 1) : 0), 0));
  const offsets: number[] = [];
  let at = start;
  for (const s of sizes) {
    offsets.push(at);
    at += s;
  }
  const out = new Uint8Array(at - start);
  const v = new DataView(out.buffer);
  ifds.forEach((entries, i) => {
    const sorted = [...entries].sort((a, b) => a.tag - b.tag);
    let p = offsets[i]! - start;
    let data = p + 2 + sorted.length * 12 + 4;
    v.setUint16(p, sorted.length);
    p += 2;
    for (const e of sorted) {
      const bytes = e.pointsTo !== undefined ? long(e.tag, offsets[e.pointsTo]!).bytes : e.bytes;
      v.setUint16(p, e.tag);
      v.setUint16(p + 2, e.type);
      v.setUint32(p + 4, bytes.length / TYPE_SIZE[e.type]!);
      if (bytes.length <= 4) out.set(bytes, p + 8);
      else {
        v.setUint32(p + 8, data + start);
        out.set(bytes, data);
        data += bytes.length + (bytes.length & 1);
      }
      p += 12;
    }
    v.setUint32(p, 0); // no next IFD
  });
  return out;
}

/** "2026-10-14T07:31:05.250" → { dateTime: "2026:10:14 07:31:05", subSec: "250" } */
function exifDateTime(local: string): { dateTime: string; subSec?: string; iso: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(local);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, frac] = m;
  return { dateTime: `${y}:${mo}:${d} ${h}:${mi}:${s}`, ...(frac ? { subSec: frac } : {}), iso: `${y}-${mo}-${d}T${h}:${mi}:${s}` };
}

/** The EXIF APP1 segment (marker included). */
export function exifSegment(meta: PhotoMetadata): Uint8Array {
  const ifd0: Entry[] = [];
  const exif: Entry[] = [];
  const gps: Entry[] = [];
  if (meta.description ?? meta.title) ifd0.push(ascii(0x010e, meta.description ?? meta.title));
  if (meta.make) ifd0.push(ascii(0x010f, meta.make));
  if (meta.model) ifd0.push(ascii(0x0110, meta.model));
  ifd0.push(short(0x0112, 1));
  if (meta.creatorTool) ifd0.push(ascii(0x0131, meta.creatorTool));

  exif.push({ tag: 0x9000, type: UNDEFINED, bytes: utf8.encode('0232') });
  const t = meta.takenAt && exifDateTime(meta.takenAt.local);
  if (t) {
    ifd0.push(ascii(0x0132, t.dateTime));
    exif.push(ascii(0x9003, t.dateTime), ascii(0x9004, t.dateTime));
    if (t.subSec) exif.push(ascii(0x9291, t.subSec), ascii(0x9292, t.subSec));
    if (meta.takenAt!.offset) exif.push(ascii(0x9010, meta.takenAt!.offset), ascii(0x9011, meta.takenAt!.offset), ascii(0x9012, meta.takenAt!.offset));
  }
  if (meta.url) {
    // UserComment: 8-byte character code, then the text.
    const text = utf8.encode(meta.url);
    const bytes = new Uint8Array(8 + text.length);
    bytes.set(utf8.encode('ASCII\0\0\0'));
    bytes.set(text, 8);
    exif.push({ tag: 0x9286, type: UNDEFINED, bytes });
  }
  if (meta.width && meta.height) exif.push(long(0xa002, meta.width), long(0xa003, meta.height));

  ifd0.push({ tag: 0x8769, type: LONG, bytes: new Uint8Array(4), pointsTo: 1 });
  if (meta.gps && Number.isFinite(meta.gps.lat) && Number.isFinite(meta.gps.lon)) {
    const { lat, lon, altM } = meta.gps;
    gps.push(
      { tag: 0x0000, type: BYTE, bytes: new Uint8Array([2, 3, 0, 0]) },
      ascii(0x0001, lat >= 0 ? 'N' : 'S'),
      rationals(0x0002, dms(lat)),
      ascii(0x0003, lon >= 0 ? 'E' : 'W'),
      rationals(0x0004, dms(lon)),
    );
    if (altM !== null && altM !== undefined && Number.isFinite(altM)) {
      gps.push({ tag: 0x0005, type: BYTE, bytes: new Uint8Array([altM < 0 ? 1 : 0]) }, rationals(0x0006, [[Math.round(Math.abs(altM) * 100), 100]]));
    }
    ifd0.push({ tag: 0x8825, type: LONG, bytes: new Uint8Array(4), pointsTo: 2 });
  }

  const ifds = gps.length ? [ifd0, exif, gps] : [ifd0, exif];
  const body = layoutIfds(ifds, 8);
  const header = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0, 0, 0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8]); // "Exif\0\0" "MM" 42 IFD0 at 8
  return segment(0xe1, concat(header, body));
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The XMP packet (Dublin Core title/description/keywords, dates, place, link). */
export function xmpPacket(meta: PhotoMetadata): string {
  const alt = (tag: string, text: string) => `<${tag}><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(text)}</rdf:li></rdf:Alt></${tag}>`;
  const props: string[] = [alt('dc:title', meta.title)];
  if (meta.description) props.push(alt('dc:description', meta.description));
  if (meta.keywords?.length) props.push(`<dc:subject><rdf:Bag>${meta.keywords.map((k) => `<rdf:li>${xmlEscape(k)}</rdf:li>`).join('')}</rdf:Bag></dc:subject>`);
  if (meta.url) props.push(`<dc:source>${xmlEscape(meta.url)}</dc:source>`, `<dc:relation><rdf:Bag><rdf:li>${xmlEscape(meta.url)}</rdf:li></rdf:Bag></dc:relation>`);
  const t = meta.takenAt && exifDateTime(meta.takenAt.local);
  if (t) {
    const iso = `${meta.takenAt!.local.replace(' ', 'T')}${meta.takenAt!.offset ?? ''}`;
    props.push(`<photoshop:DateCreated>${iso}</photoshop:DateCreated>`, `<xmp:CreateDate>${iso}</xmp:CreateDate>`, `<exif:DateTimeOriginal>${iso}</exif:DateTimeOriginal>`);
  }
  if (meta.creatorTool) props.push(`<xmp:CreatorTool>${xmlEscape(meta.creatorTool)}</xmp:CreatorTool>`);
  if (meta.place) props.push(`<Iptc4xmpCore:Location>${xmlEscape(meta.place)}</Iptc4xmpCore:Location>`);
  return (
    `<?xpacket begin="\u{feff}" id="W5M0MpCehiHzreSzNTczkc9d"?>` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
    `<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/"` +
    ` xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" xmlns:exif="http://ns.adobe.com/exif/1.0/"` +
    ` xmlns:Iptc4xmpCore="http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/">` +
    props.join('') +
    `</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`
  );
}

/** The XMP APP1 segment (marker included). */
export function xmpSegment(meta: PhotoMetadata): Uint8Array {
  return segment(0xe1, concat(utf8.encode('http://ns.adobe.com/xap/1.0/\0'), utf8.encode(xmpPacket(meta))));
}

function segment(marker: number, payload: Uint8Array): Uint8Array {
  if (payload.length + 2 > 0xffff) throw new Error('Metadata too large for one JPEG segment');
  const out = new Uint8Array(4 + payload.length);
  out[0] = 0xff;
  out[1] = marker;
  new DataView(out.buffer).setUint16(2, payload.length + 2);
  out.set(payload, 4);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * The JPEG with EXIF and XMP segments right after its SOI marker (any EXIF/XMP it had stays
 * behind them; canvas encoders write none). Throws if `jpeg` does not start with SOI.
 */
export async function withPhotoMetadata(jpeg: Blob, meta: PhotoMetadata): Promise<Blob> {
  const head = new Uint8Array(await jpeg.slice(0, 2).arrayBuffer());
  if (head[0] !== 0xff || head[1] !== 0xd8) throw new Error('Not a JPEG');
  return new Blob([head, exifSegment(meta) as Uint8Array<ArrayBuffer>, xmpSegment(meta) as Uint8Array<ArrayBuffer>, jpeg.slice(2)], { type: 'image/jpeg' });
}
