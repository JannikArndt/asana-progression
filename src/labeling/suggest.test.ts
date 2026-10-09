import { describe, expect, it } from 'vitest';
import { alignToTemplate, entryUse, expectedHolds, matchTemplateEntry, nextEntries, nextSide, repsOf, suggest, usedEntries } from './suggest';
import { DOWNWARD_DOG_ID, primarySeriesTemplate, SEED_ASANAS } from '../model/seed';
import type { Asana, SequenceTemplate } from '../model/types';
import type { HistoryEntry, ReviewItem } from './types';

const catalog = [...SEED_ASANAS];
const full = primarySeriesTemplate();
// Index-based tests below use the series without the leading sun salutations.
const primary: SequenceTemplate = { ...full, entries: full.entries.filter((e) => e.asanaId !== DOWNWARD_DOG_ID) };
/** A template with one repeatable entry. */
const withReps: SequenceTemplate = { id: 'r', name: 'R', entries: [{ asanaId: 'navasana', reps: 3 }, { asanaId: 'bhujapidasana' }, { asanaId: 'kurmasana' }] };
const idx = (asanaId: string, side?: 'R' | 'L', from = 0) =>
  primary.entries.findIndex((e, i) => i >= from && e.asanaId === asanaId && (side ? e.side === side : true));

const open = (key: string, extra: Partial<ReviewItem> = {}): ReviewItem => ({ key, status: 'open', ...extra });
const labeled = (key: string, asanaId: string, side: 'R' | 'L' | null, templateEntryIndex?: number): ReviewItem => ({
  key,
  status: 'labeled',
  label: { asanaId, side, ...(templateEntryIndex !== undefined ? { templateEntryIndex } : {}) },
});

describe('template suggestions', () => {
  it('starts the Primary series with the sun salutations', () => {
    const s = suggest([open('a'), open('b')], catalog, full, []);
    expect(s.a![0]).toMatchObject({ asanaId: DOWNWARD_DOG_ID, templateEntryIndex: 0, reason: 'template' });
    // the second card is another rep of the same entry; the next asana is right behind it
    expect(s.b![0]).toMatchObject({ asanaId: DOWNWARD_DOG_ID, templateEntryIndex: 0 });
    expect(s.b![1]).toMatchObject({ asanaId: 'padangusthasana' });
  });

  it('offers reps of an entry up to its usual count, then more as an option', () => {
    const items = [labeled('a', 'navasana', null, 0), labeled('b', 'navasana', null, 0), open('c'), open('d'), open('e')];
    const s = suggest(items, catalog, withReps, []);
    expect(s.c!.map((x) => [x.asanaId, x.templateEntryIndex, x.reason])).toEqual([
      ['navasana', 0, 'template'],
      ['bhujapidasana', 1, 'template'],
      ['kurmasana', 2, 'template'],
    ]);
    // c is projected as the third rep → d moves on, but a fourth rep stays on offer
    expect(s.d!.map((x) => [x.asanaId, x.reason])).toEqual([
      ['bhujapidasana', 'template'],
      ['navasana', 'rep'],
      ['kurmasana', 'template'],
    ]);
    // single-rep entries are not repeated
    expect(s.e!.map((x) => x.asanaId)).toEqual(['kurmasana']);
    expect(entryUse(items)).toEqual(new Map([[0, 2]]));
    expect(repsOf(withReps, 0)).toBe(3);
    expect(repsOf(withReps, 9)).toBe(1);
  });

  it('only offers another rep when nothing else is left', () => {
    const t: SequenceTemplate = { id: 'x', name: 'X', entries: [{ asanaId: 'navasana', reps: 2 }] };
    const s = suggest([labeled('a', 'navasana', null, 0), labeled('b', 'navasana', null, 0), open('c')], catalog, t, []);
    expect(s.c).toEqual([{ asanaId: 'navasana', side: null, templateEntryIndex: 0, reason: 'rep' }]);
  });

  it('starts at the first entry and projects consecutive entries onto open cards', () => {
    const s = suggest([open('a'), open('b'), open('c')], catalog, primary, []);
    expect(s.a!.map((x) => x.asanaId)).toEqual(['padangusthasana', 'padahastasana', 'utthita-trikonasana']);
    expect(s.b![0]).toMatchObject({ asanaId: 'padahastasana', templateEntryIndex: 1, reason: 'template' });
    expect(s.c![0]).toMatchObject({ asanaId: 'utthita-trikonasana', side: 'R' });
  });

  it('suggests the first unused entry after the last confirmed one, right before left', () => {
    const items = [labeled('a', 'utthita-trikonasana', 'R', 2), open('b'), open('c')];
    const s = suggest(items, catalog, primary, []);
    expect(s.b![0]).toMatchObject({ asanaId: 'utthita-trikonasana', side: 'L', templateEntryIndex: 3 });
    expect(s.c![0]).toMatchObject({ asanaId: 'parivrtta-trikonasana', side: 'R' });
    expect(s.a).toBeUndefined();
  });

  it('allows skipping and uses each entry for its reps only', () => {
    const p = idx('paschimottanasana-a');
    const closing = idx('paschimottanasana-a', undefined, p + 1);
    const ud = closing - 1;
    const items = [labeled('x', 'paschimottanasana-a', null, p), labeled('y', 'urdhva-dhanurasana', null, ud), open('z')];
    const s = suggest(items, catalog, primary, []);
    // Urdhva Dhanurasana usually 3 times, then the closing Paschimottanasana (not the first one again)
    expect(s.z![0]).toMatchObject({ asanaId: 'urdhva-dhanurasana', templateEntryIndex: ud });
    expect(s.z![1]).toMatchObject({ asanaId: 'paschimottanasana-a', templateEntryIndex: closing });
    expect(usedEntries(items)).toEqual(new Set([p, ud]));
  });

  it('prefers entries before the next confirmed entry (labels out of order)', () => {
    const items = [labeled('a', 'padangusthasana', null, 0), open('b'), labeled('c', 'utthita-trikonasana', 'L', 3)];
    const s = suggest(items, catalog, primary, []);
    expect(s.b!.map((x) => x.templateEntryIndex)).toEqual([1, 2, 4]);
  });

  it('skips dismissed cards', () => {
    const s = suggest([open('a'), { key: 'd', status: 'dismissed' }, open('b')], catalog, primary, []);
    expect(s.d).toBeUndefined();
    expect(s.b![0]!.templateEntryIndex).toBe(1);
  });

  it('looks ahead up to 5 entries when the posture class contradicts', () => {
    // After Utkatasana come Virabhadrasana A/B (standing) and then Dandasana (seated).
    const u = idx('utkatasana');
    const items = [labeled('a', 'utkatasana', null, u), open('b', { postureClass: 'seated' })];
    const s = suggest(items, catalog, primary, []);
    expect(s.b![0]).toMatchObject({ asanaId: 'dandasana', reason: 'lookahead' });
    expect(s.b![1]).toMatchObject({ asanaId: 'paschimottanasana-a', reason: 'lookahead' });
    // a fitting class keeps plain order
    const t = suggest([labeled('a', 'utkatasana', null, u), open('b', { postureClass: 'standing' })], catalog, primary, []);
    expect(t.b![0]).toMatchObject({ asanaId: 'virabhadrasana-a', side: 'R', reason: 'template' });
    // nothing fitting within the window → template order
    const far = suggest([labeled('a', 'padangusthasana', null, 0), open('b', { postureClass: 'inverted' })], catalog, primary, [], { lookahead: 2 });
    expect(far.b![0]).toMatchObject({ asanaId: 'padahastasana', reason: 'template' });
  });

  it('respects the limit option and falls back to history when the template is exhausted', () => {
    const last = primary.entries.length - 1;
    const history: HistoryEntry[] = [{ asanaId: 'sirsasana-a', side: null, date: '2026-10-01', sessionId: 's0', order: 0 }];
    const s = suggest([labeled('a', 'savasana', null, last), open('b')], catalog, primary, history, { limit: 1, now: '2026-10-07' });
    expect(s.b).toEqual([{ asanaId: 'sirsasana-a', side: null, reason: 'history' }]);
    expect(suggest([open('a')], catalog, primary, [], { limit: 5 }).a!.length).toBe(5);
  });

  it('fills sides for sided asanas in templates without explicit sides', () => {
    const t: SequenceTemplate = { id: 't', name: 't', entries: [{ asanaId: 'parsvottanasana' }] };
    expect(suggest([open('a')], catalog, t, []).a![0]).toMatchObject({ side: 'R' });
    const unknown: SequenceTemplate = { id: 'u', name: 'u', entries: [{ asanaId: 'not-in-catalog' }] };
    expect(suggest([open('a')], catalog, unknown, []).a![0]).toMatchObject({ asanaId: 'not-in-catalog', side: null });
  });
});

describe('history suggestions (no template)', () => {
  const history: HistoryEntry[] = [
    { asanaId: 'sirsasana-a', side: null, date: '2026-09-30', sessionId: 's1', order: 0 },
    { asanaId: 'balasana', side: null, date: '2026-09-30', sessionId: 's1', order: 1 },
    { asanaId: 'sirsasana-a', side: null, date: '2026-10-05', sessionId: 's2', order: 0 },
    { asanaId: 'balasana', side: null, date: '2026-10-05', sessionId: 's2', order: 1 },
    { asanaId: 'parsvottanasana', side: 'R', date: '2026-10-06', sessionId: 's3', order: 0 },
    { asanaId: 'parsvottanasana', side: 'L', date: '2026-10-06', sessionId: 's3', order: 1 },
    { asanaId: 'navasana', side: null, date: '2024-01-01', sessionId: 's4', order: 0 },
  ];

  it('ranks by recency and frequency (ties by id)', () => {
    const s = suggest([open('a')], catalog, null, history, { now: '2026-10-07' });
    expect(s.a!.map((x) => x.asanaId)).toEqual(['parsvottanasana', 'balasana', 'sirsasana-a']);
    expect(s.a![0]!.side).toBe('R');
  });

  it('boosts what usually follows the previous asana', () => {
    const s = suggest([labeled('a', 'sirsasana-a', null), open('b')], catalog, null, history, { now: '2026-10-07' });
    expect(s.b![0]!.asanaId).toBe('balasana');
  });

  it('suggests the other side after one side, and nothing without history', () => {
    const s = suggest([labeled('a', 'parsvottanasana', 'R'), open('b')], catalog, null, history, { now: '2026-10-07' });
    const p = s.b!.find((x) => x.asanaId === 'parsvottanasana');
    expect(p?.side).toBe('L');
    expect(suggest([open('a')], catalog, null, [])).toEqual({});
  });

  it('projects across consecutive open cards', () => {
    const s = suggest([open('a'), open('b')], catalog, null, history, { now: '2026-10-07' });
    expect(s.b![0]!.asanaId).toBe('parsvottanasana');
    expect(s.b![0]!.side).toBe('L');
  });
});

describe('nextSide', () => {
  const sided: Asana = { id: 'x', name: 'X', sided: true };
  it('goes right, then left, then right again', () => {
    expect(nextSide(sided, [])).toBe('R');
    expect(nextSide(sided, [{ asanaId: 'x', side: 'R' }])).toBe('L');
    expect(nextSide(sided, [{ asanaId: 'x', side: 'R' }, { asanaId: 'x', side: 'L' }])).toBe('R');
    expect(nextSide({ ...sided, sided: false }, [])).toBeNull();
    expect(nextSide(undefined, [])).toBeNull();
  });
});

describe('matchTemplateEntry', () => {
  it('finds the next unused matching entry after the item position', () => {
    const p = idx('paschimottanasana-a');
    const closing = idx('paschimottanasana-a', undefined, p + 1);
    const items = [labeled('a', 'paschimottanasana-a', null, p), open('b')];
    // same label as the previous hold → another rep of its entry
    expect(matchTemplateEntry(items, 'b', { asanaId: 'paschimottanasana-a', side: null }, primary)).toBe(p);
    const later = [labeled('a', 'paschimottanasana-a', null, p), labeled('u', 'urdhva-dhanurasana', null, closing - 1), open('b')];
    expect(matchTemplateEntry(later, 'b', { asanaId: 'paschimottanasana-a', side: null }, primary)).toBe(closing);
    expect(matchTemplateEntry(items, 'b', { asanaId: 'marichyasana-a', side: 'L' }, primary)).toBe(idx('marichyasana-a', 'L'));
  });
  it('falls back to earlier unused entries and handles no template / no match', () => {
    const later = idx('savasana');
    const items = [labeled('a', 'savasana', null, later), open('b')];
    expect(matchTemplateEntry(items, 'b', { asanaId: 'dandasana', side: null }, primary)).toBe(idx('dandasana'));
    expect(matchTemplateEntry(items, 'b', { asanaId: 'savasana', side: null }, primary)).toBe(later);
    const other = [labeled('a', 'savasana', null, later), labeled('c', 'dandasana', null, idx('dandasana')), open('b')];
    expect(matchTemplateEntry(other, 'b', { asanaId: 'savasana', side: null }, primary)).toBeUndefined();
    expect(matchTemplateEntry(items, 'b', { asanaId: 'dandasana', side: null }, null)).toBeUndefined();
    // relabeling an item may reuse its own entry
    expect(matchTemplateEntry(items, 'a', { asanaId: 'savasana', side: null }, primary)).toBe(later);
  });
});

describe('nextEntries', () => {
  it('lists unused entries after the previous labeled one', () => {
    const items = [labeled('a', 'utthita-trikonasana', 'R', 2), open('b'), labeled('c', 'parivrtta-trikonasana', 'R', 4)];
    expect(nextEntries(items, 'b', primary, catalog, 3).map((l) => l.templateEntryIndex)).toEqual([3, 5, 6]);
    expect(nextEntries(items, 'b', null, catalog)).toEqual([]);
    expect(nextEntries([open('x')], 'x', primary, catalog).length).toBe(8);
  });
});

describe('real session: finishing sequence', () => {
  it('suggests the next eight finishing asanas after confirming Salamba Sarvangasana', () => {
    const start = idx('salamba-sarvangasana');
    const items = [labeled('h0', 'salamba-sarvangasana', null, start), ...Array.from({ length: 8 }, (_, i) => open(`h${i + 1}`))];
    const s = suggest(items, catalog, primary, []);
    expect(Array.from({ length: 8 }, (_, i) => s[`h${i + 1}`]![0]!.asanaId)).toEqual([
      'halasana',
      'karnapidasana',
      'urdhva-padmasana',
      'pindasana',
      'matsyasana',
      'uttana-padasana',
      'sirsasana-a',
      'sirsasana-b',
    ]);
  });
});

describe('alignToTemplate', () => {
  const t: SequenceTemplate = {
    id: 't',
    name: 'T',
    entries: [{ asanaId: 'a' }, { asanaId: 'b', side: 'R' }, { asanaId: 'b', side: 'L' }, { asanaId: 'a' }],
  };

  it('keeps valid indices and the identity of unchanged items', () => {
    const items = [open('o'), labeled('x', 'a', null, 0), labeled('y', 'b', 'R', 1)];
    const out = alignToTemplate(items, t);
    expect(out[0]).toBe(items[0]);
    expect(out[1]).toBe(items[1]);
    expect(out[2]).toBe(items[2]);
  });

  it('re-maps indices that point at another entry (template edited or switched)', () => {
    const out = alignToTemplate([labeled('x', 'b', 'L', 0), labeled('y', 'a', null, 1), labeled('z', 'a', null, 3)], t);
    // z repeats y's label → another rep of entry 3
    expect(out.map((i) => i.label?.templateEntryIndex)).toEqual([2, 3, 3]);
  });

  it('treats consecutive identical labels as reps and drops indices without a match', () => {
    const out = alignToTemplate([labeled('x', 'a', null, 0), labeled('y', 'a', null, 0), labeled('z', 'a', null, 0), labeled('w', 'c', null, 2)], t);
    expect(out.map((i) => i.label?.templateEntryIndex)).toEqual([0, 0, 0, undefined]);
    expect(out[3]!.label).toEqual({ asanaId: 'c', side: null });
    // a non-consecutive repeat takes the next free matching entry, then none
    const gap = alignToTemplate([labeled('x', 'a', null, 0), labeled('y', 'b', 'R', 1), labeled('z', 'a', null, 0), labeled('v', 'b', 'R', 1), labeled('u', 'a', null, 0)], t);
    expect(gap.map((i) => i.label?.templateEntryIndex)).toEqual([0, 1, 3, undefined, undefined]);
  });

  it('assigns entries to labels that had none, and clears all without a template', () => {
    expect(alignToTemplate([labeled('x', 'b', 'R')], t)[0]!.label?.templateEntryIndex).toBe(1);
    const items = [labeled('x', 'b', 'R', 1)];
    expect(alignToTemplate(items, null)[0]!.label).toEqual({ asanaId: 'b', side: 'R' });
    const none = [labeled('x', 'q', null)];
    expect(alignToTemplate(none, null)[0]).toBe(none[0]);
  });
});

describe('expectedHolds', () => {
  it('counts the template slots between the labeled neighbours, minus other open cards', () => {
    const pl = idx('parsvottanasana', 'L');
    const utk = idx('utkatasana');
    // UHP A/B/C R, A/B/C L and Ardha Baddha Padmottanasana R/L lie between them
    const items = [labeled('a', 'parsvottanasana', 'L', pl), open('b'), labeled('c', 'utkatasana', null, utk)];
    expect(expectedHolds(items, 'b', primary)).toBe(utk - pl - 1);
    expect(expectedHolds(items, 'b', primary)).toBe(8);
    const two = [labeled('a', 'parsvottanasana', 'L', pl), open('b'), open('x'), { key: 'd', status: 'dismissed' as const }, labeled('c', 'utkatasana', null, utk)];
    expect(expectedHolds(two, 'b', primary)).toBe(7);
  });

  it('includes the remaining reps of the previous entry', () => {
    const items = [labeled('a', 'navasana', null, 0), open('b'), labeled('c', 'kurmasana', null, 2)];
    expect(expectedHolds(items, 'b', withReps)).toBe(2 + 1);
    const same = [labeled('a', 'navasana', null, 0), open('b'), labeled('c', 'navasana', null, 0)];
    expect(expectedHolds(same, 'b', withReps)).toBe(1);
  });

  it('is undefined without a template or a labeled neighbour on both sides', () => {
    const items = [labeled('a', 'navasana', null, 0), open('b')];
    expect(expectedHolds(items, 'b', withReps)).toBeUndefined();
    expect(expectedHolds([open('b'), labeled('a', 'navasana', null, 0)], 'b', withReps)).toBeUndefined();
    expect(expectedHolds(items, 'b', null)).toBeUndefined();
    expect(expectedHolds(items, 'zz', withReps)).toBeUndefined();
    expect(expectedHolds([labeled('a', 'q', null), open('b'), labeled('c', 'navasana', null, 0)], 'b', withReps)).toBeUndefined();
    expect(expectedHolds([labeled('a', 'kurmasana', null, 2), open('b'), labeled('c', 'navasana', null, 0)], 'b', withReps)).toBeUndefined();
  });
});
