/**
 * B3: automatic crop vs the user's manual crops. Boxes are recomputed from the exported landmarks
 * (the pose re-run on each stored still, the path a CROP_VERSION bump takes), so "today" means
 * BOX_DEFAULTS on those landmarks.
 * Usage: node research/run.mjs research/b3-crop.ts [--write-fixture]
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { boxFromLandmarks, type BoxGeometry, type Landmark } from '../src/crop';
import type { Box } from '../src/model';
import type { ResearchHold } from '../src/ui/research/export';
import { loadResearch, table, type Dataset } from './lib/data';

/** The box geometry before this fit (CROP_VERSION 2): "today" in every comparison. */
export const V2_GEOMETRY: BoxGeometry = { pad: 0.15, padTop: 0, minPad: 0.02, headSpread: 1.6, headTorso: 0.35, handReach: 0.6, footReach: 0, minVisibility: 0.3 };

/** Containment tolerance: 2 % of the image height. */
const TOL = 0.02;
/** Allowed growth of the median auto area (per-hold ratio new / today). */
const MAX_AREA_RATIO = 1.2;

export interface CropCase {
  hold: ResearchHold;
  session: string;
  aspect: number;
  landmarks: Landmark[];
  manual: Box | null;
}

export function cropCases(d: Dataset): CropCase[] {
  const out: CropCase[] = [];
  for (const s of d.sessions)
    for (const h of s.holds) {
      if (!h.pose) continue;
      out.push({
        hold: h,
        session: s.label,
        aspect: h.pose.preview.width / h.pose.preview.height,
        landmarks: h.pose.landmarks.map(([x, y, z, v]) => ({ x, y, ...(z !== null ? { z } : {}), ...(v !== null ? { visibility: v } : {}) })),
        manual: h.crop.manual,
      });
    }
  return out;
}

/** The automatic box with the version-2 geometry changed by `geometry`. */
export function autoBox(c: CropCase, geometry: Partial<BoxGeometry> = {}): Box | null {
  return boxFromLandmarks(c.landmarks, { aspect: c.aspect, geometry: { ...V2_GEOMETRY, ...geometry } });
}

/** Sides on which `manual` reaches beyond `auto` by more than 2 % of the image height. */
export function outside(auto: Box, manual: Box, aspect: number): Array<'left' | 'right' | 'top' | 'bottom'> {
  const tx = TOL / aspect;
  const out: Array<'left' | 'right' | 'top' | 'bottom'> = [];
  if (auto.x - manual.x > tx) out.push('left');
  if (manual.x + manual.w - (auto.x + auto.w) > tx) out.push('right');
  if (auto.y - manual.y > TOL) out.push('top');
  if (manual.y + manual.h - (auto.y + auto.h) > TOL) out.push('bottom');
  return out;
}

const area = (b: Box) => b.w * b.h;
const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[s.length >> 1]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : NaN;
};
function iou(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const i = ix * iy;
  return i / (area(a) + area(b) - i);
}

const HEAD = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
const HANDS = new Set([15, 16, 17, 18, 19, 20, 21, 22]);
const FEET = new Set([27, 28, 29, 30, 31, 32]);

/** Why the manual crop reaches beyond the automatic one on `side`. */
function cause(c: CropCase, auto: Box, side: 'left' | 'right' | 'top' | 'bottom'): string {
  const m = c.manual!;
  if (iou(auto, m) < 0.3) return 'detection error (boxes barely overlap)';
  const beyond = (l: Landmark) =>
    side === 'left' ? l.x < auto.x : side === 'right' ? l.x > auto.x + auto.w : side === 'top' ? l.y < auto.y : l.y > auto.y + auto.h;
  const dropped = c.landmarks.filter((l, i) => i < 33 && beyond(l) && (l.visibility ?? 1) < V2_GEOMETRY.minVisibility);
  if (dropped.length) return 'low-visibility landmark dropped';
  // The landmark nearest to this edge: an extremity (head, hands, feet) → the body likely goes on.
  const used = c.landmarks.map((l, i) => ({ l, i })).filter(({ l }) => (l.visibility ?? 1) >= V2_GEOMETRY.minVisibility);
  const key = (l: Landmark) => (side === 'left' ? l.x : side === 'right' ? -l.x : side === 'top' ? l.y : -l.y);
  const outer = used.sort((a, b) => key(a.l) - key(b.l))[0];
  const ext = side === 'left' ? (auto.x - m.x) / auto.w : side === 'right' ? (m.x + m.w - auto.x - auto.w) / auto.w : side === 'top' ? (auto.y - m.y) / auto.h : (m.y + m.h - auto.y - auto.h) / auto.h;
  if (ext <= 0.1) return 'small (≤ 10 % of the box): taste / composition';
  if (outer && side === 'top' && HEAD.has(outer.i)) return 'extremity: crown above the face landmarks';
  if (outer && HANDS.has(outer.i)) return 'extremity: fingers beyond the hand landmarks';
  if (outer && FEET.has(outer.i)) return 'extremity: toes beyond the foot landmarks';
  return 'taste / composition (no body part at that edge)';
}

function analysisSection(d: Dataset, cases: CropCase[]) {
  const withManual = cases.filter((c) => c.manual);
  console.log(`### Manual crops vs the automatic crop today (${withManual.length} manual crops on holds with a pose, ${cases.length} holds with a pose)\n`);
  const sides = ['left', 'right', 'top', 'bottom'] as const;
  const ext: Record<string, number[]> = { left: [], right: [], top: [], bottom: [] };
  const causes = new Map<string, Map<string, number>>();
  let contained = 0;
  let lowVisOutside = 0;
  for (const c of withManual) {
    const a = autoBox(c)!;
    const m = c.manual!;
    ext.left!.push((a.x - m.x) / a.w);
    ext.right!.push((m.x + m.w - a.x - a.w) / a.w);
    ext.top!.push((a.y - m.y) / a.h);
    ext.bottom!.push((m.y + m.h - a.y - a.h) / a.h);
    const out = outside(a, m, c.aspect);
    if (!out.length) contained++;
    if (c.landmarks.some((l) => (l.visibility ?? 1) < V2_GEOMETRY.minVisibility && (l.x < a.x || l.x > a.x + a.w || l.y < a.y || l.y > a.y + a.h))) lowVisOutside++;
    for (const side of out) {
      const k = cause(c, a, side);
      const mm = causes.get(k) ?? new Map<string, number>();
      mm.set(side, (mm.get(side) ?? 0) + 1);
      causes.set(k, mm);
    }
  }
  console.log(`Contained in the automatic crop (2 % tolerance): ${contained} of ${withManual.length}. Holds with a low-visibility landmark outside the automatic crop: ${lowVisOutside}.\n`);
  const q = (v: number[], p: number) => [...v].sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor(p * v.length))]!;
  console.log(
    table(
      ['Side', 'Beyond auto (count)', 'Median', 'p75', 'Max'],
      sides.map((s) => [s, ext[s]!.filter((x) => x > 0.02).length, `${(100 * median(ext[s]!)).toFixed(0)} %`, `${(100 * q(ext[s]!, 0.75)).toFixed(0)} %`, `${(100 * Math.max(...ext[s]!)).toFixed(0)} %`]),
    ),
  );
  console.log('\nExtent beyond the automatic crop in units of its width (left/right) or height (top/bottom); negative = tighter.\n');
  console.log(table(['Cause', ...sides, 'All'], [...causes.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, m]) => [k, ...sides.map((s) => m.get(s) ?? 0), [...m.values()].reduce((x, y) => x + y, 0)])));
}

interface Fit {
  geometry: Partial<BoxGeometry>;
  notContained: number;
  areaRatio: number;
}

function evaluate(cases: CropCase[], g: Partial<BoxGeometry>): Fit {
  let notContained = 0;
  const ratios: number[] = [];
  for (const c of cases) {
    const today = autoBox(c);
    const next = autoBox(c, g);
    if (!today || !next) continue;
    ratios.push(area(next) / area(today));
    if (c.manual && outside(next, c.manual, c.aspect).length) notContained++;
  }
  return { geometry: g, notContained, areaRatio: median(ratios) };
}

export const GRID = {
  pad: [0.12, 0.15, 0.18, 0.21, 0.24],
  padTop: [0, 0.05, 0.1, 0.15, 0.2],
  handReach: [0.6, 1, 1.5],
  footReach: [0, 0.5, 1],
  minVisibility: [0.3, 0.15, 0],
  headSpread: [1.6, 2.2],
  headTorso: [0.35, 0.5],
};

function* geometries(): Generator<Partial<BoxGeometry>> {
  for (const pad of GRID.pad)
    for (const padTop of GRID.padTop)
      for (const handReach of GRID.handReach)
        for (const footReach of GRID.footReach)
          for (const minVisibility of GRID.minVisibility)
            for (const headSpread of GRID.headSpread) for (const headTorso of GRID.headTorso) yield { pad, padTop, handReach, footReach, minVisibility, headSpread, headTorso };
}

/** Fewest manual crops cut off with the median area ≤ MAX_AREA_RATIO × today's; ties: smaller area. */
export function fit(cases: CropCase[]): Fit {
  let best: Fit | null = null;
  for (const g of geometries()) {
    const f = evaluate(cases, g);
    if (f.areaRatio > MAX_AREA_RATIO) continue;
    if (!best || f.notContained < best.notContained || (f.notContained === best.notContained && f.areaRatio < best.areaRatio)) best = f;
  }
  return best!;
}

/** What BOX_DEFAULTS became (the fit on all sessions). */
const ADOPTED: Partial<BoxGeometry> = { pad: 0.18, padTop: 0.05, footReach: 0.5 };

const geoText = (g: Partial<BoxGeometry>) =>
  Object.entries(g)
    .filter(([k, v]) => V2_GEOMETRY[k as keyof BoxGeometry] !== v)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ') || 'today';

function fitSection(d: Dataset, cases: CropCase[]): Fit {
  console.log(`\n### Fit of the box geometry (${[...geometries()].length} sets; leave one session out)\n`);
  const rows: Array<Array<string | number>> = [];
  for (const s of d.sessions) {
    const train = cases.filter((c) => c.session !== s.label);
    const test = cases.filter((c) => c.session === s.label);
    const f = fit(train);
    const before = evaluate(test, {});
    const after = evaluate(test, f.geometry);
    const manual = test.filter((c) => c.manual).length;
    rows.push([s.label, geoText(f.geometry), `${manual - before.notContained} of ${manual}`, `${manual - after.notContained} of ${manual}`, after.areaRatio.toFixed(2)]);
  }
  console.log(table(['Held out', 'Fitted on the other two', 'Contained today', 'Contained with the fit', 'Median area ratio'], rows));
  const all = fit(cases);
  const manual = cases.filter((c) => c.manual).length;
  const today = evaluate(cases, {});
  console.log(`\nFitted on all sessions: ${geoText(all.geometry)} — contained ${manual - all.notContained} of ${manual} (today ${manual - today.notContained}), median area ratio ${all.areaRatio.toFixed(2)}.`);
  const adopted = evaluate(cases, ADOPTED);
  console.log(`Adopted (BOX_DEFAULTS, CROP_VERSION 3): ${geoText(ADOPTED)} — contained ${manual - adopted.notContained} of ${manual}, median area ratio ${adopted.areaRatio.toFixed(3)}.`);
  return all;
}

/** Numbers only (no images): landmarks, the user's crops and boxes, for src/crop/__fixtures__/crops.json. */
function writeFixture(cases: CropCase[], g: Partial<BoxGeometry>) {
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
  const box = (b: Box) => ({ x: r4(b.x), y: r4(b.y), w: r4(b.w), h: r4(b.h) });
  const fx = {
    about: 'Pose landmarks of stills of the user\'s labeled holds and the crops made by hand (research export, no images). Used by crop/fit.test.ts.',
    tolerance: TOL,
    maxAreaRatio: MAX_AREA_RATIO,
    previous: V2_GEOMETRY,
    geometry: { ...V2_GEOMETRY, ...g },
    cases: cases
      .filter((c) => c.manual)
      .map((c) => ({ session: c.session, asana: c.hold.asanaId, aspect: r4(c.aspect), manual: box(c.manual!), landmarks: c.landmarks.map((l) => [r4(l.x), r4(l.y), r4(l.visibility ?? 1)]) })),
    holds: cases.map((c) => ({ aspect: r4(c.aspect), landmarks: c.landmarks.map((l) => [r4(l.x), r4(l.y), r4(l.visibility ?? 1)]) })),
  };
  writeFileSync(join(import.meta.dirname, '..', 'src', 'crop', '__fixtures__', 'crops.json'), JSON.stringify(fx));
}

export default function main(args: string[]) {
  const d = loadResearch();
  const cases = cropCases(d);
  analysisSection(d, cases);
  const all = fitSection(d, cases);
  if (args.includes('--write-fixture')) writeFixture(cases, ADOPTED);
}
