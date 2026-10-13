/**
 * Whole-session alignment of a sequence of items (holds or candidates) to template entries with a
 * Viterbi search. State = (entry, reps used so far); an item can also be "no hold" (a false
 * detection). Costs: skipped entry, fewer reps than usual, extra rep beyond the usual count, going
 * back to an earlier entry, no hold; skips at the start and after a new video are cheaper (the
 * recording may start late). Emission = an optional cost per (item, entry), e.g. a pose distance.
 */
import type { SequenceTemplate } from '../../src/model';

export interface AlignCosts {
  skip: number;
  fewerReps: number;
  extraRep: number;
  back: number;
  noHold: number;
  /** Per skipped entry at the start or right after a new video. */
  skipLead: number;
}

export const ALIGN_COSTS: AlignCosts = { skip: 1, fewerReps: 0.5, extraRep: 1.5, back: 4, noHold: 3, skipLead: 0.05 };

export interface AlignItem {
  /** First item of a video after the first one (a break). */
  newVideo: boolean;
}

/** Entry index per item, -1 = no hold. `emission(i, j)` = cost of item i being entry j (0 = neutral). */
export function alignSequence(items: AlignItem[], t: SequenceTemplate, emission: (i: number, j: number) => number, costs: AlignCosts = ALIGN_COSTS, withNoHold = false): number[] {
  const m = t.entries.length;
  const reps = t.entries.map((e) => Math.max(1, e.reps ?? 1));
  const R = Math.max(...reps) + 3;
  const S = (m + 1) * R;
  // state s = j * R + c: last entry j (m = before the start), c reps of j used (capped).
  const idx = (j: number, c: number) => j * R + Math.min(c, R - 1);
  let cost = new Float64Array(S).fill(Infinity);
  cost[idx(m, 0)] = 0;
  const back: Int32Array[] = [];
  const choice: Int32Array[] = [];
  for (let i = 0; i < items.length; i++) {
    const next = new Float64Array(S).fill(Infinity);
    const from = new Int32Array(S).fill(-1);
    const pick = new Int32Array(S).fill(-2);
    const lead = items[i]!.newVideo ? costs.skipLead : costs.skip;
    for (let s = 0; s < S; s++) {
      const c0 = cost[s]!;
      if (!Number.isFinite(c0)) continue;
      const j = Math.floor(s / R);
      const c = s % R;
      const start = j === m;
      if (withNoHold && c0 + costs.noHold < next[s]!) {
        next[s] = c0 + costs.noHold;
        from[s] = s;
        pick[s] = -1;
      }
      for (let k = 0; k < m; k++) {
        let tc: number;
        let nc = 1;
        if (!start && k === j) {
          tc = c >= reps[j]! ? costs.extraRep : 0;
          nc = c + 1;
        } else if (start || k > j) {
          const skipped = start ? k : k - j - 1;
          const perSkip = start ? costs.skipLead : lead;
          tc = skipped * perSkip + (start ? 0 : Math.max(0, reps[j]! - c) * (items[i]!.newVideo ? costs.skipLead : costs.fewerReps));
        } else {
          tc = costs.back + Math.max(0, reps[j]! - c) * costs.fewerReps;
        }
        const total = c0 + tc + emission(i, k);
        const ns = idx(k, nc);
        if (total < next[ns]!) {
          next[ns] = total;
          from[ns] = s;
          pick[ns] = k;
        }
      }
    }
    cost = next;
    back.push(from);
    choice.push(pick);
  }
  let s = 0;
  for (let q = 1; q < S; q++) if (cost[q]! < cost[s]!) s = q;
  const out = new Array<number>(items.length);
  for (let i = items.length - 1; i >= 0; i--) {
    out[i] = choice[i]![s]!;
    s = back[i]![s]!;
  }
  return out;
}

/** Transition cost from state (j, c) (j = entries.length: before the start) to entry k. */
export function transitionCost(t: SequenceTemplate, j: number, c: number, k: number, newVideo: boolean, costs: AlignCosts = ALIGN_COSTS): { cost: number; reps: number } {
  const m = t.entries.length;
  const reps = (q: number) => Math.max(1, t.entries[q]?.reps ?? 1);
  if (j === m) return { cost: k * costs.skipLead, reps: 1 };
  if (k === j) return { cost: c >= reps(j) ? costs.extraRep : 0, reps: c + 1 };
  const fewer = Math.max(0, reps(j) - c) * (newVideo ? costs.skipLead : costs.fewerReps);
  if (k > j) return { cost: (k - j - 1) * (newVideo ? costs.skipLead : costs.skip) + fewer, reps: 1 };
  return { cost: costs.back + Math.max(0, reps(j) - c) * costs.fewerReps, reps: 1 };
}

/**
 * Completion costs: table[i][s] = the cheapest cost of items i+1 … n−1 when the state after item i
 * is s = entry × R + reps (independent of how the items up to i were labeled).
 */
export function completionTable(items: AlignItem[], t: SequenceTemplate, emission: (i: number, j: number) => number, costs: AlignCosts = ALIGN_COSTS): { R: number; table: Float64Array[] } {
  const m = t.entries.length;
  const R = Math.max(...t.entries.map((e) => Math.max(1, e.reps ?? 1))) + 3;
  const S = (m + 1) * R;
  const cap = (x: number) => Math.min(x, R - 1);
  const table: Float64Array[] = new Array(items.length);
  let after = new Float64Array(S);
  table[items.length - 1] = after;
  for (let i = items.length - 1; i > 0; i--) {
    const prev = new Float64Array(S).fill(Infinity);
    const em = Array.from({ length: m }, (_, k) => emission(i, k));
    for (let s = 0; s < S; s++) {
      const sj = Math.floor(s / R);
      const sc = s % R;
      for (let k = 0; k < m; k++) {
        const tr = transitionCost(t, sj, sc, k, items[i]!.newVideo, costs);
        const v = tr.cost + em[k]! + after[k * R + cap(tr.reps)]!;
        if (v < prev[s]!) prev[s] = v;
      }
    }
    after = prev;
    table[i - 1] = after;
  }
  return { R, table };
}

/**
 * Ranked entries for item `at`, given the state after the item before it (entry `j`, `c` reps of
 * it; j = entries.length before the first item): transition + emission + the cheapest completion
 * of the items after it (min-marginals).
 */
export function rankEntries(
  items: AlignItem[],
  t: SequenceTemplate,
  emission: (i: number, j: number) => number,
  completion: { R: number; table: Float64Array[] },
  at: number,
  j: number,
  c: number,
  costs: AlignCosts = ALIGN_COSTS,
): Array<{ entry: number; cost: number }> {
  const { R, table } = completion;
  const cap = (x: number) => Math.min(x, R - 1);
  const out: Array<{ entry: number; cost: number }> = [];
  for (let k = 0; k < t.entries.length; k++) {
    const tr = transitionCost(t, j, cap(c), k, items[at]!.newVideo, costs);
    out.push({ entry: k, cost: tr.cost + emission(at, k) + table[at]![k * R + cap(tr.reps)]! });
  }
  return out.sort((a, b) => a.cost - b.cost || a.entry - b.entry);
}
