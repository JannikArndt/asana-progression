/**
 * Whole-session alignment of review items to template entries (research/REPORT.md, B2): a Viterbi
 * search over states (entry, reps used so far). Labeled items are pinned to their entry, open
 * items may take any entry or be "no hold" (a false detection). Costs: skipped entry, fewer reps
 * than usual, extra rep, going back; skips at the start and after a new video are cheap (the
 * recording may start late). An emission cost per (open item, entry) — e.g. a pose distance —
 * re-synchronises the sequence where the practice differs from the template.
 */
import type { SequenceTemplate } from '../model/types';

export interface AlignCosts {
  skip: number;
  fewerReps: number;
  extraRep: number;
  back: number;
  noHold: number;
  /** Per skipped entry at the start or after a new video. */
  skipLead: number;
}

/** Costs tested in the research (zero-touch 89 % on three sessions with pose weight 2). */
export const ALIGN_COSTS: Readonly<AlignCosts> = Object.freeze({ skip: 1, fewerReps: 0.5, extraRep: 1.5, back: 4, noHold: 3, skipLead: 0.05 });

export type AlignSlot =
  /** Labeled with this template entry. */
  | { kind: 'entry'; entry: number; newVideo: boolean }
  /** Labeled with something outside the template: no state change. */
  | { kind: 'other'; newVideo: boolean }
  /** Open: any entry (with `emission(entry)`) or no hold. */
  | { kind: 'open'; newVideo: boolean; emission: (entry: number) => number };

export interface AlignResult {
  /** Per slot: the entry on the best path, -1 = no hold / not an entry. */
  path: number[];
  /** Per open slot: the best total cost with each entry (min-marginals), and with "no hold". */
  marginals: Array<{ entries: Float64Array; noHold: number } | null>;
}

/**
 * Best path and min-marginals. State s = entry × R + reps (capped); entry = entries.length is
 * "before the first item".
 */
export function alignSlots(slots: AlignSlot[], t: SequenceTemplate, costs: AlignCosts = ALIGN_COSTS): AlignResult {
  const m = t.entries.length;
  const reps = t.entries.map((e) => Math.max(1, Math.round(e.reps ?? 1)));
  const R = Math.max(1, ...reps) + 3;
  const S = (m + 1) * R;
  const cap = (c: number) => Math.min(c, R - 1);
  // Transition tables: [newVideo][s * m + k] → cost and next state.
  const tables = [false, true].map((newVideo) => {
    const cost = new Float64Array(S * m);
    const next = new Int32Array(S * m);
    for (let s = 0; s < S; s++) {
      const j = Math.floor(s / R);
      const c = s % R;
      for (let k = 0; k < m; k++) {
        let tc: number;
        let nc = 1;
        if (j === m) tc = k * costs.skipLead;
        else if (k === j) {
          tc = c >= reps[j]! ? costs.extraRep : 0;
          nc = c + 1;
        } else {
          const fewer = Math.max(0, reps[j]! - c) * (newVideo ? costs.skipLead : costs.fewerReps);
          tc = k > j ? (k - j - 1) * (newVideo ? costs.skipLead : costs.skip) + fewer : costs.back + Math.max(0, reps[j]! - c) * costs.fewerReps;
        }
        cost[s * m + k] = tc;
        next[s * m + k] = k * R + cap(nc);
      }
    }
    return { cost, next };
  });
  const n = slots.length;
  // Forward: F[i] = best cost of slots < i ending in each state; back pointers for the path.
  const F: Float64Array[] = [new Float64Array(S).fill(Infinity)];
  F[0]![m * R] = 0;
  const from: Int32Array[] = [];
  const took: Int32Array[] = [];
  for (let i = 0; i < n; i++) {
    const slot = slots[i]!;
    const { cost, next } = tables[slot.newVideo ? 1 : 0]!;
    const cur = F[i]!;
    const out = new Float64Array(S).fill(Infinity);
    const bp = new Int32Array(S).fill(-1);
    const ch = new Int32Array(S).fill(-1);
    const em = slot.kind === 'open' ? Array.from({ length: m }, (_, k) => slot.emission(k)) : null;
    for (let s = 0; s < S; s++) {
      const f = cur[s]!;
      if (f === Infinity) continue;
      if (slot.kind !== 'entry') {
        const v = f + (slot.kind === 'open' ? costs.noHold : 0);
        if (v < out[s]!) ((out[s] = v), (bp[s] = s), (ch[s] = -1));
        if (slot.kind === 'other') continue;
      }
      const k0 = slot.kind === 'entry' ? slot.entry : 0;
      const k1 = slot.kind === 'entry' ? slot.entry + 1 : m;
      for (let k = k0; k < k1; k++) {
        const v = f + cost[s * m + k]! + (em ? em[k]! : 0);
        const ns = next[s * m + k]!;
        if (v < out[ns]!) ((out[ns] = v), (bp[ns] = s), (ch[ns] = k));
      }
    }
    F.push(out);
    from.push(bp);
    took.push(ch);
  }
  // Backward: B[i] = best cost of slots ≥ i from each state.
  const B: Float64Array[] = new Array(n + 1);
  B[n] = new Float64Array(S);
  for (let i = n - 1; i >= 0; i--) {
    const slot = slots[i]!;
    const { cost, next } = tables[slot.newVideo ? 1 : 0]!;
    const after = B[i + 1]!;
    const out = new Float64Array(S).fill(Infinity);
    const em = slot.kind === 'open' ? Array.from({ length: m }, (_, k) => slot.emission(k)) : null;
    for (let s = 0; s < S; s++) {
      let best = slot.kind === 'entry' ? Infinity : after[s]! + (slot.kind === 'open' ? costs.noHold : 0);
      if (slot.kind !== 'other') {
        const k0 = slot.kind === 'entry' ? slot.entry : 0;
        const k1 = slot.kind === 'entry' ? slot.entry + 1 : m;
        for (let k = k0; k < k1; k++) {
          const v = cost[s * m + k]! + (em ? em[k]! : 0) + after[next[s * m + k]!]!;
          if (v < best) best = v;
        }
      }
      out[s] = best;
    }
    B[i] = out;
  }
  // Path.
  const path = new Array<number>(n).fill(-1);
  let s = 0;
  for (let q = 1; q < S; q++) if (F[n]![q]! < F[n]![s]!) s = q;
  for (let i = n - 1; i >= 0 && s >= 0; i--) {
    path[i] = took[i]![s]!;
    s = from[i]![s]!;
  }
  // Min-marginals of open slots.
  const marginals = slots.map((slot, i) => {
    if (slot.kind !== 'open') return null;
    const { cost, next } = tables[slot.newVideo ? 1 : 0]!;
    const entries = new Float64Array(m).fill(Infinity);
    let noHold = Infinity;
    const em = Array.from({ length: m }, (_, k) => slot.emission(k));
    for (let st = 0; st < S; st++) {
      const f = F[i]![st]!;
      if (f === Infinity) continue;
      noHold = Math.min(noHold, f + costs.noHold + B[i + 1]![st]!);
      for (let k = 0; k < m; k++) {
        const v = f + cost[st * m + k]! + em[k]! + B[i + 1]![next[st * m + k]!]!;
        if (v < entries[k]!) entries[k] = v;
      }
    }
    return { entries, noHold };
  });
  return { path, marginals };
}
