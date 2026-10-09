/**
 * Minimal ZIP (STORE only) writer and reader, no dependencies.
 *
 * The writer computes CRC-32 by streaming each entry once and returns a Blob made of the header
 * bytes and the original entry Blobs, so file contents are never copied into memory. ZIP64
 * records are written only when a size, offset or the entry count needs them (or when forced).
 * The reader parses the end-of-central-directory record (+ ZIP64 locator) and the central
 * directory, and hands out entries as lazy slices of the input; compressed or encrypted entries
 * are rejected.
 */

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_LOCATOR64 = 0x07064b50;
const MAX16 = 0xffff;
const MAX32 = 0xffffffff;
const FLAG_UTF8 = 0x0800;
const FLAG_ENCRYPTED = 0x0001;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** Incremental CRC-32 (start with `crc32Update(0, …)`; the result is the final CRC). */
export function crc32Update(crc: number, bytes: Uint8Array): number {
  let c = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return ~c >>> 0;
}

/** CRC-32 of a Blob, read as a stream. `onBytes` receives the size of every chunk read. */
export async function crc32Blob(blob: Blob, onBytes?: (n: number) => void): Promise<number> {
  const reader = blob.stream().getReader();
  let crc = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return crc;
    crc = crc32Update(crc, value);
    onBytes?.(value.length);
  }
}

export interface ZipInput {
  name: string;
  data: Blob;
  modified?: Date;
}

export interface ZipOptions {
  /** Write ZIP64 records even when not needed (tests). */
  forceZip64?: boolean;
  /** Bytes read for the CRC so far, of the total. */
  onProgress?: (done: number, total: number) => void;
}

function setU64(v: DataView, at: number, n: number) {
  v.setUint32(at, n % 0x100000000, true);
  v.setUint32(at + 4, Math.floor(n / 0x100000000), true);
}

function getU64(v: DataView, at: number): number {
  return v.getUint32(at, true) + v.getUint32(at + 4, true) * 0x100000000;
}

function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.min(2107, Math.max(1980, d.getFullYear()));
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

const utf8 = new TextEncoder();

/** Builds a STORE-only ZIP archive. */
export async function createZip(inputs: ZipInput[], opts: ZipOptions = {}): Promise<Blob> {
  const total = inputs.reduce((s, e) => s + e.data.size, 0);
  let read = 0;
  const parts: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  const seen = new Set<string>();

  for (const input of inputs) {
    if (seen.has(input.name)) throw new Error(`Duplicate ZIP entry "${input.name}"`);
    seen.add(input.name);
    const name = utf8.encode(input.name);
    const size = input.data.size;
    const crc = await crc32Blob(input.data, (n) => opts.onProgress?.((read += n), total));
    const { time, date } = dosDateTime(input.modified ?? new Date());
    const bigSize = opts.forceZip64 || size >= MAX32;
    const bigOffset = opts.forceZip64 || offset >= MAX32;
    const version = bigSize || bigOffset ? 45 : 20;

    const local = new Uint8Array(30 + name.length + (bigSize ? 20 : 0));
    const lv = new DataView(local.buffer);
    lv.setUint32(0, SIG_LOCAL, true);
    lv.setUint16(4, version, true);
    lv.setUint16(6, FLAG_UTF8, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, bigSize ? MAX32 : size, true);
    lv.setUint32(22, bigSize ? MAX32 : size, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, bigSize ? 20 : 0, true);
    local.set(name, 30);
    if (bigSize) {
      const x = 30 + name.length;
      lv.setUint16(x, 0x0001, true);
      lv.setUint16(x + 2, 16, true);
      setU64(lv, x + 4, size);
      setU64(lv, x + 12, size);
    }

    const extra64 = (bigSize ? 16 : 0) + (bigOffset ? 8 : 0);
    const cd = new Uint8Array(46 + name.length + (extra64 ? 4 + extra64 : 0));
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, SIG_CENTRAL, true);
    cv.setUint16(4, 45, true);
    cv.setUint16(6, version, true);
    cv.setUint16(8, FLAG_UTF8, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, bigSize ? MAX32 : size, true);
    cv.setUint32(24, bigSize ? MAX32 : size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, extra64 ? 4 + extra64 : 0, true);
    cv.setUint32(42, bigOffset ? MAX32 : offset, true);
    cd.set(name, 46);
    if (extra64) {
      let x = 46 + name.length;
      cv.setUint16(x, 0x0001, true);
      cv.setUint16(x + 2, extra64, true);
      x += 4;
      if (bigSize) {
        setU64(cv, x, size);
        setU64(cv, x + 8, size);
        x += 16;
      }
      if (bigOffset) setU64(cv, x, offset);
    }

    parts.push(local, input.data);
    central.push(cd);
    offset += local.length + size;
  }

  const cdOffset = offset;
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const count = inputs.length;
  parts.push(...central);
  const big = opts.forceZip64 || count >= MAX16 || cdOffset >= MAX32 || cdSize >= MAX32;
  if (big) {
    const e64 = new Uint8Array(56 + 20);
    const v = new DataView(e64.buffer);
    v.setUint32(0, SIG_EOCD64, true);
    setU64(v, 4, 44);
    v.setUint16(12, 45, true);
    v.setUint16(14, 45, true);
    setU64(v, 24, count);
    setU64(v, 32, count);
    setU64(v, 40, cdSize);
    setU64(v, 48, cdOffset);
    v.setUint32(56, SIG_LOCATOR64, true);
    setU64(v, 64, cdOffset + cdSize);
    v.setUint32(72, 1, true);
    parts.push(e64);
  }
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, SIG_EOCD, true);
  ev.setUint16(8, big ? MAX16 : count, true);
  ev.setUint16(10, big ? MAX16 : count, true);
  ev.setUint32(12, big ? MAX32 : cdSize, true);
  ev.setUint32(16, big ? MAX32 : cdOffset, true);
  parts.push(eocd);
  return new Blob(parts, { type: 'application/zip' });
}

export interface ZipEntry {
  name: string;
  size: number;
  crc32: number;
  /** The entry's bytes as a slice of the archive (nothing is read until the Blob is). */
  data(): Promise<Blob>;
}

export class ZipError extends Error {
  override name = 'ZipError';
}

async function bytesAt(blob: Blob, start: number, end: number): Promise<DataView> {
  if (start < 0 || end > blob.size) throw new ZipError('Unexpected end of file');
  return new DataView(await blob.slice(start, end).arrayBuffer());
}

/** Parses the central directory of a STORE-only ZIP archive. */
export async function readZip(zip: Blob): Promise<ZipEntry[]> {
  if (zip.size < 22) throw new ZipError('Not a ZIP file');
  const tailStart = Math.max(0, zip.size - (22 + MAX16));
  const tail = await bytesAt(zip, tailStart, zip.size);
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('Not a ZIP file (no end of central directory)');
  let count = tail.getUint16(eocd + 10, true);
  let cdSize = tail.getUint32(eocd + 12, true);
  let cdOffset = tail.getUint32(eocd + 16, true);
  if (count === MAX16 || cdSize === MAX32 || cdOffset === MAX32) {
    const locAt = tailStart + eocd - 20;
    const loc = await bytesAt(zip, locAt, locAt + 20);
    if (loc.getUint32(0, true) !== SIG_LOCATOR64) throw new ZipError('Missing ZIP64 locator');
    const e64At = getU64(loc, 8);
    const e64 = await bytesAt(zip, e64At, e64At + 56);
    if (e64.getUint32(0, true) !== SIG_EOCD64) throw new ZipError('Missing ZIP64 end of central directory');
    count = getU64(e64, 32);
    cdSize = getU64(e64, 40);
    cdOffset = getU64(e64, 48);
  }
  const cd = await bytesAt(zip, cdOffset, cdOffset + cdSize);
  const names = new TextDecoder();
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cd.byteLength || cd.getUint32(p, true) !== SIG_CENTRAL) throw new ZipError('Corrupt central directory');
    const flags = cd.getUint16(p + 8, true);
    const method = cd.getUint16(p + 10, true);
    const crc = cd.getUint32(p + 16, true);
    let csize = cd.getUint32(p + 20, true);
    let size = cd.getUint32(p + 24, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    let local = cd.getUint32(p + 42, true);
    const name = names.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));
    let x = p + 46 + nameLen;
    const extraEnd = x + extraLen;
    while (x + 4 <= extraEnd) {
      const id = cd.getUint16(x, true);
      const len = cd.getUint16(x + 2, true);
      if (id === 0x0001) {
        let f = x + 4;
        if (size === MAX32) (size = getU64(cd, f)), (f += 8);
        if (csize === MAX32) (csize = getU64(cd, f)), (f += 8);
        if (local === MAX32) local = getU64(cd, f);
      }
      x += 4 + len;
    }
    if (flags & FLAG_ENCRYPTED) throw new ZipError(`"${name}" is encrypted`);
    if (method !== 0 || csize !== size) throw new ZipError(`"${name}" is compressed; only uncompressed archives are supported`);
    const at = local;
    entries.push({
      name,
      size,
      crc32: crc,
      async data() {
        const h = await bytesAt(zip, at, at + 30);
        if (h.getUint32(0, true) !== SIG_LOCAL) throw new ZipError(`Corrupt local header of "${name}"`);
        const start = at + 30 + h.getUint16(26, true) + h.getUint16(28, true);
        if (start + size > zip.size) throw new ZipError(`"${name}" is truncated`);
        return zip.slice(start, start + size);
      },
    });
    p = extraEnd + commentLen;
  }
  return entries;
}
