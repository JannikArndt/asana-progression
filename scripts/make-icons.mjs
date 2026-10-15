#!/usr/bin/env node
// Renders public/icons/*.png from an inline SVG with Playwright's Chromium.
// Set PW_CHROMIUM_PATH to use a preinstalled browser.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

// Utthita Trikonasana (triangle pose) in off-white on the sage accent, full bleed: iOS rounds the
// corners itself; the maskable variant keeps the figure inside the 80 % safe zone.
const svg = (size, pad) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#6f9285"/>
      <stop offset="1" stop-color="#46645a"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <g transform="translate(256 256) scale(${1 - pad}) translate(-256 -256) translate(6 -12)">
    <g fill="none" stroke="#f7f5f1" stroke-width="28" stroke-linecap="round" stroke-linejoin="round">
      <path d="M150 428 L276 292 L392 428"/>
      <path d="M276 292 L188 236"/>
      <path d="M188 112 L188 368"/>
    </g>
    <circle cx="136" cy="203" r="31" fill="#f7f5f1"/>
  </g>
</svg>`;

const out = new URL('../public/icons/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const page = await browser.newPage();
for (const [name, size, pad] of [
  ['icon-192.png', 192, 0],
  ['icon-512.png', 512, 0],
  ['icon-maskable-512.png', 512, 0.2],
  ['apple-touch-icon.png', 180, 0],
]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0">${svg(size, pad)}</body></html>`);
  await page.screenshot({ path: out + name, clip: { x: 0, y: 0, width: size, height: size } });
}
await browser.close();
console.log('icons written to', out);
