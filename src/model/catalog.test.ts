import { describe, expect, it } from 'vitest';
import { asanaFamilies, asanaNameError, asanaUsage, copyName, entriesFor, familyLetter, moveItem, sortCatalog, uniqueAsanaId, variantOf } from './catalog';
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

  it('reads lettered variants from names', () => {
    expect(variantOf('Janu Sirsasana A')).toEqual({ base: 'Janu Sirsasana', letter: 'A' });
    expect(variantOf(' Supta Padangusthasana B ')).toEqual({ base: 'Supta Padangusthasana', letter: 'B' });
    expect(variantOf('Marichyasana F')).toEqual({ base: 'Marichyasana', letter: 'F' });
    expect(variantOf('Navasana')).toBeNull();
    expect(variantOf('Foo G')).toBeNull();
    expect(variantOf('Foo a')).toBeNull();
    expect(variantOf('FooA')).toBeNull();
    expect(variantOf('A')).toBeNull();
  });

  it('groups lettered variants with the same base and group into families', () => {
    const list = [
      a('n', 'Navasana', 'Seated'),
      a('jb', 'Janu Sirsasana B', 'Seated', true),
      a('ja', 'Janu Sirsasana A', 'Seated', true),
      a('k', 'Kurmasana', 'Seated'),
      a('jc', 'janu sirsasana C', 'Seated', true),
      a('lone', 'Lone A', 'Seated'),
      a('xa', 'Split A', 'Standing'),
      a('xb', 'Split B', 'Seated'),
      a('fa', 'Foo A'),
      a('fb', 'Foo B'),
    ];
    const fams = asanaFamilies(list);
    expect(fams.map((f) => [f.base, f.group, f.members.map((m) => m.id)])).toEqual([
      ['Navasana', 'Seated', ['n']],
      ['Janu Sirsasana', 'Seated', ['ja', 'jb', 'jc']],
      ['Kurmasana', 'Seated', ['k']],
      ['Lone A', 'Seated', ['lone']],
      ['Split A', 'Standing', ['xa']],
      ['Split B', 'Seated', ['xb']],
      ['Foo', undefined, ['fa', 'fb']],
    ]);
    expect(familyLetter(fams[1]!, list[1]!)).toBe('B');
    expect(familyLetter(fams[0]!, list[0]!)).toBeNull();
    expect(familyLetter(fams[3]!, list[5]!)).toBeNull();
  });

  it('makes Supta Padangusthasana A/B a family in the seed catalog', () => {
    const fams = asanaFamilies(sortCatalog([...SEED_ASANAS]));
    const supta = fams.find((f) => f.base === 'Supta Padangusthasana');
    expect(supta?.members.map((m) => m.id)).toEqual(['supta-padangusthasana', 'supta-padangusthasana-b']);
    expect(fams.find((f) => f.base === 'Utthita Hasta Padangusthasana')?.members.length).toBe(3);
    expect(fams.find((f) => f.base === 'Sirsasana')?.group).toBe('Finishing');
    expect(fams.reduce((n, f) => n + f.members.length, 0)).toBe(SEED_ASANAS.length);
  });
});
