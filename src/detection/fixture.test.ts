import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeFrames } from './index';
import { findCandidates } from './candidates';
import { buildAnalysisExport, framesNeeded, fromBase64, readAnalysisExport, toBase64, type AnalysisExport } from './fixture';
import { DEFAULT_PARAMS, normalizeParams } from './params';
import { POSES, synthesize } from './__fixtures__/synthetic';

describe('analysis export', () => {
  it('base64 round-trips', () => {
    const b = Uint8Array.from({ length: 70000 }, (_, i) => i % 251);
    expect(fromBase64(toBase64(b))).toEqual(b);
  });

  it('replays to identical candidates', async () => {
    const video = synthesize(POSES.seated, [
      { kind: 'hold', seconds: 15, pose: POSES.seated },
      { kind: 'move', seconds: 1.5, to: POSES.forwardFold, wobble: 0.5 },
      { kind: 'move', seconds: 1.5, to: POSES.seated, wobble: 0.5 },
      { kind: 'hold', seconds: 15, pose: POSES.seated },
      { kind: 'move', seconds: 3, to: POSES.triangle },
      { kind: 'hold', seconds: 15, pose: POSES.triangle },
    ]);
    const { signals, result } = await analyzeFrames(video.frames, DEFAULT_PARAMS);
    const f0 = video.frames[0]!;
    const x = await buildAnalysisExport(signals, result, DEFAULT_PARAMS, f0, { frame: (i) => video.frames[i]!.data }, { name: 'synthetic' });
    expect(x.meta).toEqual({ name: 'synthetic' });
    expect(Object.keys(x.frames).length).toBe(framesNeeded(result, 4).length);
    const json = JSON.parse(JSON.stringify(x)) as AnalysisExport;
    const replay = readAnalysisExport(json);
    const again = await findCandidates(replay.signals, replay.frames, normalizeParams(json.params));
    expect(again.candidates).toEqual(result.candidates);
    expect(() => replay.frames.frame(999999)).toThrow(/not part/);
    const noMeta = await buildAnalysisExport(signals, result, DEFAULT_PARAMS, f0, { frame: (i) => video.frames[i]!.data });
    expect(noMeta.meta).toBeUndefined();
    expect(() => readAnalysisExport({ ...json, version: 2 as 1 })).toThrow(/Not an analysis/);
  });
});

/**
 * Real-signal fixtures exported from the app (debug panel → "Export analysis JSON") go into
 * src/detection/__fixtures__/real/. Each must replay to the exported candidates; if a `truth`
 * array was added by hand, every true hold ≥ minHoldS must be found with the current default
 * parameters, as its own candidate (and its best frame must be near the confirmed `bestS`, if given).
 */
const dir = join(import.meta.dirname, '__fixtures__', 'real');
let files: string[] = [];
try {
  files = readdirSync(dir).filter((f) => f.endsWith('.json'));
} catch {
  files = [];
}

describe.skipIf(files.length === 0)('real-signal fixtures', () => {
  for (const file of files) {
    it(file, async () => {
      const x = JSON.parse(readFileSync(join(dir, file), 'utf8')) as AnalysisExport;
      const { signals, frames } = readAnalysisExport(x);
      const params = normalizeParams(x.params);
      const r = await findCandidates(signals, frames, params);
      expect(r.candidates.map((c) => [c.startS, c.endS, c.bestS])).toEqual(x.candidates.map((c) => [c.startS, c.endS, c.bestS]));
      // Truth is checked with the current defaults: that is what a new import gets.
      const d = await findCandidates(signals, frames, { ...DEFAULT_PARAMS });
      const owner = new Map<string, string>();
      for (const t of x.truth ?? []) {
        if (t.endS - t.startS < DEFAULT_PARAMS.minHoldS) continue;
        const name = t.name ?? `${t.startS}–${t.endS}`;
        const hit = d.candidates.find((c) => c.bestS >= t.startS && c.bestS <= t.endS) ?? d.candidates.find((c) => c.startS <= t.endS && c.endS >= t.startS);
        expect(hit, `hold ${name}`).toBeDefined();
        // Every true hold is its own candidate (no merge of different poses).
        expect(owner.get(hit!.id), `${name} merged with`).toBeUndefined();
        owner.set(hit!.id, name);
        if (t.bestS !== undefined) expect(Math.abs(hit!.bestS - t.bestS), `best frame of ${name}`).toBeLessThanOrEqual(t.bestTolS ?? 1.5);
      }
    });
  }
});
