import type { Asana } from '../model/types';

function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * Catalog search: every query word must match the start of a word in the name, or the query must
 * match the initials ("uhp" → Utthita Hasta Padangusthasana). Results keep catalog order, with
 * name-prefix matches first.
 */
export function searchAsanas(catalog: Asana[], query: string): Asana[] {
  const q = norm(query).trim();
  if (!q) return [...catalog];
  const words = q.split(/\s+/);
  const scored: Array<{ a: Asana; score: number; i: number }> = [];
  catalog.forEach((a, i) => {
    const name = norm(a.name);
    const parts = name.split(/[\s-]+/);
    const initials = parts.map((p) => p[0]).join('');
    const wordMatch = words.every((w) => parts.some((p) => p.startsWith(w)));
    const initialMatch = words.length === 1 && initials.startsWith(words[0]!);
    const contains = name.includes(q);
    if (!wordMatch && !initialMatch && !contains) return;
    const score = name.startsWith(q) ? 0 : wordMatch ? 1 : initialMatch ? 2 : 3;
    scored.push({ a, score, i });
  });
  return scored.sort((x, y) => x.score - y.score || x.i - y.i).map((s) => s.a);
}
