/** Offline evaluation of parameter sets on the research export (see exportedFrames for exactness). */
import { DEFAULT_PARAMS, findCandidates, type DetectionParams } from '../../src/detection';
import { addScores, expandGrid, leaveOneSessionOut, paramDiff, scoreDetection, summarizeScore, type DetectionScore, type ParamGrid, type ScoreSummary } from '../../src/labeling';
import { exportedFrames, type Dataset } from './data';

export interface OfflineRow {
  params: DetectionParams;
  diff: Partial<DetectionParams>;
  perSession: number[];
  total: ScoreSummary;
  /** Distances that had to be estimated (0 = exact replay). */
  estimated: number;
}

export async function runOffline(d: Dataset, combos: DetectionParams[], opts: { nearest?: boolean } = {}): Promise<OfflineRow[]> {
  const rows: OfflineRow[] = [];
  for (const p of combos) {
    const perSession: number[] = [];
    const scores: DetectionScore[] = [];
    let estimated = 0;
    for (const s of d.sessions) {
      let cost = 0;
      for (const v of s.videos) {
        const frames = exportedFrames(v, opts);
        const r = await findCandidates(v.signals, frames, { ...p, sampleHz: v.signals.sampleHz });
        estimated += frames.misses;
        const sc = scoreDetection(r.candidates, v.holds);
        scores.push(sc);
        cost += sc.editCost;
      }
      perSession.push(cost);
    }
    rows.push({ params: p, diff: paramDiff(p, DEFAULT_PARAMS), perSession, total: summarizeScore(addScores(...scores)), estimated });
  }
  return rows;
}

export function gridRows(grid: ParamGrid): DetectionParams[] {
  return expandGrid(grid, 20000);
}

/** Leave-one-session-out over offline rows, with the defaults' cost per session for comparison. */
export function loso(rows: OfflineRow[], sessions: string[], reference: number[]) {
  return leaveOneSessionOut(
    rows.map((r) => r.perSession),
    sessions,
  ).map((l, s) => ({ ...l, diff: l.chosen >= 0 ? rows[l.chosen]!.diff : null, defaultCost: reference[s]! }));
}
