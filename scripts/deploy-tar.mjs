// scripts/deploy-tar.mjs — the CapRover deploy tarball: captain-definition, Dockerfile,
// docker-entrypoint.sh, server/ (without node_modules) and the built dist/.
//   node scripts/deploy-tar.mjs [out.tar]      (run `npm run build` first)
// Deploying a tarball instead of a git branch ships the dist/ that CI built and verified, and
// keeps the Vite build off the CapRover host.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const out = process.argv[2] || 'deploy.tar';
if (!existsSync('dist/version.json')) {
  console.error('dist/ is missing or unstamped: run npm run build first');
  process.exit(1);
}
const r = spawnSync('tar', ['-cf', out, '--exclude=server/node_modules', '--exclude=*.test.mjs', '--exclude=server/.data', 'captain-definition', 'Dockerfile', 'docker-entrypoint.sh', 'server', 'dist'], { stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status ?? 1);
console.log(`TAR: ${out}`);
