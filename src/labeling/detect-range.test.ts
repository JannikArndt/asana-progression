import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeParams, readAnalysisExport, type AnalysisExport } from '../detection';
import { detectInRange } from './review';
import type { SignalView } from './types';

const hz = 4;
function signals(seconds: number, C: (t: number) => number, m: (t: number) => number = C): SignalView {
  const n = seconds * hz;
  const at = (f: (t: number) => number) => Float32Array.from({ length: n }, (_, i) => f(i / hz));
  return { sampleHz: hz, m: at(m), C: at(C), durationS: seconds, bestFrameMiddle: 0.8, clipWindowS: 4 };
}
const params = normalizeParams({ sampleHz: hz });

describe('detectInRange', () => {
  it('finds holds with the stretch’s own threshold, in video time', async () => {
    // The rest of the video is calm (C ≈ 10), so globally the two holds at C 20/21 are movement;
    // inside 100…160 s they are the stillest part.
    const sig = signals(300, (t) => (t < 100 || t >= 160 ? 10 + (t % 3) : t >= 104 && t < 124 ? 20 : t >= 130 && t < 154 ? 21 : 40));
    const found = await detectInRange({ fromS: 100, toS: 160 }, sig, params, null);
    expect(found.map((c) => [c.startS, c.endS])).toEqual([
      [104, 124],
      [130, 154],
    ]);
    for (const c of found) expect(c).toMatchObject({ status: 'open', origin: 'manual' });
    expect(found[0]!.bestS).toBeGreaterThanOrEqual(104);
    expect(found[0]!.clipEndS).toBeLessThanOrEqual(124);
  });

  it('returns nothing for a stretch shorter than a hold', async () => {
    expect(await detectInRange({ fromS: 10, toS: 14 }, signals(60, () => 1), params, null)).toEqual([]);
  });

  it('merges look-alike fragments when frames are available', async () => {
    // Two still runs 2 s apart (C rises a little between them, no motion), identical frames → one hold.
    const sig = signals(
      60,
      (t) => (t >= 20 && t < 30 ? 1 : t >= 32 && t < 45 ? 1 : t >= 30 && t < 32 ? 3 : 10),
      () => 1,
    );
    const frame = () => new Uint8Array(16).fill(100);
    const merged = await detectInRange({ fromS: 15, toS: 50 }, sig, params, { frame });
    const apart = await detectInRange({ fromS: 15, toS: 50 }, sig, params, null);
    expect(apart.length).toBe(2);
    expect(merged.map((c) => [c.startS, c.endS])).toEqual([[20, 45]]);
  });
});

/**
 * Real practices: pretend the detector missed a labeled hold and everything between its labeled
 * neighbours. Analysing that stretch on its own must find the hold with its best frame inside it.
 */
const dir = join(import.meta.dirname, '..', 'detection', '__fixtures__', 'real');
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
describe('detectInRange on real practices', () => {
  for (const file of files) {
    it(file, async () => {
      const x = JSON.parse(readFileSync(join(dir, file), 'utf8')) as AnalysisExport;
      if (!x.truth?.length) return;
      const { signals } = readAnalysisExport(x);
      const p = normalizeParams(x.params);
      const sig: SignalView = { ...signals, durationS: signals.C.length / signals.sampleHz, bestFrameMiddle: p.bestFrameMiddle, clipWindowS: p.clipWindowS };
      const truth = [...x.truth].sort((a, b) => a.startS - b.startS);
      const missed: string[] = [];
      for (let i = 0; i < truth.length; i++) {
        const t = truth[i]!;
        const fromS = truth[i - 1]?.endS ?? 0;
        const toS = truth[i + 1]?.startS ?? sig.durationS;
        const found = await detectInRange({ fromS, toS }, sig, p, null);
        const hit = found.some((c) => {
          const overlap = Math.min(c.endS, t.endS) - Math.max(c.startS, t.startS);
          return overlap >= 0.5 * Math.min(t.endS - t.startS, c.endS - c.startS) && c.bestS >= t.startS && c.bestS <= t.endS;
        });
        if (!hit) missed.push(`${t.name} ${t.startS}–${t.endS}`);
      }
      expect(missed).toEqual([]);
    });
  }
});
