/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { execSync } from 'node:child_process';

function gitSha(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'dev';
  }
}

const builtAt = new Date().toISOString();
const version = `${gitSha()}-${builtAt.replace(/[-:]/g, '').slice(0, 15)}`;

/** Emits dist/version.json; the app polls it to detect new deployments. */
function versionFile(): Plugin {
  return {
    name: 'version-file',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ version, builtAt }),
      });
    },
  };
}

export default defineConfig({
  base: '/asana-progression/',
  plugins: [svelte(), versionFile()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __BUILT_AT__: JSON.stringify(builtAt),
  },
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: true },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      // Browser-only code (WebCodecs sampler, UI wiring) is covered by the Playwright smoke tests.
      include: ['src/detection/**/*.ts', 'src/labeling/**/*.ts', 'src/model/**/*.ts', 'src/storage/**/*.ts', 'src/source/**/*.ts', 'src/ui/components/timeline.ts', 'src/ui/state/session-data.ts'],
      exclude: ['**/*.test.ts', '**/types.ts', '**/index.ts', '**/__fixtures__/**', 'src/source/sampler.ts'],
      reporter: ['text-summary', 'text'],
      thresholds: {
        'src/detection/**': { lines: 98, branches: 90 },
        'src/storage/**': { lines: 95, branches: 85 },
        'src/labeling/**': { lines: 98, branches: 90 },
      },
    },
  },
});
