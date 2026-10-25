/**
 * Which build this page is. scripts/stamp-build.mjs writes the id into <meta name="app-build"> after
 * the bundle exists; a content hash cannot also be compiled into that bundle. "dev" = unstamped
 * (dev server, tests).
 */
export function currentBuild(): string {
  if (typeof document === 'undefined') return 'dev';
  return document.querySelector<HTMLMetaElement>('meta[name="app-build"]')?.content || 'dev';
}

/** Display-only: the time of the deployed build, known once version.json has been fetched. */
let builtAt: string | null = null;

export function setBuiltAt(value: string | null) {
  builtAt = value;
}

/** What diagnostics reports and exports say about the app. */
export function appInfo(): { version: string; builtAt: string } {
  return { version: currentBuild(), builtAt: builtAt ?? 'unknown' };
}
