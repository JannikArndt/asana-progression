/** The committed real-signal fixtures (src/detection/__fixtures__/real) and their fixture.test checks. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findCandidates, readAnalysisExport, type AnalysisExport, type DetectionParams } from '../../src/detection';

export const FIXTURES = ['ashtanga-primary-outdoor', 'sarvangasana-finishing'] as const;

export function loadFixture(name: (typeof FIXTURES)[number]): AnalysisExport {
  return JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'src', 'detection', '__fixtures__', 'real', `${name}.json`), 'utf8')) as AnalysisExport;
}

/**
 * fixture.test's measure with parameters `p`: every truth hold ≥ minHoldS is hit by the candidate
 * whose best frame is inside it and nearest the confirmed one (else any overlapping); "own" = its hit
 * is no other hold's. Passes with no miss and own ≥ truthMinOwn (or every hold own without it).
 */
export async function fixtureCheck(x: AnalysisExport, p: DetectionParams): Promise<{ own: number; holds: number; missed: number; pass: boolean }> {
  const { signals, frames } = readAnalysisExport(x);
  const d = await findCandidates(signals, frames, p);
  const hits: string[] = [];
  for (const t of x.truth ?? []) {
    if (t.endS - t.startS < p.minHoldS) continue;
    const inside = d.candidates.filter((c) => c.bestS >= t.startS && c.bestS <= t.endS);
    const ref = t.bestS ?? (t.startS + t.endS) / 2;
    inside.sort((a, b) => Math.abs(a.bestS - ref) - Math.abs(b.bestS - ref));
    const hit = inside[0] ?? d.candidates.find((c) => c.startS <= t.endS && c.endS >= t.startS);
    hits.push(hit ? hit.id : '');
  }
  const uses = new Map<string, number>();
  for (const h of hits) uses.set(h, (uses.get(h) ?? 0) + 1);
  const own = hits.filter((h) => h && uses.get(h) === 1).length;
  const missed = hits.filter((h) => !h).length;
  return { own, holds: hits.length, missed, pass: missed === 0 && own >= (x.truthMinOwn ?? hits.length) };
}
