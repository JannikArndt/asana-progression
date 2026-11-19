/**
 * Where the app runs and how it reaches its server. Usable in workers too (no Svelte state).
 *
 *  - 'server': served by the app's own server (asana.jannikarndt.de): passkey sign-in, sync.
 *  - 'legacy': the old GitHub Pages copy; its only server job is moving the data over.
 *  - 'local':  anything else without the server (vite dev/preview, e2e tests): no sync.
 */
export const SERVER_ORIGIN = 'https://asana.jannikarndt.de';
export const LEGACY_HOST = 'jannikarndt.github.io';

export function isLegacyHost(): boolean {
  return globalThis.location?.hostname === LEGACY_HOST;
}

/**
 * A file from the server (asset or gzipped analysis frames) for a device that has the records
 * but not yet the file. Null when there is no server, no sign-in, or no such file.
 */
export async function remoteFile(key: string): Promise<Blob | null> {
  if (!/^(assets|samples)\//.test(key) || isLegacyHost() || typeof fetch !== 'function') return null;
  try {
    const res = await fetch(`/api/files/${key}`, { credentials: 'same-origin' });
    // A dev server answers unknown paths with the app's HTML.
    if (!res.ok || (res.headers.get('content-type') ?? '').startsWith('text/html')) return null;
    return await res.blob();
  } catch {
    return null;
  }
}
