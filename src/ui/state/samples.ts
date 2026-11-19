import { blobSampleReader, openSampleReader, OpfsAssetStore, sampleFileName, type SampleReader } from '../../storage';
import { gunzip, samplesKey } from '../../sync';
import { remoteFile } from './remote';

/** The local frame file, else the server's copy (kept in OPFS for next time). */
async function openReader(videoId: string, recordBytes: number): Promise<SampleReader | null> {
  const local = await openSampleReader(sampleFileName(videoId), recordBytes);
  if (local) return local;
  const gz = await remoteFile(samplesKey(videoId));
  if (!gz) return null;
  const raw = await gunzip(gz);
  await new OpfsAssetStore().put(sampleFileName(videoId), raw).catch(() => {});
  return blobSampleReader(raw, recordBytes);
}

/** Cached read-only access to a video's stored analysis frames (main thread). */
const readers = new Map<string, Promise<SampleReader | null>>();

export function sampleReader(videoId: string, recordBytes: number): Promise<SampleReader | null> {
  const key = `${videoId}:${recordBytes}`;
  let r = readers.get(key);
  if (!r) {
    r = openReader(videoId, recordBytes).catch(() => null);
    readers.set(key, r);
  }
  return r;
}

/** Call after the sample file changed (processing finished, re-analysis). */
export function invalidateSamples(videoId: string) {
  for (const k of [...readers.keys()]) if (k.startsWith(`${videoId}:`)) readers.delete(k);
}

/** Gray bytes → RGBA ImageData. */
export function grayToImageData(data: Uint8Array, width: number, height: number): ImageData {
  const img = new ImageData(width, height);
  for (let i = 0, j = 0; i < width * height; i++, j += 4) {
    const v = data[i] ?? 0;
    img.data[j] = v;
    img.data[j + 1] = v;
    img.data[j + 2] = v;
    img.data[j + 3] = 255;
  }
  return img;
}
