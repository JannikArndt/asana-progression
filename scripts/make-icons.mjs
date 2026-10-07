#!/usr/bin/env node
// Renders public/icons/*.png from an inline SVG with Playwright's Chromium.
// Set PW_CHROMIUM_PATH to use a preinstalled browser.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const svg = (size, pad) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#f7f5f1"/>
  <g transform="translate(256 256) scale(${1 - pad}) translate(-256 -256)">
    <circle cx="256" cy="256" r="168" fill="#5c7d71"/>
    <circle cx="256" cy="178" r="22" fill="#f7f5f1"/>
    <path d="M168 318 Q256 230 344 318" fill="none" stroke="#f7f5f1" stroke-width="18" stroke-linecap="round"/>
    <path d="M256 214 L256 276" fill="none" stroke="#f7f5f1" stroke-width="18" stroke-linecap="round"/>
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
