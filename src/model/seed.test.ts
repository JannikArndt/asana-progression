import { describe, expect, it } from 'vitest';
import { asanaId, DOWNWARD_DOG_ID, PRIMARY_SERIES_ID, primarySeriesTemplate, SEED_ADDED, SEED_ASANAS, withReps, withSunSalutations } from './seed';

describe('catalog seed', () => {
  it('has unique ids and the expected sided asanas', () => {
    const ids = SEED_ASANAS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(SEED_ASANAS.length).toBe(63);
    const sided = SEED_ASANAS.filter((a) => a.sided).map((a) => a.name);
    expect(sided).toContain('Utthita Trikonasana');
    expect(sided).toContain('Marichyasana D');
    expect(sided).toContain('Supta Padangusthasana');
    expect(sided).not.toContain('Paschimottanasana A');
    expect(sided.length).toBe(21);
    expect(SEED_ASANAS.every((a) => a.group && (a.posture || a.id === 'adho-mukha-svanasana'))).toBe(true);
  });

  it('derives ids from names', () => {
    expect(asanaId('Janu Sirsasana A')).toBe('janu-sirsasana-a');
    expect(asanaId('  Śavāsana ')).toBe('savasana');
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
    expect(t.entries.length).toBe(63 + 21 + 1);
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
