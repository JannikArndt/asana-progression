import { describe, expect, it } from 'vitest';
import { asanaId, DOWNWARD_DOG_ID, PRIMARY_SERIES_ID, primarySeriesTemplate, SEED_ADDED, SEED_ASANAS, SUN_SALUTATIONS, withSunSalutations } from './seed';

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
    expect(label(8)).toBe('padangusthasana');
    expect(label(10)).toBe('utthita-trikonasana R');
    expect(label(11)).toBe('utthita-trikonasana L');
    expect(t.entries.length).toBe(SUN_SALUTATIONS + 62 + 21 + 1);
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

  it('starts with a downward dog per sun salutation (5 A, 3 B)', () => {
    expect(t.entries.slice(0, SUN_SALUTATIONS).every((e) => e.asanaId === DOWNWARD_DOG_ID && !e.side)).toBe(true);
    expect(SUN_SALUTATIONS).toBe(8);
  });

  it('upgrades an existing template once', () => {
    const old = { ...t, entries: t.entries.slice(SUN_SALUTATIONS, SUN_SALUTATIONS + 3) };
    const up = withSunSalutations(old);
    expect(up.entries.length).toBe(SUN_SALUTATIONS + 3);
    expect(up.entries[SUN_SALUTATIONS]).toEqual(old.entries[0]);
    expect(withSunSalutations(up)).toBe(up);
    expect(SEED_ADDED[2]).toEqual([DOWNWARD_DOG_ID]);
    expect(SEED_ASANAS.some((a) => a.id === DOWNWARD_DOG_ID && a.group === 'Surya Namaskara')).toBe(true);
  });

  it('rejects unknown references', () => {
    expect(() => primarySeriesTemplate([{ id: 'urdhva-dhanurasana', name: 'UD', sided: false }])).toThrow(/unknown asana/);
  });
});
