const CHUNK = 4 * 1024 * 1024;

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * SHA-256 of the first and last 4 MiB + file size + duration (ms). Cheap to compute on huge files
 * and stable across copies of the same recording.
 */
export async function fingerprint(blob: Blob, durationS: number): Promise<string> {
  const head = new Uint8Array(await blob.slice(0, Math.min(CHUNK, blob.size)).arrayBuffer());
  const tail = new Uint8Array(await blob.slice(Math.max(0, blob.size - CHUNK)).arrayBuffer());
  const suffix = new TextEncoder().encode(`|${blob.size}|${Math.round(durationS * 1000)}`);
  const all = new Uint8Array(head.length + tail.length + suffix.length);
  all.set(head, 0);
  all.set(tail, head.length);
  all.set(suffix, head.length + tail.length);
  return `sha256:${hex(await crypto.subtle.digest('SHA-256', all))}`;
}
