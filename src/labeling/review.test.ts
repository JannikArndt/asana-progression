import { describe, expect, it } from 'vitest';
import { editedId, fitSpan, holdFromCandidate, mergeCandidates, missedCandidate, nudgeBest, reconcile, sortCandidates, splitCandidate, splitInto, valleyProminence } from './review';
import { searchAsanas } from './search';
import { SEED_ASANAS } from '../model/seed';
import type { Hold, ReviewCandidate } from '../model/types';
import type { SignalView } from './types';

const hz = 4;
function signals(seconds: number, still: Array<[number, number]>, dips: number[] = []): SignalView {
  const n = seconds * hz;
  const m = new Float32Array(n).fill(5);
  const C = new Float32Array(n).fill(10);
  for (const [a, b] of still) for (let i = a * hz; i < b * hz; i++) {
    m[i] = 1;
    C[i] = 1;
  }
  for (const d of dips) m[d * hz] = 0.1;
  return { sampleHz: hz, m, C, durationS: seconds, bestFrameMiddle: 0.8, clipWindowS: 4 };
}

function cand(id: string, startS: number, endS: number, bestS: number, extra: Partial<ReviewCandidate> = {}): ReviewCandidate {
  return { id, startS, endS, bestS, alternatesS: [], clipStartS: startS, clipEndS: startS + 4, status: 'open', ...extra };
}

describe('fitSpan', () => {
  it('finds best frame and clip window from motion', () => {
    const sig = signals(60, [[10, 30]], [22]);
    const f = fitSpan(10, 30, sig);
    expect(f.bestS).toBe(22);
    expect(f.clipEndS - f.clipStartS).toBe(4);
    expect(f.clipStartS).toBeGreaterThanOrEqual(10);
  });
});

describe('mergeCandidates', () => {
  it('keeps the stiller best frame and the other as alternate', () => {
    const sig = signals(60, [[10, 40]], [30]);
    const a = cand('a', 10, 20, 15, { status: 'labeled', holdId: 'h1', alternatesS: [12] });
    const b = cand('b', 22, 40, 30);
    const m = mergeCandidates(a, b, sig);
    expect(m).toMatchObject({ id: 'a', startS: 10, endS: 40, bestS: 30, status: 'labeled', holdId: 'h1' });
    expect(m.alternatesS).toEqual([12, 15]);
    const m2 = mergeCandidates(b, a, sig);
    expect(m2.id).toBe('b');
    expect(m2.status).toBe('labeled');
    expect(m2.holdId).toBe('h1');
    const m3 = mergeCandidates(cand('x', 0, 5, 2), cand('y', 6, 9, 7), signals(10, []));
    expect(m3.holdId).toBeUndefined();
  });
});

describe('splitCandidate', () => {
  it('splits at t; the right part is a new open candidate', () => {
    const sig = signals(60, [[10, 40]], [15, 35]);
    const c = cand('c', 10, 40, 15, { status: 'labeled', holdId: 'h', alternatesS: [12, 33] });
    const [l, r] = splitCandidate(c, 25, sig);
    expect(l).toMatchObject({ id: 'c', startS: 10, endS: 25, bestS: 15, status: 'labeled', holdId: 'h', alternatesS: [12] });
    expect(r).toMatchObject({ startS: 25, endS: 40, bestS: 35, status: 'open', origin: 'manual', alternatesS: [33] });
    expect(r.holdId).toBeUndefined();
    expect(r.id).not.toBe('c');
    const [l2] = splitCandidate(c, 5, sig);
    expect(l2.endS).toBe(10.25);
  });
});

describe('missedCandidate', () => {
  it('expands over the surrounding still stretch', () => {
    const sig = signals(120, [[0, 25], [30, 50], [55, 120]], [41]);
    const c = missedCandidate(40, sig);
    expect(c.startS).toBe(30);
    expect(c.endS).toBe(50);
    expect(c.bestS).toBe(41);
    expect(c.origin).toBe('manual');
  });
  it('uses at least ±2 s and clamps to the video', () => {
    const sig = signals(20, []);
    sig.C = Float32Array.from({ length: 80 }, (_, i) => i); // p75 ≈ 59
    const c = missedCandidate(19.9, sig);
    expect(c.endS).toBe(20);
    expect(c.startS).toBe(17.75);
    const d = missedCandidate(-5, sig);
    expect(d.startS).toBe(0);
    expect(d.endS).toBe(15);
  });
});

describe('nudgeBest', () => {
  it('moves the best frame and keeps the old one as alternate', () => {
    const c = cand('c', 10, 20, 15);
    expect(nudgeBest(c, 18)).toMatchObject({ bestS: 18, alternatesS: [15] });
    expect(nudgeBest(c, 99).bestS).toBe(20);
    expect(nudgeBest(c, 15)).toBe(c);
    expect(nudgeBest({ ...c, alternatesS: [18] }, 18).alternatesS).toEqual([15]);
  });
});

describe('reconcile', () => {
  const hold: Hold = { id: 'h', sessionId: 's', videoId: 'v', asanaId: 'navasana', side: null, startS: 10, endS: 30, bestS: 20, clipStartS: 10, clipEndS: 14, crop: {} };
  it('keeps labeled and manual candidates and carries dismissals', () => {
    const previous = [
      cand('a', 10, 30, 20, { status: 'labeled', holdId: 'h' }),
      cand('b', 40, 50, 45, { status: 'dismissed' }),
      cand('m', 60, 70, 65, { origin: 'manual' }),
      cand('z', 80, 90, 85, { status: 'labeled', holdId: 'gone' }),
    ];
    const fresh = [cand('n1', 12, 28, 20), cand('n2', 41, 50, 45), cand('n3', 100, 110, 105), cand('n4', 81, 90, 85)];
    const out = reconcile(fresh, previous, [hold]);
    expect(out.map((c) => [c.id, c.status])).toEqual([
      ['a', 'labeled'],
      ['n2', 'dismissed'],
      ['m', 'open'],
      ['n4', 'open'],
      ['n3', 'open'],
    ]);
  });
  it('holdFromCandidate copies spans', () => {
    expect(holdFromCandidate(hold, cand('a', 1, 2, 1.5))).toMatchObject({ startS: 1, endS: 2, bestS: 1.5, clipStartS: 1, clipEndS: 5, asanaId: 'navasana' });
  });
  it('sorts and creates unique ids', () => {
    expect(sortCandidates([cand('b', 5, 6, 5), cand('a', 1, 2, 1), cand('c', 1, 3, 1)]).map((c) => c.id)).toEqual(['a', 'c', 'b']);
    expect(editedId('x')).not.toBe(editedId('x'));
  });
});

describe('searchAsanas', () => {
  const cat = [...SEED_ASANAS];
  it('matches word prefixes, initials and substrings', () => {
    expect(searchAsanas(cat, 'mari d').map((a) => a.id)).toEqual(['marichyasana-d']);
    expect(searchAsanas(cat, 'UHP').map((a) => a.id).slice(0, 3)).toEqual([
      'utthita-hasta-padangusthasana-a',
      'utthita-hasta-padangusthasana-b',
      'utthita-hasta-padangusthasana-c',
    ]);
    expect(searchAsanas(cat, 'sirs')[0]!.id).toBe('sirsasana-a');
    expect(searchAsanas(cat, 'konasana').map((a) => a.id)).toContain('supta-konasana');
    expect(searchAsanas(cat, '').length).toBe(cat.length);
    expect(searchAsanas(cat, 'zzz')).toEqual([]);
  });
});

describe('splitInto', () => {
  /** C with valleys (centre s, depth) on a level of 3, 4 Hz. */
  function valleys(seconds: number, list: Array<[number, number]>): SignalView {
    const n = seconds * 4;
    const C = new Float32Array(n).fill(3);
    for (const [t, depth] of list) for (let i = 0; i < n; i++) C[i] = Math.min(C[i]!, 3 - depth * Math.max(0, 1 - Math.abs(i / 4 - t) / 6));
    const m = Float32Array.from(C, (c) => c / 3);
    return { sampleHz: 4, m, C, durationS: seconds, bestFrameMiddle: 0.8, clipWindowS: 4 };
  }
  const cand = (startS: number, endS: number): ReviewCandidate => ({ id: 'c', startS, endS, bestS: startS + 1, alternatesS: [], clipStartS: startS, clipEndS: startS + 4, status: 'labeled', holdId: 'h' });

  it('cuts between the k most prominent valleys of C', () => {
    // six holds, plus a shallow wobble at 5 s that is not one
    const sig = valleys(130, [[5, 0.4], [15, 2], [33, 2.5], [50, 1.5], [70, 2], [90, 2.2], [112, 1.8]]);
    const parts = splitInto(cand(0, 130), 6, sig);
    expect(parts.length).toBe(6);
    expect(parts.map((p) => Math.round(p.bestS))).toEqual([15, 33, 50, 70, 90, 112]);
    for (let i = 1; i < parts.length; i++) expect(parts[i]!.startS).toBe(parts[i - 1]!.endS);
    expect(parts[0]).toMatchObject({ id: 'c', status: 'labeled', holdId: 'h', startS: 0 });
    expect(parts[1]).toMatchObject({ status: 'open', origin: 'manual' });
    expect(parts[1]!.holdId).toBeUndefined();
    expect(parts[5]!.endS).toBe(130);
    // the old best frame is kept as an alternate of the part it falls into
    expect(parts[0]!.alternatesS).toContain(1);
  });

  it('halves the longest part when there are fewer valleys than holds, and keeps k < 2 as is', () => {
    const sig = valleys(60, [[20, 2]]);
    const parts = splitInto(cand(0, 60), 3, sig);
    expect(parts.length).toBe(3);
    expect(parts.every((p) => p.endS > p.startS)).toBe(true);
    const c = cand(0, 60);
    expect(splitInto(c, 1, sig)).toEqual([c]);
    const flat: SignalView = { ...sig, C: new Float32Array(240).fill(NaN) };
    expect(splitInto(c, 4, flat).length).toBe(4);
  });

  it('valleyProminence measures each minimum against the lower side', () => {
    const v = [3, 1, 2, 0, 3, 2, 2, 4];
    const out = valleyProminence((i) => v[i]!, 0, v.length);
    expect(out).toEqual([
      { at: 1, prominence: 1 },
      { at: 3, prominence: 3 },
      { at: 5, prominence: 1 },
    ]);
  });
});
