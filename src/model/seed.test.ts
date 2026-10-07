import { describe, expect, it } from 'vitest';
import { asanaId, PRIMARY_SERIES_ID, primarySeriesTemplate, SEED_ASANAS } from './seed';

describe('catalog seed', () => {
  it('has unique ids and the expected sided asanas', () => {
    const ids = SEED_ASANAS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(SEED_ASANAS.length).toBe(62);
    const sided = SEED_ASANAS.filter((a) => a.sided).map((a) => a.name);
    expect(sided).toContain('Utthita Trikonasana');
    expect(sided).toContain('Marichyasana D');
    expect(sided).toContain('Supta Padangusthasana');
    expect(sided).not.toContain('Paschimottanasana A');
    expect(sided.length).toBe(21);
    expect(SEED_ASANAS.every((a) => a.group && a.posture)).toBe(true);
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
    expect(label(0)).toBe('padangusthasana');
    expect(label(2)).toBe('utthita-trikonasana R');
    expect(label(3)).toBe('utthita-trikonasana L');
    expect(t.entries.length).toBe(62 + 21 + 1);
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

  it('rejects unknown references', () => {
    expect(() => primarySeriesTemplate([{ id: 'urdhva-dhanurasana', name: 'UD', sided: false }])).toThrow(/unknown asana/);
  });
});
