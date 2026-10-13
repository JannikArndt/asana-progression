/**
 * Runs a research script (TypeScript, importing src modules) with Vite's module runner — no extra
 * dependency. Usage: node research/run.mjs research/<script>.ts [args…]
 * The script's default export is called with the remaining arguments.
 */
import { resolve } from 'node:path';
import { runnerImport } from 'vite';

const [script, ...args] = process.argv.slice(2);
if (!script) {
  console.error('Usage: node research/run.mjs research/<script>.ts [args…]');
  process.exit(2);
}
const { module } = await runnerImport(resolve(script), { configFile: false, logLevel: 'error' });
if (typeof module.default === 'function') await module.default(args);
