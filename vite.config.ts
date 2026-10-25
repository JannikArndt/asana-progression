/// <reference types="vitest/config" />
import { defineConfig, type Connect, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const MEDIAPIPE_FILES: Record<string, string> = {
  'vision_wasm_module_internal.js': 'text/javascript',
  'vision_wasm_module_internal.wasm': 'application/wasm',
};

/**
 * Self-hosts the MediaPipe ES-module wasm loader and binary at <base>mediapipe/<file> (used by the
 * crop module): emitted into the build, served by the dev and preview servers.
 */
function mediapipeWasm(): Plugin {
  let base = '/';
  const require = createRequire(import.meta.url);
  const read = (file: string) => readFileSync(require.resolve(`@mediapipe/tasks-vision/${file}`));
  const serve: Connect.NextHandleFunction = (req, res, next) => {
    const path = (req.url ?? '').split('?')[0]!;
    const file = path.startsWith(`${base}mediapipe/`) ? path.slice(base.length + 'mediapipe/'.length) : '';
    const type = Object.hasOwn(MEDIAPIPE_FILES, file) ? MEDIAPIPE_FILES[file] : undefined;
    if (!type || (req.method !== 'GET' && req.method !== 'HEAD')) return next();
    const body = read(file);
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Length', body.length);
    res.setHeader('Cache-Control', 'no-cache');
    res.end(req.method === 'HEAD' ? undefined : body);
  };
  return {
    name: 'mediapipe-wasm',
    configResolved(config) {
      base = config.base;
    },
    configureServer(server) {
      server.middlewares.use(serve);
    },
    configurePreviewServer(server) {
      server.middlewares.use(serve);
    },
    generateBundle() {
      for (const file of Object.keys(MEDIAPIPE_FILES)) {
        this.emitFile({ type: 'asset', fileName: `mediapipe/${file}`, source: read(file) });
      }
    },
  };
}

export default defineConfig({
  base: '/asana-progression/',
  plugins: [svelte(), mediapipeWasm()],
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: true },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      // Browser-only code (WebCodecs sampler, UI wiring) is covered by the Playwright smoke tests.
      include: ['src/detection/**/*.ts', 'src/labeling/**/*.ts', 'src/model/**/*.ts', 'src/storage/**/*.ts', 'src/source/**/*.ts', 'src/ui/components/timeline.ts', 'src/ui/components/session-timeline.ts', 'src/ui/components/sheet-gesture.ts', 'src/ui/state/session-data.ts', 'src/ui/research/**/*.ts'],
      exclude: ['**/*.test.ts', '**/types.ts', '**/index.ts', '**/__fixtures__/**', 'src/source/sampler.ts', 'src/source/exact.ts'],
      reporter: ['text-summary', 'text'],
      thresholds: {
        'src/detection/**': { lines: 98, branches: 90 },
        'src/storage/**': { lines: 95, branches: 85 },
        'src/labeling/**': { lines: 98, branches: 90 },
      },
    },
  },
});
