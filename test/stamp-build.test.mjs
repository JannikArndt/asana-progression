// The build id must be a content hash: the same for the same files (a docs-only push changes
// nothing a player downloads), different when a shipped file changes, and independent of
// version.json and of the stamp it writes into index.html.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stampBuild } from '../scripts/stamp-build.mjs';

function fakeDist(js = 'console.log(1)') {
  const dir = mkdtempSync(join(tmpdir(), 'dist-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<html><head><meta name="app-build" content="dev" /></head></html>');
  writeFileSync(join(dir, 'assets', 'index-abc.js'), js);
  return dir;
}

test("same files, same build; a changed file, another build", () => {
  const a = stampBuild(fakeDist(), new Date('2026-01-01'));
  const b = stampBuild(fakeDist(), new Date('2026-06-01'));
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{12}$/);
  assert.notEqual(a, stampBuild(fakeDist('console.log(2)')));
});

test("version.json carries the build, and the page carries the same one", () => {
  const dir = fakeDist();
  const build = stampBuild(dir);
  assert.equal(JSON.parse(readFileSync(join(dir, 'version.json'), 'utf8')).build, build);
  assert.match(readFileSync(join(dir, 'index.html'), 'utf8'), new RegExp(`content="${build}"`));
});

test("stamping twice gives the same build", () => {
  const dir = fakeDist();
  assert.equal(stampBuild(dir), stampBuild(dir));
});
