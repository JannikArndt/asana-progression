import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Module boundaries (see CLAUDE.md):
 *  - every module lives in src/<module>/ with its public API in index.ts and contracts in types.ts
 *  - detection, source: no imports from other modules
 *  - model: type-only imports from detection/types
 *  - storage: may import model
 *  - ui: the only composition layer; imports other modules only through their index (or types)
 * Tests and fixtures are exempt.
 */
const SRC = resolve(import.meta.dirname);
const MODULES = ['detection', 'source', 'storage', 'model', 'ui'] as const;
type Module = (typeof MODULES)[number];

const ALLOWED: Record<Module, Module[]> = {
  detection: [],
  source: [],
  model: ['detection'],
  storage: ['model'],
  ui: ['detection', 'source', 'storage', 'model'],
};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === '__fixtures__' ? [] : files(p);
    return /\.(ts|svelte)$/.test(name) && !/\.test\.ts$/.test(name) ? [p] : [];
  });
}

function imports(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  return [...src.matchAll(/(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);
}

describe('module boundaries', () => {
  for (const mod of MODULES) {
    it(`${mod} only depends on allowed modules through their public API`, () => {
      const problems: string[] = [];
      for (const file of files(join(SRC, mod))) {
        for (const spec of imports(file)) {
          if (!spec.startsWith('.')) continue;
          const target = relative(SRC, resolve(dirname(file), spec)).split('/');
          const targetModule = target[0] as Module;
          if (targetModule === mod || !MODULES.includes(targetModule)) continue;
          const where = `${relative(SRC, file)} → ${spec}`;
          if (!ALLOWED[mod].includes(targetModule)) problems.push(`not allowed: ${where}`);
          else if (target.length > 2 || !['index', 'types'].includes(target[1] ?? 'index')) {
            problems.push(`internal import: ${where}`);
          }
        }
      }
      expect(problems).toEqual([]);
    });
  }

  it('model only uses type imports from detection', () => {
    for (const file of files(join(SRC, 'model'))) {
      const src = readFileSync(file, 'utf8');
      for (const line of src.split('\n').filter((l) => /from '\.\.\/detection/.test(l))) expect(line).toMatch(/^import type /);
    }
  });

  it('every module has types.ts and index.ts', () => {
    for (const mod of ['detection', 'source', 'storage', 'model']) {
      expect(statSync(join(SRC, mod, 'types.ts')).isFile()).toBe(true);
      expect(statSync(join(SRC, mod, 'index.ts')).isFile()).toBe(true);
    }
  });
});
