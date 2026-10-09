import type { Asana, SequenceTemplate } from '../model/types';
import type { HistoryEntry, Label, ReviewItem, Suggestion, SuggestionOptions } from './types';

const DAY_MS = 86_400_000;
const RECENCY_DAYS = 45;
const SUCCESSOR_WEIGHT = 3;

function entryLabel(t: SequenceTemplate, i: number, catalog: Map<string, Asana>): Label {
  const e = t.entries[i]!;
  const a = catalog.get(e.asanaId);
  return { asanaId: e.asanaId, side: e.side ?? (a?.sided ? 'R' : null), templateEntryIndex: i };
}

/** Template entry indices used by labeled items. */
export function usedEntries(items: ReviewItem[]): Set<number> {
  return new Set(entryUse(items).keys());
}

/** How many labeled items use each template entry (an entry with `reps` takes several holds). */
export function entryUse(items: ReviewItem[]): Map<number, number> {
  const use = new Map<number, number>();
  for (const it of items) {
    const i = it.label?.templateEntryIndex;
    if (it.status === 'labeled' && i !== undefined) use.set(i, (use.get(i) ?? 0) + 1);
  }
  return use;
}

/** Usual number of holds for a template entry (at least 1). */
export function repsOf(t: SequenceTemplate, i: number): number {
  return Math.max(1, Math.round(t.entries[i]?.reps ?? 1));
}

/** True once an entry has its usual number of holds. */
function isFull(t: SequenceTemplate, use: Map<number, number>, i: number): boolean {
  return (use.get(i) ?? 0) >= repsOf(t, i);
}

function sameLabel(t: SequenceTemplate, i: number, label: { asanaId: string; side: Label['side'] }): boolean {
  const e = t.entries[i];
  return !!e && e.asanaId === label.asanaId && (e.side ?? null) === (label.side ?? null);
}

/**
 * Template suggestions for every open item:
 *  - follow the template order; an entry takes up to its `reps` holds (default 1); skipping is
 *    allowed, and a repeatable entry (reps > 1) is still offered for another rep beyond its count
 *  - start at the last confirmed entry before the item while it expects more reps, else after it
 *    (open items before it are projected to take the next entries, so a run of open cards gets
 *    consecutive suggestions)
 *  - prefer entries before the next confirmed entry after the item
 *  - if the item's posture class contradicts the next entry, look ahead up to `lookahead` entries
 */
function templateSuggestions(
  items: ReviewItem[],
  template: SequenceTemplate,
  catalog: Map<string, Asana>,
  limit: number,
  lookahead: number,
): Map<string, Suggestion[]> {
  const out = new Map<string, Suggestion[]>();
  const use = entryUse(items);
  const full = (e: number) => isFull(template, use, e);
  const n = template.entries.length;
  // Next confirmed entry index after each position.
  const upper: number[] = new Array(items.length).fill(n);
  let next = n;
  for (let i = items.length - 1; i >= 0; i--) {
    upper[i] = next;
    const it = items[i]!;
    if (it.status === 'labeled' && it.label?.templateEntryIndex !== undefined) next = it.label.templateEntryIndex;
  }
  let cursor = -1;
  items.forEach((it, i) => {
    if (it.status === 'labeled') {
      if (it.label?.templateEntryIndex !== undefined) cursor = it.label.templateEntryIndex;
      return;
    }
    if (it.status === 'dismissed') return;
    const inRange: number[] = [];
    const after: number[] = [];
    if (cursor >= 0 && !full(cursor)) inRange.push(cursor);
    for (let e = cursor + 1; e < n; e++) {
      if (!full(e)) (e < upper[i]! ? inRange : after).push(e);
    }
    const ordered = [...inRange, ...after];
    // Another rep beyond the usual count stays possible for repeatable entries.
    const extra = cursor >= 0 && full(cursor) && repsOf(template, cursor) > 1 ? cursor : undefined;
    if (ordered.length === 0 && extra === undefined) return;
    let picks = ordered.slice(0, limit);
    let reasons: Suggestion['reason'][] = picks.map(() => 'template');
    const cls = it.postureClass;
    const fits = (e: number) => {
      const p = catalog.get(template.entries[e]!.asanaId)?.posture;
      return !cls || !p || p === cls;
    };
    if (cls && !fits(ordered[0]!)) {
      const window = ordered.slice(0, 1 + lookahead);
      const good = window.filter(fits);
      const rest = ordered.filter((e) => !good.includes(e));
      picks = [...good, ...rest].slice(0, limit);
      reasons = picks.map((e) => (good.includes(e) ? 'lookahead' : 'template'));
    }
    if (extra !== undefined) {
      const at = Math.min(1, picks.length);
      picks = [...picks.slice(0, at), extra, ...picks.slice(at)].slice(0, limit);
      reasons = [...reasons.slice(0, at), 'rep' as const, ...reasons.slice(at)].slice(0, limit);
    }
    out.set(
      it.key,
      picks.map((e, k) => ({ ...entryLabel(template, e, catalog), reason: reasons[k]! })),
    );
    // Project: this open item takes its top suggestion.
    use.set(picks[0]!, (use.get(picks[0]!) ?? 0) + 1);
    cursor = picks[0]!;
  });
  return out;
}

/** Side for a sided asana given what the session already has: R first, then L. */
export function nextSide(asana: Asana | undefined, labels: Label[]): Label['side'] {
  if (!asana?.sided) return null;
  const sides = labels.filter((l) => l.asanaId === asana.id).map((l) => l.side);
  if (!sides.includes('R')) return 'R';
  if (!sides.includes('L')) return 'L';
  return 'R';
}

/** Frecency + "what usually follows the previous asana" from past sessions. */
function historySuggestions(
  items: ReviewItem[],
  catalog: Map<string, Asana>,
  history: HistoryEntry[],
  limit: number,
  nowMs: number,
  skip: Set<string>,
): Map<string, Suggestion[]> {
  const out = new Map<string, Suggestion[]>();
  if (history.length === 0) return out;
  const frecency = new Map<string, number>();
  for (const h of history) {
    const age = Math.max(0, (nowMs - Date.parse(h.date)) / DAY_MS);
    frecency.set(h.asanaId, (frecency.get(h.asanaId) ?? 0) + Math.exp(-age / RECENCY_DAYS));
  }
  const successors = new Map<string, Map<string, number>>();
  const bySession = new Map<string, HistoryEntry[]>();
  for (const h of history) {
    const list = bySession.get(h.sessionId) ?? [];
    list.push(h);
    bySession.set(h.sessionId, list);
  }
  for (const list of bySession.values()) {
    list.sort((a, b) => a.order - b.order);
    for (let i = 1; i < list.length; i++) {
      const from = list[i - 1]!.asanaId;
      const m = successors.get(from) ?? new Map<string, number>();
      m.set(list[i]!.asanaId, (m.get(list[i]!.asanaId) ?? 0) + 1);
      successors.set(from, m);
    }
  }
  const labels: Label[] = [];
  let prev: string | null = null;
  for (const it of items) {
    if (it.status === 'labeled' && it.label) {
      labels.push(it.label);
      prev = it.label.asanaId;
      continue;
    }
    if (it.status !== 'open' || skip.has(it.key)) continue;
    const succ = prev ? successors.get(prev) : undefined;
    const succTotal = succ ? [...succ.values()].reduce((a, b) => a + b, 0) : 0;
    const scored = [...frecency.entries()]
      .map(([id, f]) => ({ id, score: f + (succ && succTotal ? (SUCCESSOR_WEIGHT * (succ.get(id) ?? 0)) / succTotal : 0) }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, limit);
    const sugg = scored.map(({ id }) => ({ asanaId: id, side: nextSide(catalog.get(id), labels), reason: 'history' as const }));
    if (sugg.length) {
      out.set(it.key, sugg);
      labels.push(sugg[0]!);
      prev = sugg[0]!.asanaId;
    }
  }
  return out;
}

/**
 * Suggestions (top `limit`) for every open item. With a template: template order; once the
 * template is exhausted (or without a template): recency and frequency of use.
 */
export function suggest(
  items: ReviewItem[],
  catalog: Asana[],
  template: SequenceTemplate | null,
  history: HistoryEntry[],
  options: SuggestionOptions = {},
): Record<string, Suggestion[]> {
  const limit = options.limit ?? 3;
  const lookahead = options.lookahead ?? 5;
  const nowMs = options.now ? Date.parse(options.now) : Date.now();
  const byId = new Map(catalog.map((a) => [a.id, a]));
  const fromTemplate = template ? templateSuggestions(items, template, byId, limit, lookahead) : new Map<string, Suggestion[]>();
  const fromHistory = historySuggestions(items, byId, history, limit, nowMs, new Set(fromTemplate.keys()));
  return Object.fromEntries([...fromTemplate, ...fromHistory]);
}

/**
 * Template entry for a label chosen by hand (search): the entry of the previous labeled item if it
 * has the same asana and side (another rep), else the first matching entry after it that still
 * expects holds, else any such entry. Undefined if none.
 */
export function matchTemplateEntry(
  items: ReviewItem[],
  key: string,
  label: { asanaId: string; side: Label['side'] },
  template: SequenceTemplate | null,
): number | undefined {
  if (!template) return undefined;
  const use = entryUse(items.filter((it) => it.key !== key));
  const cursor = cursorBefore(items, key);
  const prev = [...items.slice(0, Math.max(0, items.findIndex((it) => it.key === key)))].reverse().find((it) => it.status === 'labeled');
  const repeat = prev?.label?.asanaId === label.asanaId && (prev.label.side ?? null) === (label.side ?? null);
  if (repeat && cursor >= 0 && sameLabel(template, cursor, label)) return cursor;
  const matches = (i: number) => sameLabel(template, i, label) && !isFull(template, use, i);
  for (let i = cursor + 1; i < template.entries.length; i++) if (matches(i)) return i;
  for (let i = 0; i <= cursor && i < template.entries.length; i++) if (matches(i)) return i;
  return undefined;
}

/** Template entry of the last labeled item before `key` (-1 if none). */
function cursorBefore(items: ReviewItem[], key: string): number {
  let cursor = -1;
  for (const it of items) {
    if (it.key === key) break;
    if (it.status === 'labeled' && it.label?.templateEntryIndex !== undefined) cursor = it.label.templateEntryIndex;
  }
  return cursor;
}

/** The next `count` template entries that still expect holds, from the last labeled entry before `key`. */
export function nextEntries(
  items: ReviewItem[],
  key: string,
  template: SequenceTemplate | null,
  catalog: Asana[],
  count = 8,
): Label[] {
  if (!template) return [];
  const byId = new Map(catalog.map((a) => [a.id, a]));
  const use = entryUse(items.filter((it) => it.key !== key));
  const cursor = cursorBefore(items, key);
  const out: Label[] = [];
  const start = cursor >= 0 && !isFull(template, use, cursor) ? cursor : cursor + 1;
  for (let i = start; i < template.entries.length && out.length < count; i++) {
    if (!isFull(template, use, i)) out.push(entryLabel(template, i, byId));
  }
  return out;
}

/**
 * Re-maps the template entry of every labeled item onto `template`: an index is kept while it
 * still points at a matching entry (same asana and side) that expects more holds, or is the
 * previous item's entry (another rep); otherwise (template switched or edited) the first such
 * entry after the previous labeled one is used, else none.
 */
export function alignToTemplate(items: ReviewItem[], template: SequenceTemplate | null): ReviewItem[] {
  const n = template?.entries.length ?? 0;
  const use = new Map<number, number>();
  let cursor = -1;
  let prev: Label | null = null;
  return items.map((it) => {
    if (it.status !== 'labeled' || !it.label) return it;
    const { templateEntryIndex: idx, ...label } = it.label;
    const repeat = !!prev && prev.asanaId === label.asanaId && (prev.side ?? null) === (label.side ?? null);
    prev = label;
    const matches = (i: number) => sameLabel(template!, i, label) && ((repeat && i === cursor) || !isFull(template!, use, i));
    const take = (i: number) => {
      use.set(i, (use.get(i) ?? 0) + 1);
      cursor = i;
    };
    let found: number | undefined;
    if (template && idx !== undefined && idx < n && matches(idx)) found = idx;
    for (let i = cursor + 1; found === undefined && i < n; i++) if (matches(i)) found = i;
    for (let i = 0; found === undefined && i <= cursor && i < n; i++) if (matches(i)) found = i;
    if (found === idx) {
      if (found !== undefined) take(found);
      return it;
    }
    if (found === undefined) return { ...it, label };
    take(found);
    return { ...it, label: { ...label, templateEntryIndex: found } };
  });
}

/**
 * How many holds the template expects in place of `key` and the other open items between the
 * labeled items around it: the remaining reps of the previous labeled entry plus all reps of the
 * entries before the next labeled entry, minus the other open items in between. Undefined without
 * a template or a labeled item on both sides (then nothing bounds the count).
 */
export function expectedHolds(items: ReviewItem[], key: string, template: SequenceTemplate | null): number | undefined {
  if (!template) return undefined;
  const at = items.findIndex((it) => it.key === key);
  if (at < 0) return undefined;
  let lo = -1;
  let hi = -1;
  for (let i = at - 1; i >= 0; i--) {
    const it = items[i]!;
    if (it.status === 'labeled') {
      if (it.label?.templateEntryIndex === undefined) return undefined;
      lo = i;
      break;
    }
  }
  for (let i = at + 1; i < items.length; i++) {
    const it = items[i]!;
    if (it.status === 'labeled') {
      if (it.label?.templateEntryIndex === undefined) return undefined;
      hi = i;
      break;
    }
  }
  if (lo < 0 || hi < 0) return undefined;
  const p = items[lo]!.label!.templateEntryIndex!;
  const q = items[hi]!.label!.templateEntryIndex!;
  if (q < p) return undefined;
  const use = entryUse(items.filter((it) => it.key !== key));
  let slots = Math.max(0, repsOf(template, p) - (use.get(p) ?? 0));
  for (let e = p + 1; e < q; e++) slots += repsOf(template, e);
  const others = items.slice(lo + 1, hi).filter((it) => it.key !== key && it.status === 'open').length;
  return slots - others;
}
