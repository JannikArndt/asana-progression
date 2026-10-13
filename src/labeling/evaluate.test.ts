import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, readAnalysisExport, type AnalysisExport, type DetectionParams } from '../detection';
import {
  addScores,
  editCost,
  effectiveParams,
  emptyScore,
  evaluateParams,
  expandGrid,
  leaveOneSessionOut,
  paramDiff,
  parseGrid,
  scoreDetection,
  summarizeScore,
  EDIT_COST,
} from './evaluate';

const span = (startS: number, endS: number, bestS?: number) => ({ startS, endS, ...(bestS !== undefined ? { bestS } : {}) });

describe('scoreDetection', () => {
  it('a perfect detection costs nothing', () => {
    const holds = [span(0, 10, 5), span(20, 30, 25)];
    const s = scoreDetection([span(0.5, 10, 5.5), span(20, 31, 25)], holds);
    expect(s).toMatchObject({ holds: 2, candidates: 2, own: 2, missed: 0, needSplit: 0, needMerge: 0, falsePos: 0, editCost: 0 });
    expect(s.startErrS).toEqual([0.5, 0]);
    expect(s.endErrS).toEqual([0, 1]);
    expect(s.bestErrS).toEqual([0.5, 0]);
  });

  it('counts a hold split across candidates as merges, a shared candidate as splits', () => {
    const holds = [span(0, 20), span(30, 40), span(41, 50)];
    // Hold 1 in three pieces; holds 2 and 3 in one candidate.
    const s = scoreDetection([span(0, 7), span(7, 14), span(14, 20), span(29, 51)], holds);
    expect(s).toMatchObject({ own: 0, missed: 0, needMerge: 2, needSplit: 1, falsePos: 0, editCost: 3 });
    // Fragments that are each below 30 % but cover the hold together are merges, not a miss.
    expect(scoreDetection([span(0, 5), span(6, 11), span(12, 17)], [span(0, 20)])).toMatchObject({ missed: 0, needMerge: 2, editCost: 2 });
  });

  it('a missed hold costs two, a false detection one', () => {
    const holds = [span(0, 10), span(20, 30)];
    const s = scoreDetection([span(0, 10), span(21, 22), span(23, 24), span(50, 60)], holds);
    // 2 s of a 10 s hold is less than 30 %: missed; its fragments go with the miss (no false detection, no merge).
    expect(s).toMatchObject({ own: 1, missed: 1, falsePos: 1, needMerge: 0, needSplit: 0 });
    expect(s.editCost).toBe(EDIT_COST.missed + EDIT_COST.falsePos);
    expect(editCost(s)).toBe(3);
  });

  it('a candidate much longer than its hold is neither own nor missed', () => {
    const s = scoreDetection([span(0, 100)], [span(10, 30)]);
    expect(s).toMatchObject({ own: 0, missed: 0, falsePos: 0, editCost: 0 });
    expect(scoreDetection([], [span(0, 0)])).toMatchObject({ missed: 1 });
    expect(scoreDetection([span(0, 5)], [])).toMatchObject({ falsePos: 1, editCost: 1 });
  });

  it('adds up and summarizes as numbers only', () => {
    const a = scoreDetection([span(0, 10, 9)], [span(0, 10, 5)]);
    const b = scoreDetection([span(0, 11, 5.5)], [span(0, 10, 5)]);
    const sum = addScores(a, b, emptyScore());
    expect(sum).toMatchObject({ holds: 2, own: 2, editCost: 0, bestErrS: [4, 0.5] });
    expect(summarizeScore(sum)).toEqual({
      holds: 2,
      candidates: 2,
      own: 2,
      missed: 0,
      needSplit: 0,
      needMerge: 0,
      falsePos: 0,
      editCost: 0,
      medianStartErrS: 0,
      medianEndErrS: 0.5,
      medianBestErrS: 2.25,
      bestOverTol: 1,
    });
    expect(summarizeScore(emptyScore()).medianBestErrS).toBeNull();
    expect(summarizeScore(scoreDetection([span(0, 10)], [span(0, 10), span(20, 30)])).medianStartErrS).toBe(0);
  });
});

describe('parameter grid', () => {
  it('expands the combinations, last key fastest, on top of base and the defaults', () => {
    const combos = expandGrid({ base: { minHoldS: 8 }, vary: { stillPercentile: [50, 60], gapMergeS: [0.5, 1] } });
    expect(combos.map((p) => [p.stillPercentile, p.gapMergeS, p.minHoldS])).toEqual([
      [50, 0.5, 8],
      [50, 1, 8],
      [60, 0.5, 8],
      [60, 1, 8],
    ]);
    expect(combos[0]!.similarMergeFactor).toBe(DEFAULT_PARAMS.similarMergeFactor);
    expect(expandGrid({ vary: {} })).toEqual([{ ...DEFAULT_PARAMS }]);
  });

  it('drops combinations that detect the same (window without rolling, exit ≤ enter, clamped values)', () => {
    const combos = expandGrid({
      vary: { thresholdMode: ['global', 'rolling'], thresholdWindowS: [120, 300], stillPercentileExit: [40, 55, 70], stillPercentile: [55, 200] },
    });
    // Exit {40, 55, 70} is {55, 70} at percentile 55 and {95} at 95 (200 is clamped): 3 per window;
    // global has one window, rolling two.
    expect(combos.length).toBe(3 + 6);
    expect(effectiveParams({ ...DEFAULT_PARAMS, stillPercentileExit: 10 }).stillPercentileExit).toBe(DEFAULT_PARAMS.stillPercentile);
  });

  it('rejects unknown keys, bad values, sampling parameters and too many combinations', () => {
    expect(() => expandGrid({ vary: { bogus: [1] } as never })).toThrow(/Unknown parameter "bogus"/);
    expect(() => expandGrid({ base: { bogus: 1 } as never, vary: {} })).toThrow(/Unknown parameter "bogus" in base/);
    expect(() => expandGrid({ base: { pool: 1 }, vary: {} })).toThrow(/decoding again/);
    expect(() => expandGrid({ vary: { sampleHz: [4] } })).toThrow(/decoding again/);
    expect(() => expandGrid({ vary: { minHoldS: [] } })).toThrow(/non-empty/);
    expect(() => expandGrid({ vary: { minHoldS: ['6'] } })).toThrow(/Invalid value "6"/);
    expect(() => expandGrid({ vary: { thresholdMode: ['local'] } })).toThrow(/Invalid value/);
    expect(() => expandGrid({ vary: { minHoldS: [1, 2, 3], gapMergeS: [0, 1] } }, 5)).toThrow(/6 combinations; at most 5/);
    expect(() => expandGrid(null as never)).toThrow(/"vary"/);
  });

  it('parses JSON text into combinations or an error message', () => {
    const ok = parseGrid('{"vary":{"minHoldS":[5,6]}}');
    expect('combos' in ok && ok.combos.length).toBe(2);
    expect(parseGrid('{vary')).toMatchObject({ error: expect.stringMatching(/Not valid JSON/) });
    expect(parseGrid('{"vary":{"x":[1]}}')).toEqual({ error: 'Unknown parameter "x".' });
  });

  it('lists only the parameters that differ', () => {
    const p: DetectionParams = { ...DEFAULT_PARAMS, minHoldS: 8, thresholdMode: 'rolling' };
    expect(paramDiff(p, DEFAULT_PARAMS)).toEqual({ minHoldS: 8, thresholdMode: 'rolling' });
  });
});

describe('leaveOneSessionOut', () => {
  it('picks the best combination on the other sessions and scores it on the held-out one', () => {
    // combos × sessions
    const cost = [
      [10, 10, 10],
      [5, 6, 30],
      [8, 4, 9],
    ];
    expect(leaveOneSessionOut(cost, ['a', 'b', 'c'])).toEqual([
      { session: 'a', chosen: 2, trainCost: 13, heldOutCost: 8 },
      { session: 'b', chosen: 2, trainCost: 17, heldOutCost: 4 },
      { session: 'c', chosen: 1, trainCost: 11, heldOutCost: 30 },
    ]);
    expect(leaveOneSessionOut([], ['a'])[0]).toMatchObject({ chosen: -1, heldOutCost: NaN });
  });
});

/** The committed real-signal fixtures with their labeled truth, scored with the current defaults. */
describe('real-signal fixtures', () => {
  const dir = join(import.meta.dirname, '..', 'detection', '__fixtures__', 'real');
  const load = (name: string) => JSON.parse(readFileSync(join(dir, name), 'utf8')) as AnalysisExport;

  // Floors: tuning may lower them (then lower these), never raise them.
  it.each([
    // Missed: Prasarita Padottanasana B (one 7 s candidate in a 28 s hold); 7 splits, 10 merges, 12 false.
    ['ashtanga-primary-outdoor.json', { holds: 93, maxMissed: 1, maxEditCost: 31 }],
    ['sarvangasana-finishing.json', { holds: 9, maxMissed: 0, maxEditCost: 0 }],
  ])('%s', async (file, want) => {
    const x = load(file);
    const { signals, frames } = readAnalysisExport(x);
    const s = await evaluateParams(signals, frames, { ...DEFAULT_PARAMS }, x.truth ?? []);
    expect(s.holds).toBe(want.holds);
    expect(s.missed).toBeLessThanOrEqual(want.maxMissed);
    expect(s.editCost).toBeLessThanOrEqual(want.maxEditCost);
    expect(summarizeScore(s).bestOverTol).toBe(0);
  });
});
