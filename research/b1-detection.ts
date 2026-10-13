/**
 * B1: every review edit the current defaults leave, classified from C(t)/m(t) around it.
 * Usage: node research/run.mjs research/b1-detection.ts [--list]
 */
import { DEFAULT_PARAMS, meanAbsDiff, percentile, readAnalysisExport, type Candidate, type DetectionParams } from '../src/detection';
import { matchDetection, scoreDetection, addScores, summarizeScore } from '../src/labeling';
import type { ResearchHold } from '../src/ui/research/export';
import { loadLab, loadResearch, mmss, table, type Dataset, type VideoData } from './lib/data';
import { fixtureCheck, loadFixture } from './lib/fixtures';
import { gridRows, loso, runOffline } from './lib/grid';

export type EditKind = 'missed' | 'split' | 'merge' | 'false';

export interface Edit {
  session: string;
  videoId: string;
  kind: EditKind;
  cause: string;
  atS: number;
  detail: string;
}

type Span = Pick<Candidate, 'startS' | 'endS' | 'bestS'>;

const P = DEFAULT_PARAMS;

function range(v: ArrayLike<number>, fromS: number, toS: number, hz: number): number[] {
  const out: number[] = [];
  for (let i = Math.max(0, Math.floor(fromS * hz)); i < Math.min(v.length, Math.ceil(toS * hz)); i++) if (Number.isFinite(v[i]!)) out.push(v[i]!);
  return out;
}
const max = (a: number[]) => (a.length ? Math.max(...a) : NaN);
const r2 = (v: number) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : NaN);

/** The similar-merge's distance cap for this video (as in detection's neighbourCap), from the merge inputs. */
function neighbourCap(v: VideoData): number {
  const f = v.analysis.fresh!;
  const thr = f.threshold;
  const d: number[] = [];
  for (let i = 1; i < f.preMerge.length; i++) {
    const a = f.preMerge[i - 1]!;
    const b = f.preMerge[i]!;
    const peak = max(range(v.signals.C, a.endS, b.startS, v.signals.sampleHz));
    if (peak >= P.similarMergeRefPeak * thr) {
      const mi = f.mergeInputs.find((x) => x.a === i - 1 && x.b === i);
      if (mi) d.push(mi.diff);
    }
  }
  if (d.length < P.similarMergeMinPairs) return Infinity;
  return P.similarMergeRelative * percentile(d, 50);
}

/** Why two adjacent pre-merge pieces were not merged. */
function mergeBlocker(v: VideoData, ia: number, ib: number, cap: number): string {
  const f = v.analysis.fresh!;
  const hz = v.signals.sampleHz;
  const a = f.preMerge[ia]!;
  const b = f.preMerge[ib]!;
  if (b.startS - a.endS > P.similarMergeMaxGapS) return 'gap > 60 s';
  const mi = f.mergeInputs.find((x) => x.a === ia && x.b === ib);
  if (!mi) return 'no merge input';
  const m = v.signals.m;
  const mAt = (t: number) => m[Math.round(t * hz)] ?? 0;
  const scale = Math.max(f.threshold, mAt(a.bestS), mAt(b.bestS));
  const maxDiff = Math.min(cap, P.similarMergeFactor * scale);
  const inside = [...range(m, a.startS, a.endS, hz), ...range(m, b.startS, b.endS, hz)];
  const quiet = mi.gapMaxM === null || mi.gapMaxM <= P.similarMergeMotion * percentile(inside, 90);
  const parts: string[] = [];
  if (!quiet) parts.push(`motion ${r2((mi.gapMaxM ?? 0) / percentile(inside, 90))}× p90`);
  if (mi.diff >= maxDiff) parts.push(`look ${r2(mi.diff)} ≥ ${r2(maxDiff)}${maxDiff === cap ? ' (cap)' : ''}`);
  return parts.join(', ') || 'merged';
}

/** Index of the fresh pre-merge piece containing t (or the nearest). */
function pieceAt(pre: Span[], t: number): number {
  let best = 0;
  let d = Infinity;
  pre.forEach((p, i) => {
    const x = t < p.startS ? p.startS - t : t > p.endS ? t - p.endS : 0;
    if (x < d) ((d = x), (best = i));
  });
  return best;
}

/** Edits of `result` (default: the fresh detection with the defaults) on one video. */
export function classify(
  v: VideoData,
  label: (h: ResearchHold) => string,
  result: { candidates: Span[]; preMerge: Span[]; threshold: number } = v.analysis.fresh!,
): Edit[] {
  const f = { ...v.analysis.fresh!, ...result };
  const thr = f.threshold;
  const hz = v.signals.sampleHz;
  const C = v.signals.C;
  const cands = f.candidates;
  const holds = v.holds;
  const match = matchDetection(cands, holds);
  const cap = neighbourCap(v);
  const edits: Edit[] = [];
  const add = (kind: EditKind, cause: string, atS: number, detail: string) => edits.push({ session: '', videoId: v.videoId, kind, cause, atS, detail });

  // Missed holds.
  holds.forEach((h, hi) => {
    if (!match.holds[hi]!.missed) return;
    const len = h.endS - h.startS;
    const c = range(C, h.startS, h.endS, hz);
    const still = c.filter((x) => x <= thr).length / Math.max(1, c.length);
    const cause = len < P.minHoldS ? 'shorter than 6 s' : still < 0.5 ? 'sway above threshold' : 'still only in pieces < 6 s';
    add('missed', cause, h.startS, `${label(h)} ${r2(len)} s, still ${Math.round(100 * still)} %, median C ${r2(percentile(c, 50) / thr)}× thr`);
  });

  // Holds sharing a candidate.
  cands.forEach((c, ci) => {
    const mine = holds.map((h, hi) => ({ h, hi })).filter(({ hi }) => match.holds[hi]!.main === ci);
    for (let k = 1; k < mine.length; k++) {
      const a = mine[k - 1]!.h;
      const b = mine[k]!.h;
      const peak = max(range(C, a.endS - 2, b.startS + 2, hz));
      const pa = pieceAt(f.preMerge, (a.startS + a.endS) / 2);
      const pb = pieceAt(f.preMerge, (b.startS + b.endS) / 2);
      const same = a.asanaId === b.asanaId && a.side === b.side;
      let cause: string;
      if (f.singleStill) cause = 'single-still clip rule (one candidate for the clip)';
      else if (pa !== pb) cause = same ? 'similar-merge joined reps' : 'similar-merge joined look-alikes';
      else if (!(peak > thr)) cause = same ? 'reps without a change above threshold' : 'look-alike neighbours, C below threshold';
      else cause = 'change shorter than 1 s above threshold (joined gap)';
      add('split', cause, b.startS, `${label(a)} | ${label(b)}, C peak ${r2(peak / thr)}× thr in candidate ${mmss(c.startS)}–${mmss(c.endS)}`);
    }
  });

  // Candidates sharing a hold.
  holds.forEach((h, hi) => {
    const mine = cands.map((c, ci) => ({ c, ci })).filter(({ ci }) => match.candidates[ci]!.main === hi);
    for (let k = 1; k < mine.length; k++) {
      const a = mine[k - 1]!.c;
      const b = mine[k]!.c;
      const peak = max(range(C, a.endS, b.startS, hz));
      const gap = b.startS - a.endS;
      const ia = pieceAt(f.preMerge, a.endS - 0.01);
      const ib = pieceAt(f.preMerge, b.startS + 0.01);
      const blocker = mergeBlocker(v, ia, ib, cap);
      const cause = peak >= P.similarMergeRefPeak * thr ? 'posture change inside the hold' : 'sway above threshold inside the hold';
      add('merge', cause, b.startS, `${label(h)} ${r2(h.endS - h.startS)} s: gap ${r2(gap)} s, C peak ${r2(peak / thr)}× thr; merge blocked by ${blocker}`);
    }
  });

  // False detections.
  const dismissed = v.analysis.candidates.filter((c) => c.status === 'dismissed');
  cands.forEach((c, ci) => {
    if (!match.candidates[ci]!.falsePos) return;
    const len = c.endS - c.startS;
    const prev = [...holds].reverse().find((h) => h.endS <= c.startS + 1);
    const next = holds.find((h) => h.startS >= c.endS - 1);
    const between = !!prev && !!next;
    const wasDismissed = dismissed.some((d) => Math.min(d.endS, c.endS) - Math.max(d.startS, c.startS) > 0.5 * len);
    const cause = !between ? 'before the first / after the last hold' : len >= 20 ? 'break (≥ 20 s)' : 'vinyasa fragment (< 20 s)';
    add('false', cause, c.startS, `${r2(len)} s ${prev ? `after ${label(prev)}` : ''}${next ? ` before ${label(next)}` : ''}${wasDismissed ? ', dismissed in review' : ''}`);
  });
  return edits;
}

const fmtCounts = (t: { missed: number; needSplit: number; needMerge: number; falsePos: number }) => `${t.missed} / ${t.needSplit} / ${t.needMerge} / ${t.falsePos}`;
const diffText = (diff: Partial<DetectionParams> | null) =>
  diff && Object.keys(diff).length ? Object.entries(diff).map(([k, v]) => `${k} ${v}`).join(', ') : 'defaults';

function editsSection(d: Dataset, list: boolean) {
  const all: Edit[] = [];
  const perSession: Array<Array<string | number>> = [];
  for (const s of d.sessions) {
    const scores = s.videos.map((v) => scoreDetection(v.analysis.fresh!.candidates, v.holds));
    const t = summarizeScore(addScores(...scores));
    perSession.push([s.label, s.date, s.videos.length, t.holds, t.candidates, t.own, t.missed, t.needSplit, t.needMerge, t.falsePos, t.editCost]);
    for (const v of s.videos) for (const e of classify(v, d.label)) all.push({ ...e, session: s.label });
  }
  console.log('### Edits with the current defaults\n');
  console.log(table(['Session', 'Date', 'Videos', 'Holds', 'Candidates', 'Own', 'Missed', 'Split', 'Merge', 'False', 'Edit cost'], perSession));
  const causes = new Map<string, Map<string, number>>();
  for (const e of all) {
    const key = `${e.kind}: ${e.cause}`;
    const m = causes.get(key) ?? new Map<string, number>();
    m.set(e.session, (m.get(e.session) ?? 0) + 1);
    causes.set(key, m);
  }
  const sessions = d.sessions.map((s) => s.label);
  console.log('\n### Edits by cause\n');
  console.log(
    table(
      ['Edit: cause', ...sessions, 'All'],
      [...causes.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([k, m]) => [k, ...sessions.map((s) => m.get(s) ?? 0), [...m.values()].reduce((x, y) => x + y, 0)]),
    ),
  );
  if (list) {
    console.log('\n### Every edit\n');
    console.log(table(['Session', 'Video', 'At', 'Edit', 'Cause', 'Detail'], all.map((e) => [e.session, e.videoId.slice(4, 8), mmss(e.atS), e.kind, e.cause, e.detail])));
  }
}

function labSection(d: Dataset) {
  const r = loadLab('lab-default-grid.json');
  const label = (id: string) => d.sessions.find((s) => s.id === id)?.label ?? id;
  const sessions = r.sessions;
  console.log(`\n### Device lab, default grid (${r.combos.length} sets, exact frames)\n`);
  const rows = [
    ['defaults', ...sessions.map((s) => r.reference.perSession[s]), r.reference.total.editCost, fmtCounts(r.reference.total)],
    ...r.ranking.slice(0, 8).map((i) => {
      const c = r.combos[i]!;
      return [diffText(c.diff), ...sessions.map((s) => c.perSession[s]), c.total.editCost, fmtCounts(c.total)];
    }),
  ];
  console.log(table(['Set', ...sessions.map(label), 'Total', 'Missed / split / merge / false'], rows));
  console.log('\nLeave one session out (best set on the other two, cost on the held-out one):\n');
  console.log(table(['Held out', 'Chosen set', 'Cost', 'Defaults'], r.loso.map((l) => [label(l.session), diffText(l.diff), l.heldOutCost, l.defaultCost])));
}

async function mergeSection(d: Dataset) {
  const sessions = d.sessions.map((s) => s.label);
  const ref = (await runOffline(d, [{ ...DEFAULT_PARAMS }]))[0]!;
  const fx = [loadFixture('ashtanga-primary-outdoor'), loadFixture('sarvangasana-finishing')] as const;
  console.log('\n### Similar-merge parameters, replayed offline (exact: exported distances)\n');
  const sweep: Array<Array<string | number>> = [];
  for (const [factor, rel] of [
    [2, 0.45],
    [2, 0.6],
    [2, 0.8],
    [2, 1.2],
    [2.5, 0.9],
    [2.5, 1.2],
    [3, 1.2],
    [3, 5],
  ] as const) {
    const p = { ...DEFAULT_PARAMS, similarMergeFactor: factor, similarMergeRelative: rel };
    const r = (await runOffline(d, [p]))[0]!;
    const o = await fixtureCheck(fx[0], p);
    const f = await fixtureCheck(fx[1], p);
    sweep.push([factor, rel, ...r.perSession, r.total.editCost, fmtCounts(r.total), `${o.own}/${o.holds}${o.pass ? '' : ' ✗'}`, `${f.own}/${f.holds}${f.pass ? '' : ' ✗'}`]);
  }
  console.log(table(['Factor', 'Cap (× median)', ...sessions, 'Total', 'Missed / split / merge / false', 'Outdoor fixture own (≥ 80)', 'Finishing fixture own (9)'], sweep));
  const grid = gridRows({ vary: { similarMergeFactor: [2, 2.5, 3, 4], similarMergeRelative: [0.45, 0.6, 0.8, 1, 1.2, 1.5, 2] } });
  const rows = await runOffline(d, grid);
  console.log('\nLeave one session out over factor × cap (28 sets):\n');
  console.log(table(['Held out', 'Chosen set', 'Cost', 'Defaults'], loso(rows, sessions, ref.perSession).map((l) => [l.session, diffText(l.diff), l.heldOutCost, l.defaultCost])));
  const withMotion = await runOffline(d, gridRows({ vary: { similarMergeFactor: [2, 2.5, 3, 4], similarMergeRelative: [0.45, 0.6, 0.8, 1, 1.2, 1.5, 2], similarMergeMotion: [1.1, 1.3] } }));
  console.log('\nThe same with similarMergeMotion 1.1 | 1.3 (56 sets):\n');
  console.log(table(['Held out', 'Chosen set', 'Cost', 'Defaults'], loso(withMotion, sessions, ref.perSession).map((l) => [l.session, diffText(l.diff), l.heldOutCost, l.defaultCost])));

  console.log('\n### Minimum hold, replayed offline\n');
  const mh: Array<Array<string | number>> = [];
  for (const minHoldS of [5, 6, 6.5, 7, 8, 9]) {
    const r = (await runOffline(d, [{ ...DEFAULT_PARAMS, minHoldS }], { nearest: true }))[0]!;
    mh.push([minHoldS, ...r.perSession, r.total.editCost, fmtCounts(r.total), r.estimated ? `${r.estimated} estimated` : 'exact']);
  }
  console.log(table(['minHoldS', ...sessions, 'Total', 'Missed / split / merge / false', 'Distances'], mh));
}

/** S1 = the outdoor fixture, whose tiny frames at every default pre-merge best frame are committed. */
function distanceSection(d: Dataset) {
  const x = loadFixture('ashtanga-primary-outdoor');
  const { frames } = readAnalysisExport(x);
  const holds = d.sessions[0]!.holds;
  const holdOf = (t: number) => holds.findIndex((h) => t >= h.startS && t <= h.endS);
  const frame = (t: number) => frames.frame(Math.round(t * x.sampleHz)) as Uint8Array;
  const centred = (a: Uint8Array, b: Uint8Array) => {
    const ma = a.reduce((s, v) => s + v, 0) / a.length;
    const mb = b.reduce((s, v) => s + v, 0) / b.length;
    let s = 0;
    for (let i = 0; i < a.length; i++) s += Math.abs(a[i]! - ma - (b[i]! - mb));
    return s / a.length;
  };
  const same: number[][] = [];
  const diff: number[][] = [];
  const pre = x.preMerge;
  for (let i = 0; i < pre.length; i++)
    for (let j = i + 1; j < pre.length && pre[j]!.startS - pre[i]!.endS <= DEFAULT_PARAMS.similarMergeMaxGapS; j++) {
      const ha = holdOf(pre[i]!.bestS);
      const hb = holdOf(pre[j]!.bestS);
      if (ha < 0 || hb < 0) continue;
      const a = frame(pre[i]!.bestS);
      const b = frame(pre[j]!.bestS);
      (ha === hb ? same : diff).push([meanAbsDiff(a, b), centred(a, b)]);
    }
  const auc = (k: number) => {
    let s = 0;
    for (const a of same) for (const b of diff) s += b[k]! > a[k]! ? 1 : b[k] === a[k] ? 0.5 : 0;
    return (s / (same.length * diff.length)).toFixed(2);
  };
  const q = (list: number[][], k: number, p: number) => percentile(list.map((r) => r[k]!), p).toFixed(1);
  console.log('\n### Do best frames tell pieces of one hold from different holds? (S1, pairs ≤ 60 s apart)\n');
  console.log(
    table(
      ['Distance', 'Same hold: median (range)', 'Different holds: p10 / median', 'AUC'],
      [
        ['mean |a − b|', `${q(same, 0, 50)} (${q(same, 0, 0)}–${q(same, 0, 100)})`, `${q(diff, 0, 10)} / ${q(diff, 0, 50)}`, auc(0)],
        ['brightness-centred', `${q(same, 1, 50)} (${q(same, 1, 0)}–${q(same, 1, 100)})`, `${q(diff, 1, 10)} / ${q(diff, 1, 50)}`, auc(1)],
      ],
    ),
  );
  console.log(`\n${same.length} same-hold pairs, ${diff.length} different-hold pairs. AUC = P(different-hold pair is further apart than a same-hold pair); 0.5 = no separation.`);
}

export default async function main(args: string[]) {
  const d = loadResearch();
  editsSection(d, args.includes('--list'));
  labSection(d);
  await mergeSection(d);
  distanceSection(d);
}
