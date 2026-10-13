/**
 * B2: asana naming. (1) Replays suggest() per session in time order (other sessions as history),
 * like a top-to-bottom review; (2) an offline pose classifier on the world landmarks of the stills;
 * (3) whole-session alignment of holds to the template vs the greedy suggestions.
 * Usage: node research/run.mjs research/b2-naming.ts
 */
import { alignToTemplate, matchDetection, matchTemplateEntry, suggest, type HistoryEntry, type Label, type ReviewItem } from '../src/labeling';
import type { Asana, SequenceTemplate } from '../src/model';
import type { ResearchHold } from '../src/ui/research/export';
import { asanaFamilies, variantOf } from '../src/model';
import { loadResearch, pct, table, type Dataset, type SessionData } from './lib/data';
import { poseDistance, poseFeatures, type PoseFeatures } from './lib/pose';
import { ALIGN_COSTS, alignSequence, completionTable, rankEntries, type AlignCosts } from './lib/align';

export interface ReplayStep {
  hold: ResearchHold;
  rank: number;
  top: Label[];
  cause: string;
}

function catalogOf(d: Dataset): Asana[] {
  return d.raw.catalog.map((a) => ({ id: a.id, name: a.name, sided: a.sided, ...(a.group ? { group: a.group } : {}), ...(a.posture ? { posture: a.posture } : {}) }));
}

function historyFor(d: Dataset, except: SessionData): HistoryEntry[] {
  return d.sessions
    .filter((s) => s.id !== except.id)
    .flatMap((s) => s.holds.map((h, order) => ({ asanaId: h.asanaId, side: h.side, date: s.date, sessionId: s.id, order })));
}

const same = (a: { asanaId: string; side?: string | null }, b: { asanaId: string; side?: string | null }) => a.asanaId === b.asanaId && (a.side ?? null) === (b.side ?? null);

/** Why the truth was not the top suggestion. */
function missCause(t: SequenceTemplate | null, items: ReviewItem[], i: number, h: ResearchHold, prev: ResearchHold | undefined, top: Label | undefined): string {
  if (!t) return 'no template';
  if (!t.entries.some((e) => e.asanaId === h.asanaId)) return 'off-template asana';
  if (prev && same(prev, h)) return 'extra rep';
  if (!top) return 'template exhausted';
  if (top.asanaId === h.asanaId) return 'side order';
  const truthEntry = matchTemplateEntry(items, items[i]!.key, { asanaId: h.asanaId, side: h.side }, t);
  const expected = top.templateEntryIndex;
  if (prev && h.videoId !== prev.videoId && h.startS < 120) return 'new video (break)';
  const gap = prev ? h.startS - prev.endS : 0;
  if (prev && h.videoId === prev.videoId && gap > 180) return 'break (> 3 min)';
  if (truthEntry === undefined || expected === undefined) return 'entry already used';
  if (prev && same(t.entries[expected]!, { asanaId: prev.asanaId, side: prev.side ?? null })) return 'fewer reps than usual';
  if (truthEntry > expected) return 'skipped entries';
  return 'other order';
}

/** Top-to-bottom review: every card's suggestions with the earlier cards labeled. */
export function replaySession(d: Dataset, s: SessionData, opts: { limit?: number; posture?: boolean } = {}): ReplayStep[] {
  const t = d.raw.templates.find((x) => x.id === s.templateId) ?? null;
  const catalog = catalogOf(d);
  const history = historyFor(d, s);
  const keys = s.holds.map((h) => h.id);
  const labels: Array<Label | undefined> = [];
  const steps: ReplayStep[] = [];
  for (let i = 0; i < s.holds.length; i++) {
    const h = s.holds[i]!;
    const raw: ReviewItem[] = keys.map((key, k) => {
      const posture = opts.posture ? s.holds[k]!.pose?.posture : undefined;
      return k < i ? { key, status: 'labeled', label: labels[k]! } : { key, status: 'open', ...(posture ? { postureClass: posture } : {}) };
    });
    const items = alignToTemplate(raw, t);
    const sugg = suggest(items, catalog, t, history, { now: `${s.date}T12:00:00Z`, limit: opts.limit ?? 3 })[h.id] ?? [];
    const rank = sugg.findIndex((x) => same(x, h));
    const chosen = rank >= 0 ? sugg[rank]! : undefined;
    const entry = chosen?.templateEntryIndex ?? matchTemplateEntry(items, h.id, { asanaId: h.asanaId, side: h.side }, t);
    labels[i] = { asanaId: h.asanaId, side: h.side, ...(entry !== undefined ? { templateEntryIndex: entry } : {}) };
    steps.push({ hold: h, rank, top: sugg, cause: rank === 0 ? '' : missCause(t, items, i, h, s.holds[i - 1], sugg[0]) });
  }
  return steps;
}

function replaySection(d: Dataset) {
  console.log('### Suggestions, replayed top to bottom (other sessions as history)\n');
  const rows: Array<Array<string | number>> = [];
  const causes = new Map<string, Map<string, number>>();
  let n = 0;
  let top1 = 0;
  let top3 = 0;
  for (const s of d.sessions) {
    const steps = replaySession(d, s);
    const t1 = steps.filter((x) => x.rank === 0).length;
    const t3 = steps.filter((x) => x.rank >= 0 && x.rank < 3).length;
    rows.push([s.label, steps.length, `${t1} (${pct(t1, steps.length)})`, `${t3} (${pct(t3, steps.length)})`]);
    n += steps.length;
    top1 += t1;
    top3 += t3;
    for (const st of steps) {
      if (st.rank === 0) continue;
      const key = `${st.cause}${st.rank < 0 ? ' (not in top 3)' : ''}`;
      const m = causes.get(key) ?? new Map<string, number>();
      m.set(s.label, (m.get(s.label) ?? 0) + 1);
      causes.set(key, m);
    }
  }
  rows.push(['All', n, `${top1} (${pct(top1, n)})`, `${top3} (${pct(top3, n)})`]);
  console.log(table(['Session', 'Holds', 'Top 1', 'Top 3'], rows));
  const sessions = d.sessions.map((s) => s.label);
  console.log('\nNot the top suggestion, by cause:\n');
  console.log(
    table(
      ['Cause', ...sessions, 'All'],
      [...causes.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, m]) => [k, ...sessions.map((s) => m.get(s) ?? 0), [...m.values()].reduce((x, y) => x + y, 0)]),
    ),
  );
}

// ---- pose classifier ---------------------------------------------------------------------------

export interface PoseSample {
  hold: ResearchHold;
  session: string;
  feats: PoseFeatures;
  mirrored: PoseFeatures;
}

export function poseSamples(d: Dataset): PoseSample[] {
  const out: PoseSample[] = [];
  for (const s of d.sessions)
    for (const h of s.holds) if (h.pose?.world) out.push({ hold: h, session: s.label, feats: poseFeatures(h.pose.world), mirrored: poseFeatures(h.pose.world, true) });
  return out;
}

const flip = (side: 'R' | 'L' | null) => (side === 'R' ? 'L' : side === 'L' ? 'R' : null);

export interface PosePrediction {
  asanaId: string;
  side: 'R' | 'L' | null;
  distance: number;
}

/**
 * Ranked (asana, side) classes for `f`: each class's distance is its nearest training sample
 * ('nn') or its centroid-free mean of the k nearest ('knn'); training samples count for their own
 * side and, mirrored, for the other side.
 */
export function rankClasses(f: PoseFeatures, train: PoseSample[], angleWeight = 1, mode: 'nn' | 'mean2' = 'nn'): PosePrediction[] {
  const byClass = new Map<string, number[]>();
  const add = (asanaId: string, side: 'R' | 'L' | null, dist: number) => {
    const k = `${asanaId}|${side ?? ''}`;
    byClass.set(k, [...(byClass.get(k) ?? []), dist]);
  };
  for (const t of train) {
    add(t.hold.asanaId, t.hold.side, poseDistance(f, t.feats, angleWeight));
    if (t.hold.side) add(t.hold.asanaId, flip(t.hold.side), poseDistance(f, t.mirrored, angleWeight));
  }
  return [...byClass.entries()]
    .map(([k, list]) => {
      const [asanaId, side] = k.split('|') as [string, string];
      list.sort((a, b) => a - b);
      const distance = mode === 'nn' ? list[0]! : (list[0]! + (list[1] ?? list[0]!)) / 2;
      return { asanaId, side: (side || null) as 'R' | 'L' | null, distance };
    })
    .sort((a, b) => a.distance - b.distance);
}

function poseSection(d: Dataset) {
  const samples = poseSamples(d);
  const families = asanaFamilies(catalogOf(d));
  const familyOf = new Map<string, string>();
  for (const f of families) for (const m of f.members) familyOf.set(m.id, f.base);
  console.log(`\n### Pose classifier on the stills (world landmarks, leave one session out; ${samples.length} holds with a pose)\n`);
  const rows: Array<Array<string | number>> = [];
  let bestConf: Map<string, number> | null = null;
  let bestAcc = -1;
  for (const mode of ['nn', 'mean2'] as const)
    for (const w of [0, 0.5, 1, 2]) {
      let asana = 0;
      let top3 = 0;
      let family = 0;
      let letterN = 0;
      let letter = 0;
      let sideN = 0;
      let side = 0;
      const conf = new Map<string, number>();
      const perSession = new Map<string, [number, number]>();
      for (const t of samples) {
        const train = samples.filter((x) => x.session !== t.session);
        const ranked = rankClasses(t.feats, train, w, mode);
        const asanaRank = [...new Set(ranked.map((r) => r.asanaId))];
        const pred = ranked[0]!;
        const ok = pred.asanaId === t.hold.asanaId;
        asana += ok ? 1 : 0;
        top3 += asanaRank.slice(0, 3).includes(t.hold.asanaId) ? 1 : 0;
        const ps = perSession.get(t.session) ?? [0, 0];
        perSession.set(t.session, [ps[0] + (ok ? 1 : 0), ps[1] + 1]);
        if (familyOf.get(pred.asanaId) === familyOf.get(t.hold.asanaId)) {
          family++;
          if (variantOf(d.name(t.hold.asanaId)) && families.find((f) => f.base === familyOf.get(t.hold.asanaId))!.members.length > 1) {
            letterN++;
            letter += ok ? 1 : 0;
          }
        }
        if (t.hold.side) {
          // Side given the right asana: the nearer of the two sides of the true asana.
          const r = ranked.find((x) => x.asanaId === t.hold.asanaId && x.side === t.hold.side);
          const o = ranked.find((x) => x.asanaId === t.hold.asanaId && x.side === flip(t.hold.side));
          if (r && o) {
            sideN++;
            side += r.distance <= o.distance ? 1 : 0;
          }
        }
        if (!ok) {
          const k = `${d.name(t.hold.asanaId)} → ${d.name(pred.asanaId)}`;
          conf.set(k, (conf.get(k) ?? 0) + 1);
        }
      }
      const n = samples.length;
      if (asana > bestAcc) ((bestAcc = asana), (bestConf = conf));
      rows.push([
        mode === 'nn' ? 'nearest sample' : 'mean of 2 nearest',
        w,
        pct(asana, n),
        pct(top3, n),
        pct(family, n),
        `${pct(letter, letterN)} (${letterN})`,
        `${pct(side, sideN)} (${sideN})`,
        [...perSession.entries()].map(([s, [a, b]]) => `${s} ${pct(a, b)}`).join(', '),
      ]);
    }
  console.log(table(['Class distance', 'Angle weight', 'Asana top 1', 'Asana top 3', 'Family', 'Letter, family right (n)', 'Side, asana given (n)', 'Asana top 1 per held-out session'], rows));
  console.log('\nMost frequent confusions (best setting):\n');
  console.log(table(['Truth → predicted', 'Count'], [...bestConf!.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)));
}

// ---- whole-session alignment ---------------------------------------------------------------------

/** Pose cost per (hold, template entry): distance to the entry's class minus the hold's best class distance. */
export function poseEmission(d: Dataset, s: SessionData, t: SequenceTemplate, weight: number, angleWeight = 0.5): (i: number, j: number) => number {
  const samples = poseSamples(d);
  const train = samples.filter((x) => x.session !== s.label);
  const costs = s.holds.map((h) => {
    const f = samples.find((x) => x.hold.id === h.id);
    if (!f || weight === 0) return null;
    const ranked = rankClasses(f.feats, train, angleWeight);
    const best = ranked[0]?.distance ?? 0;
    const worst = ranked[ranked.length - 1]?.distance ?? best;
    const byClass = new Map(ranked.map((r) => [`${r.asanaId}|${r.side ?? ''}`, r.distance]));
    return t.entries.map((e) => {
      const side = e.side ?? null;
      const dist = byClass.get(`${e.asanaId}|${side ?? ''}`) ?? byClass.get(`${e.asanaId}|`) ?? worst;
      return weight * (dist - best);
    });
  });
  return (i, j) => costs[i]?.[j] ?? 0;
}

/** Zero-touch: every hold gets its first suggestion, nothing corrected. */
function greedyLabels(d: Dataset, s: SessionData): Array<Label | undefined> {
  const t = d.raw.templates.find((x) => x.id === s.templateId) ?? null;
  const items: ReviewItem[] = s.holds.map((h) => ({ key: h.id, status: 'open' }));
  const sugg = suggest(items, catalogOf(d), t, historyFor(d, s), { now: `${s.date}T12:00:00Z` });
  return s.holds.map((h) => sugg[h.id]?.[0]);
}

function alignedLabels(d: Dataset, s: SessionData, weight: number, costs: AlignCosts = ALIGN_COSTS): Array<Label | undefined> {
  const t = d.raw.templates.find((x) => x.id === s.templateId)!;
  const items = s.holds.map((h, i) => ({ newVideo: i > 0 && h.videoId !== s.holds[i - 1]!.videoId }));
  const sided = new Map(d.raw.catalog.map((a) => [a.id, a.sided]));
  const entries = alignSequence(items, t, poseEmission(d, s, t, weight), costs);
  return entries.map((j) => {
    const e = t.entries[j];
    return e ? { asanaId: e.asanaId, side: e.side ?? (sided.get(e.asanaId) ? 'R' : null), templateEntryIndex: j } : undefined;
  });
}

function poseOnlyLabels(d: Dataset, s: SessionData): Array<Label | undefined> {
  const samples = poseSamples(d);
  const train = samples.filter((x) => x.session !== s.label);
  return s.holds.map((h) => {
    const f = samples.find((x) => x.hold.id === h.id);
    const r = f ? rankClasses(f.feats, train, 0.5)[0] : undefined;
    return r ? { asanaId: r.asanaId, side: r.side } : undefined;
  });
}

function alignSection(d: Dataset) {
  console.log('\n### Zero-touch naming: every hold takes its first suggestion, nothing corrected (asana and side)\n');
  const methods: Array<[string, (s: SessionData) => Array<Label | undefined>]> = [
    ['Suggestions today (greedy template order)', (s) => greedyLabels(d, s)],
    ['Alignment, no pose', (s) => alignedLabels(d, s, 0)],
    ['Pose only (nearest sample)', (s) => poseOnlyLabels(d, s)],
    ['Alignment + pose (weight 2)', (s) => alignedLabels(d, s, 2)],
    ['Alignment + pose (weight 5)', (s) => alignedLabels(d, s, 5)],
    ['Alignment + pose (weight 10)', (s) => alignedLabels(d, s, 10)],
    ['Alignment + pose (weight 20)', (s) => alignedLabels(d, s, 20)],
  ];
  const rows: Array<Array<string | number>> = [];
  for (const [name, fn] of methods) {
    let ok = 0;
    let n = 0;
    const per: string[] = [];
    for (const s of d.sessions) {
      const labels = fn(s);
      const k = s.holds.filter((h, i) => labels[i] && same(labels[i]!, h)).length;
      per.push(pct(k, s.holds.length));
      ok += k;
      n += s.holds.length;
    }
    rows.push([name, ...per, pct(ok, n)]);
  }
  console.log(table(['Method', ...d.sessions.map((s) => s.label), 'All'], rows));
}

/** Top-to-bottom review with alignment + pose suggestions (labels before the card are the truth). */
export function replayAligned(d: Dataset, s: SessionData, weight: number, costs: AlignCosts = ALIGN_COSTS): ReplayStep[] {
  const t = d.raw.templates.find((x) => x.id === s.templateId)!;
  const items = s.holds.map((h, i) => ({ newVideo: i > 0 && h.videoId !== s.holds[i - 1]!.videoId }));
  const emission = poseEmission(d, s, t, weight);
  const completion = completionTable(items, t, emission, costs);
  const sided = new Map(d.raw.catalog.map((a) => [a.id, a.sided]));
  const labelOf = (k: number): Label => {
    const e = t.entries[k]!;
    return { asanaId: e.asanaId, side: e.side ?? (sided.get(e.asanaId) ? 'R' : null), templateEntryIndex: k };
  };
  const truthEntries = replaySession(d, s).map(() => -1);
  const keys = s.holds.map((h) => h.id);
  const labels: Label[] = [];
  const steps: ReplayStep[] = [];
  let j = t.entries.length;
  let c = 0;
  for (let i = 0; i < s.holds.length; i++) {
    const h = s.holds[i]!;
    const ranked = rankEntries(items, t, emission, completion, i, j, c, costs);
    const top: Label[] = [];
    for (const r of ranked) {
      const l = labelOf(r.entry);
      if (!top.some((x) => same(x, l))) top.push(l);
      if (top.length === 3) break;
    }
    const rank = top.findIndex((x) => same(x, h));
    steps.push({ hold: h, rank, top, cause: '' });
    // The user's label: its template entry as the app assigns it.
    const raw: ReviewItem[] = keys.map((key, k) => (k < i ? { key, status: 'labeled', label: labels[k]! } : { key, status: 'open' }));
    const entry = rank >= 0 ? top[rank]!.templateEntryIndex : matchTemplateEntry(alignToTemplate(raw, t), h.id, { asanaId: h.asanaId, side: h.side }, t);
    labels[i] = { asanaId: h.asanaId, side: h.side, ...(entry !== undefined ? { templateEntryIndex: entry } : {}) };
    truthEntries[i] = entry ?? -1;
    if (entry !== undefined) {
      c = entry === j ? c + 1 : 1;
      j = entry;
    }
  }
  return steps;
}

function interactiveSection(d: Dataset) {
  console.log('\n### Top-to-bottom review: suggestions today vs alignment + pose\n');
  const rows: Array<Array<string | number>> = [];
  for (const [name, fn] of [
    ['Suggestions today', (s: SessionData) => replaySession(d, s)],
    ['Suggestions today + posture class of the still', (s: SessionData) => replaySession(d, s, { posture: true })],
    ['Alignment + pose (weight 2)', (s: SessionData) => replayAligned(d, s, 2)],
    ['Alignment + pose (weight 5)', (s: SessionData) => replayAligned(d, s, 5)],
    ['Alignment, no pose', (s: SessionData) => replayAligned(d, s, 0)],
  ] as const) {
    const cells: string[] = [];
    let n = 0;
    let t1 = 0;
    let t3 = 0;
    for (const s of d.sessions) {
      const steps = fn(s);
      const a = steps.filter((x) => x.rank === 0).length;
      const b = steps.filter((x) => x.rank >= 0 && x.rank < 3).length;
      cells.push(`${pct(a, steps.length)} / ${pct(b, steps.length)}`);
      n += steps.length;
      t1 += a;
      t3 += b;
    }
    rows.push([name, ...cells, `${pct(t1, n)} / ${pct(t3, n)}`]);
  }
  console.log(table(['Method (top 1 / top 3)', ...d.sessions.map((s) => s.label), 'All'], rows));
}

/**
 * Zero-touch on the detector's candidates (fresh, defaults): a candidate's truth is the label of the
 * hold it belongs to, or "no hold" (false detection). Its pose is its hold's still (an estimate:
 * false detections have none, so the pose term is neutral there).
 */
function candidateSection(d: Dataset) {
  console.log('\n### Zero-touch on the detector\'s candidates (defaults; right = the label of the hold it belongs to, or "no hold" for a false detection)\n');
  const rows: Array<Array<string | number>> = [];
  const samples = poseSamples(d);
  for (const [name, weight, noHold] of [
    ['Suggestions today (greedy)', -1, 0],
    ['Alignment + pose, "no hold" cost 1', 2, 1],
    ['Alignment + pose, "no hold" cost 2', 2, 2],
    ['Alignment + pose, "no hold" cost 3', 2, 3],
  ] as const) {
    const cells: string[] = [];
    let okAll = 0;
    let nAll = 0;
    for (const s of d.sessions) {
      const t = d.raw.templates.find((x) => x.id === s.templateId)!;
      const cands = s.videos.flatMap((v) => {
        const f = v.analysis.fresh!;
        const m = matchDetection(f.candidates, v.holds);
        return f.candidates.map((c, ci) => ({ c, v, hold: m.candidates[ci]!.main >= 0 ? v.holds[m.candidates[ci]!.main]! : null }));
      });
      let labels: Array<Label | null>;
      if (weight < 0) {
        const items: ReviewItem[] = cands.map((_, i) => ({ key: String(i), status: 'open' }));
        const sugg = suggest(items, catalogOf(d), t, historyFor(d, s), { now: `${s.date}T12:00:00Z` });
        labels = cands.map((_, i) => sugg[String(i)]?.[0] ?? null);
      } else {
        const train = samples.filter((x) => x.session !== s.label);
        const sided = new Map(d.raw.catalog.map((a) => [a.id, a.sided]));
        const em = cands.map(({ hold }) => {
          const f = hold ? samples.find((x) => x.hold.id === hold.id) : undefined;
          if (!f) return null;
          const ranked = rankClasses(f.feats, train, 0.5);
          const best = ranked[0]!.distance;
          const by = new Map(ranked.map((r) => [`${r.asanaId}|${r.side ?? ''}`, r.distance]));
          const worst = ranked[ranked.length - 1]!.distance;
          return t.entries.map((e) => weight * ((by.get(`${e.asanaId}|${e.side ?? ''}`) ?? by.get(`${e.asanaId}|`) ?? worst) - best));
        });
        const items = cands.map((x, i) => ({ newVideo: i > 0 && x.v.videoId !== cands[i - 1]!.v.videoId }));
        const entries = alignSequence(items, t, (i, j) => em[i]?.[j] ?? 0, { ...ALIGN_COSTS, noHold }, true);
        labels = entries.map((j) => {
          const e = t.entries[j];
          return e ? { asanaId: e.asanaId, side: e.side ?? (sided.get(e.asanaId) ? 'R' : null) } : null;
        });
      }
      const ok = cands.filter((x, i) => (x.hold ? !!labels[i] && same(labels[i]!, x.hold) : labels[i] === null)).length;
      cells.push(`${ok}/${cands.length} (${pct(ok, cands.length)})`);
      okAll += ok;
      nAll += cands.length;
    }
    rows.push([name, ...cells, pct(okAll, nAll)]);
  }
  console.log(table(['Method', ...d.sessions.map((s) => s.label), 'All'], rows));
}

export default function main(args: string[]) {
  const d = loadResearch();
  replaySection(d);
  poseSection(d);
  alignSection(d);
  interactiveSection(d);
  candidateSection(d);
  if (args.includes('--list')) {
    for (const s of d.sessions) {
      console.log(`\n#### ${s.label}: every hold, suggestions today\n`);
      console.log(
        table(
          ['#', 'Truth', 'Rank', 'Top 3', 'Cause'],
          replaySession(d, s).map((st, i) => [i + 1, d.label(st.hold), st.rank >= 0 ? st.rank + 1 : '–', st.top.map((x) => d.label({ asanaId: x.asanaId, side: x.side })).join(' · '), st.cause]),
        ),
      );
    }
  }
}
