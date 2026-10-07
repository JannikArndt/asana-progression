/** Minimal ISO-BMFF box walking, used for fields Mediabunny does not expose (mvhd creation_time). */

export type ReadAt = (offset: number, length: number) => Promise<Uint8Array>;

interface BoxHeader {
  type: string;
  start: number;
  headerSize: number;
  size: number;
}

async function readHeader(read: ReadAt, offset: number, end: number): Promise<BoxHeader | null> {
  if (offset + 8 > end) return null;
  const b = await read(offset, Math.min(16, end - offset));
  if (b.length < 8) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let size = v.getUint32(0);
  const type = String.fromCharCode(b[4]!, b[5]!, b[6]!, b[7]!);
  let headerSize = 8;
  if (size === 1) {
    if (b.length < 16) return null;
    size = Number(v.getBigUint64(8));
    headerSize = 16;
  } else if (size === 0) {
    size = end - offset;
  }
  if (size < headerSize) return null;
  return { type, start: offset, headerSize, size };
}

/** Finds the first box of `type` among the children in [start, end). */
export async function findBox(read: ReadAt, type: string, start: number, end: number): Promise<BoxHeader | null> {
  let offset = start;
  while (offset < end) {
    const h = await readHeader(read, offset, end);
    if (!h) return null;
    if (h.type === type) return h;
    offset += h.size;
  }
  return null;
}

const SECONDS_1904_TO_1970 = 2082844800;

/** `mvhd` creation_time as an ISO string (UTC), or null if absent/zero. */
export async function readMvhdCreationTime(read: ReadAt, fileSize: number): Promise<string | null> {
  const moov = await findBox(read, 'moov', 0, fileSize);
  if (!moov) return null;
  const mvhd = await findBox(read, 'mvhd', moov.start + moov.headerSize, moov.start + moov.size);
  if (!mvhd) return null;
  const b = await read(mvhd.start + mvhd.headerSize, 12);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const version = b[0];
  const seconds = version === 1 ? Number(v.getBigUint64(4)) : v.getUint32(4);
  if (!seconds) return null;
  return new Date((seconds - SECONDS_1904_TO_1970) * 1000).toISOString();
}

export function blobReader(blob: Blob): ReadAt {
  return async (offset, length) => new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());
}
