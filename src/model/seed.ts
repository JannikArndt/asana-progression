import type { Asana, PostureClass, SequenceTemplate, Side } from './types';

/**
 * Asana catalog seed (editable data). Lettered variants are separate asanas. Display names in
 * simplified Sanskrit without diacritics. `sided` = performed right and left.
 */
interface SeedRow {
  name: string;
  sided?: boolean;
  posture: PostureClass;
}

const GROUPS: Array<{ group: string; rows: SeedRow[] }> = [
  {
    group: 'Standing',
    rows: [
      { name: 'Padangusthasana', posture: 'standing' },
      { name: 'Padahastasana', posture: 'standing' },
      { name: 'Utthita Trikonasana', sided: true, posture: 'standing' },
      { name: 'Parivrtta Trikonasana', sided: true, posture: 'standing' },
      { name: 'Utthita Parsvakonasana', sided: true, posture: 'standing' },
      { name: 'Parivrtta Parsvakonasana', sided: true, posture: 'standing' },
      { name: 'Prasarita Padottanasana A', posture: 'standing' },
      { name: 'Prasarita Padottanasana B', posture: 'standing' },
      { name: 'Prasarita Padottanasana C', posture: 'standing' },
      { name: 'Prasarita Padottanasana D', posture: 'standing' },
      { name: 'Parsvottanasana', sided: true, posture: 'standing' },
      { name: 'Utthita Hasta Padangusthasana A', sided: true, posture: 'standing' },
      { name: 'Utthita Hasta Padangusthasana B', sided: true, posture: 'standing' },
      { name: 'Utthita Hasta Padangusthasana C', sided: true, posture: 'standing' },
      { name: 'Ardha Baddha Padmottanasana', sided: true, posture: 'standing' },
      { name: 'Utkatasana', posture: 'standing' },
      { name: 'Virabhadrasana A', sided: true, posture: 'standing' },
      { name: 'Virabhadrasana B', sided: true, posture: 'standing' },
    ],
  },
  {
    group: 'Seated',
    rows: [
      { name: 'Dandasana', posture: 'seated' },
      { name: 'Paschimottanasana A', posture: 'seated' },
      { name: 'Paschimottanasana B', posture: 'seated' },
      { name: 'Paschimottanasana C', posture: 'seated' },
      { name: 'Purvottanasana', posture: 'lying' },
      { name: 'Ardha Baddha Padma Paschimottanasana', sided: true, posture: 'seated' },
      { name: 'Tiryang Mukha Eka Pada Paschimottanasana', sided: true, posture: 'seated' },
      { name: 'Janu Sirsasana A', sided: true, posture: 'seated' },
      { name: 'Janu Sirsasana B', sided: true, posture: 'seated' },
      { name: 'Janu Sirsasana C', sided: true, posture: 'seated' },
      { name: 'Marichyasana A', sided: true, posture: 'seated' },
      { name: 'Marichyasana B', sided: true, posture: 'seated' },
      { name: 'Marichyasana C', sided: true, posture: 'seated' },
      { name: 'Marichyasana D', sided: true, posture: 'seated' },
      { name: 'Navasana', posture: 'seated' },
      { name: 'Bhujapidasana', posture: 'arm-balance' },
      { name: 'Kurmasana', posture: 'seated' },
      { name: 'Supta Kurmasana', posture: 'seated' },
      { name: 'Garbha Pindasana', posture: 'seated' },
      { name: 'Kukkutasana', posture: 'arm-balance' },
      { name: 'Baddha Konasana A', posture: 'seated' },
      { name: 'Baddha Konasana B', posture: 'seated' },
      { name: 'Upavistha Konasana A', posture: 'seated' },
      { name: 'Upavistha Konasana B', posture: 'seated' },
      { name: 'Supta Konasana', posture: 'inverted' },
      { name: 'Supta Padangusthasana', sided: true, posture: 'lying' },
      { name: 'Ubhaya Padangusthasana', posture: 'seated' },
      { name: 'Urdhva Mukha Paschimottanasana', posture: 'seated' },
      { name: 'Setu Bandhasana', posture: 'lying' },
    ],
  },
  {
    group: 'Backbending',
    rows: [{ name: 'Urdhva Dhanurasana', posture: 'lying' }],
  },
  {
    group: 'Finishing',
    rows: [
      { name: 'Salamba Sarvangasana', posture: 'inverted' },
      { name: 'Halasana', posture: 'inverted' },
      { name: 'Karnapidasana', posture: 'inverted' },
      { name: 'Urdhva Padmasana', posture: 'inverted' },
      { name: 'Pindasana', posture: 'inverted' },
      { name: 'Matsyasana', posture: 'lying' },
      { name: 'Uttana Padasana', posture: 'lying' },
      { name: 'Sirsasana A', posture: 'inverted' },
      { name: 'Sirsasana B', posture: 'inverted' },
      { name: 'Balasana', posture: 'seated' },
      { name: 'Yoga Mudra', posture: 'seated' },
      { name: 'Padmasana', posture: 'seated' },
      { name: 'Utpluthih', posture: 'arm-balance' },
      { name: 'Savasana', posture: 'lying' },
    ],
  },
];

/** Stable id from a display name: "Janu Sirsasana A" → "janu-sirsasana-a". */
export function asanaId(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export const SEED_ASANAS: readonly Asana[] = GROUPS.flatMap(({ group, rows }) =>
  rows.map((r) => ({ id: asanaId(r.name), name: r.name, sided: r.sided === true, group, posture: r.posture })),
);

export const PRIMARY_SERIES_ID = 'primary-series';

/**
 * Default "Primary series" template: catalog order, sided asanas right then left. Exceptions to
 * plain catalog order: Utthita Hasta Padangusthasana runs A/B/C right, then A/B/C left, and
 * Paschimottanasana (A) appears again after Urdhva Dhanurasana as the closing forward bend.
 */
export function primarySeriesTemplate(asanas: readonly Asana[] = SEED_ASANAS): SequenceTemplate {
  const entries: Array<{ asanaId: string; side?: Side }> = [];
  const byId = new Map(asanas.map((a) => [a.id, a]));
  const add = (id: string) => {
    const a = byId.get(id);
    if (!a) throw new Error(`Template references unknown asana ${id}`);
    if (a.sided) entries.push({ asanaId: id, side: 'R' }, { asanaId: id, side: 'L' });
    else entries.push({ asanaId: id });
  };
  const uhp = ['a', 'b', 'c'].map((v) => `utthita-hasta-padangusthasana-${v}`);
  for (const a of asanas) {
    if (uhp.includes(a.id)) {
      if (a.id === uhp[0]) {
        for (const side of ['R', 'L'] as const) for (const id of uhp) entries.push({ asanaId: id, side });
      }
      continue;
    }
    add(a.id);
    if (a.id === 'urdhva-dhanurasana') add('paschimottanasana-a');
  }
  return { id: PRIMARY_SERIES_ID, name: 'Primary series', entries };
}
