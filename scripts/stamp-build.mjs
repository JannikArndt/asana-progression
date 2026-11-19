// Stamps a finished build: hashes dist/ plus the server files that ship with it (SERVER_INPUTS)
// and writes the id where the app, the server's /version and CI can read it.
//   node scripts/stamp-build.mjs [dist]
// The id is a content hash, not the commit SHA, so a docs-only push yields the same build
// and open tabs are not asked to reload for nothing.
//   - dist/version.json = { build, version, builtAt }. `build` is what the update check and
//     CI compare; version/builtAt are for display only and are NOT part of the hash.
//   - index.html's <meta name="app-build"> receives the id. The hash is taken with that meta
//     reset to "dev" and version.json left out, so the id never depends on itself and
//     running this twice gives the same answer.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const META = /(<meta name="app-build" content=")[^"]*(")/;

function files(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]))
    .sort();
}

/** What the container runs besides dist/ (the Dockerfile copies exactly these). */
export const SERVER_INPUTS = ['Dockerfile', 'docker-entrypoint.sh', 'server'];
const ROOT = fileURLToPath(new URL('..', import.meta.url));

function serverFiles(root) {
  return SERVER_INPUTS.filter((p) => existsSync(join(root, p)))
    .flatMap((p) => (statSync(join(root, p)).isDirectory() ? files(join(root, p)) : [join(root, p)]))
    .map((f) => relative(root, f).split(sep).join('/'))
    .filter((f) => !f.includes('/node_modules/') && !f.endsWith('.md') && !/\.test\.[cm]?js$/.test(f))
    .sort();
}

/** `root`: repository root whose server files are hashed too (null: dist/ only). */
export function buildIdOf(dist, root = null) {
  const hash = createHash('sha256');
  for (const rel of root ? serverFiles(root) : []) {
    const body = readFileSync(join(root, rel));
    hash.update(`server:${rel}\0${body.length}\0`).update(body);
  }
  for (const file of files(dist)) {
    const rel = relative(dist, file).split(sep).join('/');
    if (rel === 'version.json') continue;
    let body = readFileSync(file);
    if (rel === 'index.html') body = Buffer.from(body.toString('utf8').replace(META, '$1dev$2'));
    hash.update(`${rel}\0${body.length}\0`).update(body);
  }
  return hash.digest('hex').slice(0, 12);
}

export function stampBuild(dist, now = new Date(), root = null) {
  const build = buildIdOf(dist, root);
  const indexPath = join(dist, 'index.html');
  const html = readFileSync(indexPath, 'utf8');
  if (!META.test(html)) throw new Error('dist/index.html has no <meta name="app-build">');
  writeFileSync(indexPath, html.replace(META, `$1${build}$2`));
  const builtAt = now.toISOString();
  const sha = (process.env.GITHUB_SHA || '').slice(0, 7);
  const version = `${sha || 'local'}-${builtAt.replace(/[-:]/g, '').slice(0, 15)}`;
  writeFileSync(join(dist, 'version.json'), JSON.stringify({ build, version, builtAt }));
  return build;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dist = process.argv[2] || 'dist';
  console.log(`BUILD: ${stampBuild(dist, new Date(), ROOT)}`);
}
