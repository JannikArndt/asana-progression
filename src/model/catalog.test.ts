import { describe, expect, it } from 'vitest';
import { asanaNameError, asanaUsage, copyName, entriesFor, moveItem, sortCatalog, uniqueAsanaId } from './catalog';
import { SEED_ASANAS } from './seed';
import type { Asana, SequenceTemplate } from './types';

const a = (id: string, name: string, group?: string, sided = false): Asana => ({ id, name, sided, ...(group ? { group } : {}) });

describe('catalog helpers', () => {
  it('sorts seed groups first, custom groups next, ungrouped last', () => {
    const seed = SEED_ASANAS.slice(0, 2);
    const list = [a('z', 'Zeta'), a('c', 'Custom', 'Restorative'), a('x', 'Extra standing', 'Standing'), ...[...seed].reverse()];
    const ids = sortCatalog(list).map((x) => x.id);
    expect(ids).toEqual([seed[0]!.id, seed[1]!.id, 'x', 'c', 'z']);
  });

  it('makes unique slug ids', () => {
    expect(uniqueAsanaId('Pārśva Bakāsana', [])).toBe('parsva-bakasana');
    expect(uniqueAsanaId('Navasana', ['navasana', 'navasana-2'])).toBe('navasana-3');
    expect(uniqueAsanaId('!!!', [])).toBe('asana');
  });

  it('validates names', () => {
    const all = [a('n', 'Navasana')];
    expect(asanaNameError(' ', all)).toBe('Enter a name.');
    expect(asanaNameError('navasana ', all)).toMatch(/exists/);
    expect(asanaNameError('Navasana', all, 'n')).toBeNull();
    expect(asanaNameError('Bakasana', all)).toBeNull();
  });

  it('counts usage', () => {
    const t: SequenceTemplate = { id: 't', name: 'T', entries: [{ asanaId: 'n' }] };
    const u = asanaUsage('n', [{ asanaId: 'n' }, { asanaId: 'm' }], [t, { ...t, id: 'u', entries: [] }]);
    expect(u.holds).toBe(1);
    expect(u.templates.map((x) => x.id)).toEqual(['t']);
  });

  it('builds entries right before left', () => {
    expect(entriesFor(a('n', 'N'))).toEqual([{ asanaId: 'n' }]);
    expect(entriesFor(a('s', 'S', undefined, true))).toEqual([{ asanaId: 's', side: 'R' }, { asanaId: 's', side: 'L' }]);
    expect(entriesFor(a('s', 'S', undefined, true), 'L')).toEqual([{ asanaId: 's', side: 'L' }]);
  });

  it('moves items and names copies', () => {
    expect(moveItem([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    const l = [1, 2];
    expect(moveItem(l, 0, 5)).toBe(l);
    expect(moveItem(l, 1, 1)).toBe(l);
    expect(copyName('P', [])).toBe('P (copy)');
    expect(copyName('P', ['P (copy)', 'P (copy 2)'])).toBe('P (copy 3)');
  });
});
