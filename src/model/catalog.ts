import { asanaId, SEED_ASANAS } from './seed';
import type { Asana, AsanaFamily, Hold, SequenceTemplate } from './types';

/** Catalog order: seed groups first (in seed order), then other groups and ungrouped; seed order, then name. */
export function sortCatalog(asanas: Asana[]): Asana[] {
  const seedIndex = new Map(SEED_ASANAS.map((a, i) => [a.id, i]));
  const seedGroups = [...new Set(SEED_ASANAS.map((a) => a.group ?? ''))];
  const groupRank = (g: string | undefined) => {
    const i = seedGroups.indexOf(g ?? '');
    return i >= 0 && g ? i : g ? seedGroups.length : seedGroups.length + 1;
  };
  return [...asanas].sort(
    (a, b) =>
      groupRank(a.group) - groupRank(b.group) ||
      (a.group ?? '').localeCompare(b.group ?? '') ||
      (seedIndex.get(a.id) ?? 1e9) - (seedIndex.get(b.id) ?? 1e9) ||
      a.name.localeCompare(b.name),
  );
}

/** Id for a new asana: slug of the name, made unique with -2, -3, … */
export function uniqueAsanaId(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = asanaId(name) || 'asana';
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  return id;
}

/** Validation message for an asana name, or null when it is fine. */
export function asanaNameError(name: string, asanas: Asana[], selfId?: string): string | null {
  const n = name.trim();
  if (!n) return 'Enter a name.';
  const lower = n.toLowerCase();
  if (asanas.some((a) => a.id !== selfId && a.name.trim().toLowerCase() === lower)) return 'An asana with this name exists.';
  return null;
}

/** How often an asana is used: holds and templates referencing it. */
export function asanaUsage(id: string, holds: Array<Pick<Hold, 'asanaId'>>, templates: SequenceTemplate[]): { holds: number; templates: SequenceTemplate[] } {
  return {
    holds: holds.filter((h) => h.asanaId === id).length,
    templates: templates.filter((t) => t.entries.some((e) => e.asanaId === id)),
  };
}

/** Template entries for adding an asana: right then left for sided asanas. */
export function entriesFor(asana: Asana, sides: 'both' | 'R' | 'L' = 'both'): SequenceTemplate['entries'] {
  if (!asana.sided) return [{ asanaId: asana.id }];
  if (sides === 'both') return [{ asanaId: asana.id, side: 'R' }, { asanaId: asana.id, side: 'L' }];
  return [{ asanaId: asana.id, side: sides }];
}

/** Moves an item; out-of-range indices leave the list unchanged. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return list;
  const out = [...list];
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x!);
  return out;
}

/** Lettered variant of a name: "Janu Sirsasana A" → { base: "Janu Sirsasana", letter: "A" }. */
export function variantOf(name: string): { base: string; letter: string } | null {
  const m = /^(.*\S)\s+([A-F])$/.exec(name.trim());
  return m ? { base: m[1]!, letter: m[2]! } : null;
}

/** Letter of a member inside its family, or null for a single-member entry. */
export function familyLetter(family: AsanaFamily, asana: Asana): string | null {
  return family.members.length > 1 ? (variantOf(asana.name)?.letter ?? null) : null;
}

/**
 * Groups lettered variants with the same base name (case-insensitive) and group into families
 * (≥ 2 members); everything else is a single-member entry. Order follows each family's first
 * member in `asanas` (pass the sorted catalog).
 */
export function asanaFamilies(asanas: readonly Asana[]): AsanaFamily[] {
  const keyOf = (a: Asana): string | null => {
    const v = variantOf(a.name);
    return v ? `${a.group ?? ''}\u0000${v.base.toLowerCase()}` : null;
  };
  const byKey = new Map<string, Asana[]>();
  for (const a of asanas) {
    const k = keyOf(a);
    if (k !== null) byKey.set(k, [...(byKey.get(k) ?? []), a]);
  }
  const out: AsanaFamily[] = [];
  const done = new Set<string>();
  for (const a of asanas) {
    const k = keyOf(a);
    const members = k === null ? [] : byKey.get(k)!;
    if (members.length < 2) {
      out.push({ base: a.name, group: a.group, members: [a] });
      continue;
    }
    if (done.has(k!)) continue;
    done.add(k!);
    const letter = (x: Asana) => variantOf(x.name)!.letter;
    out.push({ base: variantOf(a.name)!.base, group: a.group, members: [...members].sort((x, y) => letter(x).localeCompare(letter(y))) });
  }
  return out;
}

/** Name for a copy: "Name (copy)", "Name (copy 2)", … */
export function copyName(name: string, existing: string[]): string {
  const used = new Set(existing);
  let candidate = `${name} (copy)`;
  for (let n = 2; used.has(candidate); n++) candidate = `${name} (copy ${n})`;
  return candidate;
}
