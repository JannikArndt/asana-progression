import type { Asana, PostureClass, SequenceTemplate, Side, TemplateEntry } from './types';

/**
 * Asana catalog seed (editable data). Lettered variants are separate asanas. Display names in
 * simplified Sanskrit without diacritics. `sided` = performed right and left.
 */
interface SeedRow {
  name: string;
  /** Explicit id when the name changed after holds referenced the slug of an older name. */
  id?: string;
  sided?: boolean;
  posture?: PostureClass;
}

const GROUPS: Array<{ group: string; rows: SeedRow[] }> = [
  {
    // The 5-breath hold of every sun salutation; no posture class (none of the coarse classes fits).
    group: 'Surya Namaskara',
    rows: [{ name: 'Adho Mukha Svanasana' }],
  },
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
      // Leg up (A) and leg to the side (B); A keeps the id from when it was one asana (v1–3).
      { name: 'Supta Padangusthasana A', id: 'supta-padangusthasana', sided: true, posture: 'lying' },
      { name: 'Supta Padangusthasana B', sided: true, posture: 'lying' },
      { name: 'Ubhaya Padangusthasana', posture: 'seated' },
      { name: 'Urdhva Mukha Paschimottanasana', posture: 'seated' },
      { name: 'Setu Bandhasana', posture: 'lying' },
    ],
  },
  {
    // Second series (Nadi Shodhana): practised after the standing sequence instead of the seated
    // one. Posture classes only where the coarse classifier is expected to agree; kneeling,
    // squatting and leg-behind-head shapes have none (no class contradicts them in suggestions).
    group: 'Intermediate',
    rows: [
      { name: 'Pasasana', sided: true },
      { name: 'Krounchasana', sided: true, posture: 'seated' },
      { name: 'Salabhasana A', posture: 'lying' },
      { name: 'Salabhasana B', posture: 'lying' },
      { name: 'Bhekasana', posture: 'lying' },
      { name: 'Dhanurasana', posture: 'lying' },
      { name: 'Parsva Dhanurasana', sided: true, posture: 'lying' },
      { name: 'Ustrasana' },
      { name: 'Laghu Vajrasana' },
      { name: 'Kapotasana A' },
      { name: 'Kapotasana B' },
      { name: 'Supta Vajrasana' },
      { name: 'Bakasana A', posture: 'arm-balance' },
      { name: 'Bakasana B', posture: 'arm-balance' },
      { name: 'Bharadvajasana', sided: true, posture: 'seated' },
      { name: 'Ardha Matsyendrasana', sided: true, posture: 'seated' },
      { name: 'Eka Pada Sirsasana A', sided: true, posture: 'seated' },
      { name: 'Eka Pada Sirsasana B', sided: true },
      { name: 'Dwi Pada Sirsasana A', posture: 'seated' },
      { name: 'Dwi Pada Sirsasana B', posture: 'arm-balance' },
      { name: 'Yoga Nidrasana' },
      { name: 'Tittibhasana A', posture: 'arm-balance' },
      { name: 'Tittibhasana B' },
      { name: 'Tittibhasana C' },
      { name: 'Pincha Mayurasana', posture: 'inverted' },
      { name: 'Karandavasana' },
      { name: 'Mayurasana' },
      { name: 'Nakrasana' },
      { name: 'Vatayanasana', sided: true },
      { name: 'Parighasana', sided: true },
      { name: 'Gomukhasana A', sided: true, posture: 'seated' },
      { name: 'Gomukhasana B', sided: true, posture: 'seated' },
      { name: 'Supta Urdhva Pada Vajrasana', sided: true },
      { name: 'Mukta Hasta Sirsasana A', posture: 'inverted' },
      { name: 'Mukta Hasta Sirsasana B', posture: 'inverted' },
      { name: 'Mukta Hasta Sirsasana C', posture: 'inverted' },
      { name: 'Baddha Hasta Sirsasana A', posture: 'inverted' },
      { name: 'Baddha Hasta Sirsasana B', posture: 'inverted' },
      { name: 'Baddha Hasta Sirsasana C', posture: 'inverted' },
      { name: 'Baddha Hasta Sirsasana D', posture: 'inverted' },
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
  rows.map((r) => ({ id: r.id ?? asanaId(r.name), name: r.name, sided: r.sided === true, group, ...(r.posture ? { posture: r.posture } : {}) })),
);

/** Catalog group of the second-series asanas (not part of the Primary series template). */
export const INTERMEDIATE_GROUP = 'Intermediate';

/** Downward dog: held for 5 breaths once per sun salutation. */
export const DOWNWARD_DOG_ID = 'adho-mukha-svanasana';
/** Usual repetitions in the Primary series (suggestions allow fewer or more). */
export const PRIMARY_REPS: Readonly<Record<string, number>> = {
  // Sun salutations: 5 × A, then 3 × B.
  [DOWNWARD_DOG_ID]: 8,
  navasana: 5,
  'urdhva-dhanurasana': 3,
};

/** Supta Padangusthasana A (leg up) keeps the id of the former single asana; B (leg to the side) is new in v4. */
export const SUPTA_PADANGUSTHASANA_ID = 'supta-padangusthasana';
export const SUPTA_PADANGUSTHASANA_B_ID = 'supta-padangusthasana-b';
/** Name of Supta Padangusthasana A before v4; a stored asana with exactly this name is renamed. */
export const SUPTA_PADANGUSTHASANA_OLD_NAME = 'Supta Padangusthasana';

/** Seed asanas added after the first catalog version, by version. Deleted asanas are not re-added. */
export const SEED_ADDED: Readonly<Record<number, readonly string[]>> = {
  2: [DOWNWARD_DOG_ID],
  4: [SUPTA_PADANGUSTHASANA_B_ID],
  5: SEED_ASANAS.filter((a) => a.group === INTERMEDIATE_GROUP).map((a) => a.id),
};

/** Catalog upgrade (v2) for an existing Primary series template: prepends the sun salutations once. */
export function withSunSalutations(t: SequenceTemplate): SequenceTemplate {
  if (t.entries.some((e) => e.asanaId === DOWNWARD_DOG_ID)) return t;
  return { ...t, entries: [{ asanaId: DOWNWARD_DOG_ID, reps: PRIMARY_REPS[DOWNWARD_DOG_ID] }, ...t.entries] };
}

/**
 * Catalog upgrade (v3): consecutive identical entries become one entry with `reps` (the 8 down dogs
 * of v2); in the Primary series, Navasana and Urdhva Dhanurasana get their usual reps unless set.
 */
export function withReps(t: SequenceTemplate): SequenceTemplate {
  const entries: TemplateEntry[] = [];
  for (const e of t.entries) {
    const last = entries[entries.length - 1];
    if (last && last.asanaId === e.asanaId && (last.side ?? null) === (e.side ?? null)) {
      last.reps = (last.reps ?? 1) + (e.reps ?? 1);
      continue;
    }
    entries.push({ ...e });
  }
  if (t.id === PRIMARY_SERIES_ID) {
    for (const e of entries) if (e.reps === undefined && PRIMARY_REPS[e.asanaId]) e.reps = PRIMARY_REPS[e.asanaId];
  }
  return { ...t, entries };
}

/**
 * Catalog upgrade (v4), for every template: Supta Padangusthasana R directly followed by L becomes
 * A R, B R, A L, B L (other fields of the entries are kept). Templates that already contain B, or
 * no such R/L pair, are returned unchanged.
 */
export function withSuptaPadangusthasanaB(t: SequenceTemplate): SequenceTemplate {
  if (t.entries.some((e) => e.asanaId === SUPTA_PADANGUSTHASANA_B_ID)) return t;
  const i = t.entries.findIndex(
    (e, k) => e.asanaId === SUPTA_PADANGUSTHASANA_ID && e.side === 'R' && t.entries[k + 1]?.asanaId === SUPTA_PADANGUSTHASANA_ID && t.entries[k + 1]?.side === 'L',
  );
  if (i < 0) return t;
  const [r, l] = [t.entries[i]!, t.entries[i + 1]!];
  const b = (side: Side): TemplateEntry => ({ asanaId: SUPTA_PADANGUSTHASANA_B_ID, side });
  return { ...t, entries: [...t.entries.slice(0, i), { ...r }, b('R'), { ...l }, b('L'), ...t.entries.slice(i + 2)] };
}

export const PRIMARY_SERIES_ID = 'primary-series';
export const INTERMEDIATE_SERIES_ID = 'intermediate-series';

/** Second-series seed asanas: never part of the Primary series template. */
const INTERMEDIATE_IDS = new Set(SEED_ADDED[5]);

/**
 * Default "Primary series" template: catalog order, sided asanas right then left. Exceptions to
 * plain catalog order: Utthita Hasta Padangusthasana runs A/B/C right, then A/B/C left (Supta
 * Padangusthasana likewise A/B right, then A/B left), and Paschimottanasana (A) appears again
 * after Urdhva Dhanurasana as the closing forward bend. Repeated holds are one entry with `reps`
 * (`PRIMARY_REPS`: sun-salutation down dogs, Navasana, Urdhva Dhanurasana).
 */
export function primarySeriesTemplate(asanas: readonly Asana[] = SEED_ASANAS): SequenceTemplate {
  const entries: TemplateEntry[] = [];
  const byId = new Map(asanas.map((a) => [a.id, a]));
  const add = (id: string) => {
    const a = byId.get(id);
    if (!a) throw new Error(`Template references unknown asana ${id}`);
    if (a.sided) entries.push({ asanaId: id, side: 'R' }, { asanaId: id, side: 'L' });
    else entries.push({ asanaId: id });
  };
  // Variants performed together on one side before switching sides.
  const runs = [['a', 'b', 'c'].map((v) => `utthita-hasta-padangusthasana-${v}`), [SUPTA_PADANGUSTHASANA_ID, SUPTA_PADANGUSTHASANA_B_ID]];
  for (const a of asanas) {
    if (INTERMEDIATE_IDS.has(a.id)) continue;
    const run = runs.find((r) => r.includes(a.id));
    if (run) {
      const present = run.filter((id) => byId.has(id));
      if (a.id === present[0]) for (const side of ['R', 'L'] as const) for (const id of present) entries.push({ asanaId: id, side });
      continue;
    }
    add(a.id);
    const reps = PRIMARY_REPS[a.id];
    if (reps) entries[entries.length - 1]!.reps = reps;
    if (a.id === 'urdhva-dhanurasana') add('paschimottanasana-a');
  }
  return { id: PRIMARY_SERIES_ID, name: 'Primary series', entries };
}

/**
 * Steps of the Intermediate series after the sun salutations: a string is one asana (sided ones R
 * then L), an array is a run of sided variants performed on the right, then on the left. Order
 * after the practice sheets of ashtangayoga.info (R. Steiner, 2015) and Ryan Spielman's
 * Intermediate series chart: standing sequence up to Parsvottanasana, the second series, then the
 * closing sequence of the Primary series from Urdhva Dhanurasana.
 */
const INTERMEDIATE_STEPS: ReadonlyArray<string | readonly string[]> = [
  'padangusthasana',
  'padahastasana',
  'utthita-trikonasana',
  'parivrtta-trikonasana',
  'utthita-parsvakonasana',
  'parivrtta-parsvakonasana',
  ...['a', 'b', 'c', 'd'].map((v) => `prasarita-padottanasana-${v}`),
  'parsvottanasana',
  'pasasana',
  'krounchasana',
  'salabhasana-a',
  'salabhasana-b',
  'bhekasana',
  'dhanurasana',
  'parsva-dhanurasana',
  'ustrasana',
  'laghu-vajrasana',
  'kapotasana-a',
  'kapotasana-b',
  'supta-vajrasana',
  'bakasana-a',
  'bakasana-b',
  'bharadvajasana',
  'ardha-matsyendrasana',
  ['eka-pada-sirsasana-a', 'eka-pada-sirsasana-b'],
  'dwi-pada-sirsasana-a',
  'dwi-pada-sirsasana-b',
  'yoga-nidrasana',
  ...['a', 'b', 'c'].map((v) => `tittibhasana-${v}`),
  'pincha-mayurasana',
  'karandavasana',
  'mayurasana',
  'nakrasana',
  'vatayanasana',
  'parighasana',
  ['gomukhasana-a', 'gomukhasana-b'],
  'supta-urdhva-pada-vajrasana',
  ...['a', 'b', 'c'].map((v) => `mukta-hasta-sirsasana-${v}`),
  ...['a', 'b', 'c', 'd'].map((v) => `baddha-hasta-sirsasana-${v}`),
];

/**
 * Default "Intermediate series" template over a catalog: sun salutations, standing sequence, the
 * second series, then Urdhva Dhanurasana (×3), Paschimottanasana and the finishing sequence, as in
 * the Primary series. A seed asana missing from `asanas` is looked up by name (a user-created
 * asana of the same name, e.g. "Pasasana" added by hand before v5) and skipped when absent.
 */
export function intermediateSeriesTemplate(asanas: readonly Asana[] = SEED_ASANAS): SequenceTemplate {
  const byId = new Map(asanas.map((a) => [a.id, a]));
  const byName = new Map(asanas.map((a) => [asanaId(a.name), a]));
  const seedName = new Map(SEED_ASANAS.map((a) => [a.id, a.name]));
  const resolve = (id: string) => byId.get(id) ?? byName.get(asanaId(seedName.get(id) ?? id));
  const entries: TemplateEntry[] = [];
  const add = (id: string, reps?: number) => {
    const a = resolve(id);
    if (!a) return;
    const extra = reps ? { reps } : {};
    if (a.sided) entries.push({ asanaId: a.id, side: 'R', ...extra }, { asanaId: a.id, side: 'L', ...extra });
    else entries.push({ asanaId: a.id, ...extra });
  };
  add(DOWNWARD_DOG_ID, PRIMARY_REPS[DOWNWARD_DOG_ID]);
  for (const step of INTERMEDIATE_STEPS) {
    if (typeof step === 'string') {
      add(step);
      continue;
    }
    const run = step.map(resolve).filter((a): a is Asana => !!a);
    for (const side of ['R', 'L'] as const) for (const a of run) if (a.sided) entries.push({ asanaId: a.id, side });
  }
  add('urdhva-dhanurasana', PRIMARY_REPS['urdhva-dhanurasana']);
  add('paschimottanasana-a');
  for (const a of SEED_ASANAS.filter((x) => x.group === 'Finishing')) add(a.id);
  return { id: INTERMEDIATE_SERIES_ID, name: 'Intermediate series', entries };
}
