import { describe, expect, it } from 'vitest';
import {
  asanaId,
  DOWNWARD_DOG_ID,
  PRIMARY_SERIES_ID,
  primarySeriesTemplate,
  SEED_ADDED,
  SEED_ASANAS,
  SUPTA_PADANGUSTHASANA_ID,
  withReps,
  withSunSalutations,
  withSuptaPadangusthasanaB,
} from './seed';
import type { SequenceTemplate } from './types';

describe('catalog seed', () => {
  it('has unique ids and the expected sided asanas', () => {
    const ids = SEED_ASANAS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(SEED_ASANAS.length).toBe(64);
    const sided = SEED_ASANAS.filter((a) => a.sided).map((a) => a.name);
    expect(sided).toContain('Utthita Trikonasana');
    expect(sided).toContain('Marichyasana D');
    expect(sided).toContain('Supta Padangusthasana A');
    expect(sided).toContain('Supta Padangusthasana B');
    expect(sided).not.toContain('Paschimottanasana A');
    expect(sided.length).toBe(22);
    expect(SEED_ASANAS.every((a) => a.group && (a.posture || a.id === 'adho-mukha-svanasana'))).toBe(true);
  });

  it('derives ids from names', () => {
    expect(asanaId('Janu Sirsasana A')).toBe('janu-sirsasana-a');
    expect(asanaId('  Śavāsana ')).toBe('savasana');
  });

  it('keeps the id of Supta Padangusthasana for A (leg up) and adds B (leg to the side) in v4', () => {
    const a = SEED_ASANAS.find((x) => x.id === SUPTA_PADANGUSTHASANA_ID);
    const b = SEED_ASANAS.find((x) => x.id === 'supta-padangusthasana-b');
    expect(a).toMatchObject({ name: 'Supta Padangusthasana A', sided: true, posture: 'lying', group: 'Seated' });
    expect(b).toMatchObject({ name: 'Supta Padangusthasana B', sided: true, posture: 'lying', group: 'Seated' });
    expect(SEED_ADDED[4]).toEqual(['supta-padangusthasana-b']);
  });
});

describe('primary series template', () => {
  const t = primarySeriesTemplate();
  const label = (i: number) => `${t.entries[i]!.asanaId}${t.entries[i]!.side ? ` ${t.entries[i]!.side}` : ''}`;

  it('lists sided asanas right then left', () => {
    expect(t.id).toBe(PRIMARY_SERIES_ID);
    expect(label(1)).toBe('padangusthasana');
    expect(label(3)).toBe('utthita-trikonasana R');
    expect(label(4)).toBe('utthita-trikonasana L');
    expect(t.entries.length).toBe(64 + 22 + 1);
  });

  it('runs Utthita Hasta Padangusthasana A/B/C right, then A/B/C left', () => {
    const i = t.entries.findIndex((e) => e.asanaId === 'utthita-hasta-padangusthasana-a');
    expect([0, 1, 2, 3, 4, 5].map((k) => label(i + k))).toEqual([
      'utthita-hasta-padangusthasana-a R',
      'utthita-hasta-padangusthasana-b R',
      'utthita-hasta-padangusthasana-c R',
      'utthita-hasta-padangusthasana-a L',
      'utthita-hasta-padangusthasana-b L',
      'utthita-hasta-padangusthasana-c L',
    ]);
  });

  it('runs Supta Padangusthasana A/B right, then A/B left', () => {
    const i = t.entries.findIndex((e) => e.asanaId === SUPTA_PADANGUSTHASANA_ID);
    expect([0, 1, 2, 3].map((k) => label(i + k))).toEqual(['supta-padangusthasana R', 'supta-padangusthasana-b R', 'supta-padangusthasana L', 'supta-padangusthasana-b L']);
    expect(label(i - 1)).toBe('supta-konasana');
    expect(label(i + 4)).toBe('ubhaya-padangusthasana');
  });

  it('upgrades every template with Supta Padangusthasana R then L to A/B per side (v4)', () => {
    const v3: SequenceTemplate = {
      ...t,
      entries: t.entries.filter((e) => e.asanaId !== 'supta-padangusthasana-b'),
    };
    expect(withSuptaPadangusthasanaB(v3)).toEqual(t);
    expect(withSuptaPadangusthasanaB(t)).toBe(t);
    const own: SequenceTemplate = {
      id: 'own',
      name: 'Own',
      entries: [{ asanaId: 'navasana' }, { asanaId: SUPTA_PADANGUSTHASANA_ID, side: 'R', reps: 2 }, { asanaId: SUPTA_PADANGUSTHASANA_ID, side: 'L' }, { asanaId: 'savasana' }],
    };
    expect(withSuptaPadangusthasanaB(own).entries).toEqual([
      { asanaId: 'navasana' },
      { asanaId: SUPTA_PADANGUSTHASANA_ID, side: 'R', reps: 2 },
      { asanaId: 'supta-padangusthasana-b', side: 'R' },
      { asanaId: SUPTA_PADANGUSTHASANA_ID, side: 'L' },
      { asanaId: 'supta-padangusthasana-b', side: 'L' },
      { asanaId: 'savasana' },
    ]);
    // Only R directly followed by L; a template that already has B stays as it is.
    const leftOnly: SequenceTemplate = { id: 'l', name: 'L', entries: [{ asanaId: SUPTA_PADANGUSTHASANA_ID, side: 'L' }, { asanaId: SUPTA_PADANGUSTHASANA_ID, side: 'R' }] };
    expect(withSuptaPadangusthasanaB(leftOnly)).toBe(leftOnly);
    const withB: SequenceTemplate = { id: 'b', name: 'B', entries: [{ asanaId: 'supta-padangusthasana-b', side: 'R' }, { asanaId: SUPTA_PADANGUSTHASANA_ID, side: 'R' }, { asanaId: SUPTA_PADANGUSTHASANA_ID, side: 'L' }] };
    expect(withSuptaPadangusthasanaB(withB)).toBe(withB);
  });

  it('builds variant runs from the asanas that exist', () => {
    const only = primarySeriesTemplate(SEED_ASANAS.filter((a) => a.id !== SUPTA_PADANGUSTHASANA_ID));
    expect(only.entries.filter((e) => e.asanaId.startsWith('supta-padangusthasana'))).toEqual([
      { asanaId: 'supta-padangusthasana-b', side: 'R' },
      { asanaId: 'supta-padangusthasana-b', side: 'L' },
    ]);
  });

  it('closes backbending with Paschimottanasana again', () => {
    const ud = t.entries.findIndex((e) => e.asanaId === 'urdhva-dhanurasana');
    expect(t.entries[ud + 1]).toEqual({ asanaId: 'paschimottanasana-a' });
    expect(t.entries.filter((e) => e.asanaId === 'paschimottanasana-a').length).toBe(2);
    expect(label(t.entries.length - 1)).toBe('savasana');
  });

  it('repeats sun salutations, Navasana and Urdhva Dhanurasana as reps', () => {
    expect(t.entries[0]).toEqual({ asanaId: DOWNWARD_DOG_ID, reps: 8 });
    expect(t.entries.find((e) => e.asanaId === 'navasana')?.reps).toBe(5);
    const ud = t.entries.findIndex((e) => e.asanaId === 'urdhva-dhanurasana');
    expect(t.entries[ud]!.reps).toBe(3);
    expect(t.entries[ud + 1]).toEqual({ asanaId: 'paschimottanasana-a' });
  });

  it('upgrades existing templates: sun salutations once (v2), repeated entries to reps (v3)', () => {
    const v1 = { ...t, entries: t.entries.slice(1).map(({ reps: _, ...e }) => e) };
    const v2 = { ...v1, entries: [...Array.from({ length: 8 }, () => ({ asanaId: DOWNWARD_DOG_ID })), ...v1.entries] };
    expect(withSunSalutations(v1).entries[0]).toEqual({ asanaId: DOWNWARD_DOG_ID, reps: 8 });
    expect(withSunSalutations(v2)).toBe(v2);
    expect(withReps(v2)).toEqual(t);
    expect(withReps(withSunSalutations(v1))).toEqual(t);
    // other templates: only consecutive duplicates collapse; sides stay apart
    const own = { id: 'own', name: 'Own', entries: [{ asanaId: 'navasana' }, { asanaId: 'b', side: 'R' as const }, { asanaId: 'b', side: 'L' as const }, { asanaId: 'b', side: 'L' as const, reps: 2 }] };
    expect(withReps(own).entries).toEqual([{ asanaId: 'navasana' }, { asanaId: 'b', side: 'R' }, { asanaId: 'b', side: 'L', reps: 3 }]);
    expect(SEED_ADDED[2]).toEqual([DOWNWARD_DOG_ID]);
    expect(SEED_ASANAS.some((a) => a.id === DOWNWARD_DOG_ID && a.group === 'Surya Namaskara')).toBe(true);
  });

  it('rejects unknown references', () => {
    expect(() => primarySeriesTemplate([{ id: 'urdhva-dhanurasana', name: 'UD', sided: false }])).toThrow(/unknown asana/);
  });
});
