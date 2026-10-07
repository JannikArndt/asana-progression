#!/usr/bin/env node
// Generates the small test videos in tests/fixtures/ (committed; re-run only to change them).
// Requires ffmpeg with libvpx-vp9, libx264 and libx265.
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';

const out = new URL('../tests/fixtures/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });

function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${args.join(' ')}`);
}

// Synthetic practice: three holds (12–14 s) separated by 4 s transitions, plus a 5 s hold at the end
// that is too short to count. Poses are boxes with different position and shape. Frames are
// rendered here and piped to ffmpeg as raw grayscale.
const W = 192;
const H = 108;
const FPS = 10;
const DURATION = 60;
const poses = {
  enter: [6, 42, 12, 24],
  A: [36, 24, 18, 66],
  B: [60, 72, 84, 15],
  C: [120, 18, 24, 72],
  D: [150, 60, 36, 36],
};
const timeline = [
  [0, 'enter'], [3, 'A'], [15, 'A'], [19, 'B'], [33, 'B'], [37, 'C'], [51, 'C'], [55, 'D'], [60, 'D'],
];
function poseAt(t) {
  for (let i = 0; i < timeline.length - 1; i++) {
    const [t0, p0] = timeline[i];
    const [t1, p1] = timeline[i + 1];
    if (t <= t1) {
      const k = t1 === t0 ? 1 : (t - t0) / (t1 - t0);
      return poses[p0].map((v, d) => v + (poses[p1][d] - v) * k);
    }
  }
  return poses.D;
}
let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const frames = [];
for (let n = 0; n < DURATION * FPS; n++) {
  const t = n / FPS;
  const [x, y, w, h] = poseAt(t);
  const sx = x + Math.sin((2 * Math.PI * t) / 3);
  const buf = Buffer.alloc(W * H);
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const cov = Math.max(0, Math.min(px + 1, sx + w) - Math.max(px, sx)) * Math.max(0, Math.min(py + 1, y + h) - Math.max(py, y));
      buf[py * W + px] = Math.round(42 + 180 * Math.min(1, cov) + (rand() * 2 - 1) * 3);
    }
  }
  frames.push(buf);
}
const enc = spawnSync('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${W}x${H}`, '-r', String(FPS), '-i', '-',
  '-c:v', 'libvpx-vp9', '-b:v', '80k', '-g', '30', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '5',
  '-pix_fmt', 'yuv420p', '-an', `${out}synthetic-practice-vp9.mp4`,
], { input: Buffer.concat(frames), stdio: ['pipe', 'inherit', 'inherit'] });
if (enc.status !== 0) throw new Error('ffmpeg failed for synthetic practice');

// iPhone-like HEVC Main 10 HLG with QuickTime metadata and a 90° rotation.
// (ffmpeg only applies -display_rotation to demuxed inputs, hence encode first, then remux.)
const tmp = `${out}.tmp-hevc.mov`;
ffmpeg([
  '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30:d=2',
  '-f', 'lavfi', '-i', 'sine=d=2',
  '-map', '0:v', '-map', '1:a',
  '-c:v', 'libx265', '-pix_fmt', 'yuv420p10le', '-tag:v', 'hvc1',
  '-x265-params', 'log-level=error:bframes=3:b-pyramid=1:keyint=30:colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc',
  '-color_primaries', 'bt2020', '-color_trc', 'arib-std-b67', '-colorspace', 'bt2020nc',
  '-c:a', 'aac', '-b:a', '32k',
  '-movflags', 'use_metadata_tags',
  '-metadata', 'com.apple.quicktime.creationdate=2024-05-12T07:31:22+0200',
  '-metadata', 'com.apple.quicktime.make=Apple',
  '-metadata', 'com.apple.quicktime.model=iPhone 15 Pro',
  '-metadata', 'creation_time=2024-06-01T10:00:00Z',
  tmp,
]);
ffmpeg([
  '-display_rotation', '-90', '-i', tmp, '-map', '0', '-c', 'copy',
  '-movflags', 'use_metadata_tags', '-map_metadata', '0',
  `${out}hevc-hlg-rot90.mov`,
]);
rmSync(tmp);

// H.264 with non-reference B-frames.
ffmpeg([
  '-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=30:d=2',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-bf', '3', '-b-pyramid', 'none', '-g', '30',
  '-x264-params', 'log-level=error', '-an', `${out}h264-bframes.mp4`,
]);
console.log('fixtures written to', out);
