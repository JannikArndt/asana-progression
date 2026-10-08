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

/** Template entry indices used by labeled items (each entry at most once per session). */
export function usedEntries(items: ReviewItem[]): Set<number> {
  const s = new Set<number>();
  for (const it of items) {
    const i = it.label?.templateEntryIndex;
    if (it.status === 'labeled' && i !== undefined) s.add(i);
  }
  return s;
}

/**
 * Template suggestions for every open item:
 *  - follow the template order; each entry at most once per session; skipping is allowed
 *  - start after the last confirmed entry before the item (open items before it are projected to
 *    take the next entries, so a run of open cards gets consecutive suggestions)
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
  const taken = usedEntries(items);
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
    for (let e = cursor + 1; e < n; e++) {
      if (!taken.has(e)) (e < upper[i]! ? inRange : after).push(e);
    }
    const ordered = [...inRange, ...after];
    if (ordered.length === 0) return;
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
    out.set(
      it.key,
      picks.map((e, k) => ({ ...entryLabel(template, e, catalog), reason: reasons[k]! })),
    );
    // Project: this open item takes its top suggestion.
    taken.add(picks[0]!);
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
 * Template entry for a label chosen by hand (search): the first unused entry with the same asana
 * and side after the item's position, else any unused matching entry. Undefined if none.
 */
export function matchTemplateEntry(
  items: ReviewItem[],
  key: string,
  label: { asanaId: string; side: Label['side'] },
  template: SequenceTemplate | null,
): number | undefined {
  if (!template) return undefined;
  const taken = usedEntries(items.filter((it) => it.key !== key));
  let cursor = -1;
  for (const it of items) {
    if (it.key === key) break;
    if (it.status === 'labeled' && it.label?.templateEntryIndex !== undefined) cursor = it.label.templateEntryIndex;
  }
  const matches = (i: number) => {
    const e = template.entries[i]!;
    return e.asanaId === label.asanaId && (e.side ?? null) === (label.side ?? null) && !taken.has(i);
  };
  for (let i = cursor + 1; i < template.entries.length; i++) if (matches(i)) return i;
  for (let i = 0; i <= cursor && i < template.entries.length; i++) if (matches(i)) return i;
  return undefined;
}

/** Key of the previous (non-dismissed) item if it carries the same asana and side. */
export function mergeCandidateFor(items: ReviewItem[], key: string, label: { asanaId: string; side: Label['side'] }): string | null {
  const idx = items.findIndex((it) => it.key === key);
  for (let i = idx - 1; i >= 0; i--) {
    const it = items[i]!;
    if (it.status === 'dismissed') continue;
    if (it.status === 'labeled' && it.label?.asanaId === label.asanaId && (it.label.side ?? null) === (label.side ?? null)) return it.key;
    return null;
  }
  return null;
}

/** The next `count` unused template entries after the last labeled entry before `key`. */
export function nextEntries(
  items: ReviewItem[],
  key: string,
  template: SequenceTemplate | null,
  catalog: Asana[],
  count = 8,
): Label[] {
  if (!template) return [];
  const byId = new Map(catalog.map((a) => [a.id, a]));
  const taken = usedEntries(items.filter((it) => it.key !== key));
  let cursor = -1;
  for (const it of items) {
    if (it.key === key) break;
    if (it.status === 'labeled' && it.label?.templateEntryIndex !== undefined) cursor = it.label.templateEntryIndex;
  }
  const out: Label[] = [];
  for (let i = cursor + 1; i < template.entries.length && out.length < count; i++) {
    if (!taken.has(i)) out.push(entryLabel(template, i, byId));
  }
  return out;
}

/**
 * Re-maps the template entry of every labeled item onto `template`: an index is kept while it
 * still points at an unused entry with the same asana and side; otherwise (template switched or
 * edited) the first unused matching entry after the previous labeled one is used, else none.
 */
export function alignToTemplate(items: ReviewItem[], template: SequenceTemplate | null): ReviewItem[] {
  const n = template?.entries.length ?? 0;
  const taken = new Set<number>();
  let cursor = -1;
  return items.map((it) => {
    if (it.status !== 'labeled' || !it.label) return it;
    const { templateEntryIndex: idx, ...label } = it.label;
    const matches = (i: number) => {
      const e = template!.entries[i]!;
      return !taken.has(i) && e.asanaId === label.asanaId && (e.side ?? null) === (label.side ?? null);
    };
    let found: number | undefined;
    if (template && idx !== undefined && idx < n && matches(idx)) found = idx;
    for (let i = cursor + 1; found === undefined && i < n; i++) if (matches(i)) found = i;
    for (let i = 0; found === undefined && i <= cursor && i < n; i++) if (matches(i)) found = i;
    if (found === idx) {
      if (found !== undefined) {
        taken.add(found);
        cursor = found;
      }
      return it;
    }
    if (found === undefined) return { ...it, label };
    taken.add(found);
    cursor = found;
    return { ...it, label: { ...label, templateEntryIndex: found } };
  });
}
