/**
 * C1: the app's naming (labeling.planSession: alignment + pose) on every fully labeled session of
 * the research export, zero corrections, leave one session out and "earlier sessions only".
 */
import { encodePose, type Asana, type CompactPose } from '../src/model';
import type { ResearchExport } from '../src/ui/research/export';
import { planSession, type ReviewItem } from '../src/labeling';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export default async function main(args: string[]) {
  const cov = Number(args.find((a) => a.startsWith('--cov='))?.slice(6) ?? 0.25);
  const novelty = Number(args.find((a) => a.startsWith('--nov='))?.slice(6) ?? 0.75);
  const skipMax = Number(args.find((a) => a.startsWith('--sm='))?.slice(5) ?? 5);
  const weight = Number(args.find((a) => a.startsWith('--w='))?.slice(4) ?? 2);
  const x = JSON.parse(readFileSync(join(import.meta.dirname, 'data', 'research.json'), 'utf8')) as ResearchExport;
  const catalog: Asana[] = x.catalog.map((a) => ({ id: a.id, name: a.name, sided: a.sided }));
  const nameOf = new Map(catalog.map((a) => [a.id, a.name]));
  const poseOf = (h: ResearchExport['holds'][number]): CompactPose | null =>
    h.pose?.world ? encodePose(h.pose.world.map(([px, py, pz, v]) => ({ x: px, y: py, z: pz ?? 0, visibility: v ?? 1 })), h.pose.posture) : null;
  const sessions = [...x.sessions].sort((a, b) => a.date.localeCompare(b.date)).map((s) => ({ ...s, holds: s.videoIds.flatMap((v) => x.holds.filter((h) => h.videoId === v).sort((a, b) => a.startS - b.startS)) }));
  for (const mode of ['others', 'earlier']) {
    console.log(`\n### history: ${mode}\n\n| S | date | template | holds | zero-touch | top1 | top3 | confirmAll |`);
    let R = 0, N = 0;
    sessions.forEach((s, si) => {
      const pool = mode === 'others' ? sessions.filter((o) => o.id !== s.id) : sessions.slice(0, si);
      const history = pool.flatMap((o) => o.holds.map((h, order) => ({ asanaId: h.asanaId, side: h.side, date: o.date, sessionId: o.id, order, pose: poseOf(h) })));
      const items: ReviewItem[] = s.holds.map((h) => ({ key: h.id, status: 'open', pose: poseOf(h), videoId: h.videoId }));
      const t = x.templates.find((t) => t.id === s.templateId) ?? null;
      const plan = planSession(items, catalog, t, history, { now: s.date + 'T12:00:00Z', alignment: { minCoverage: cov, weight, novelty, costs: { skipMax } } });
      const ok = (h: (typeof s.holds)[number], l: { asanaId: string; side: string | null } | undefined) => l?.asanaId === h.asanaId && (l.side ?? null) === h.side;
      const ca = plan.confirmAll ? new Map(plan.confirmAll.map((c) => [c.key, c.label])) : null;
      let zero = 0, t1 = 0, t3 = 0;
      const wrong: string[] = [];
      for (const h of s.holds) {
        const sg = plan.suggestions[h.id] ?? [];
        const z = ca ? ca.get(h.id) : sg[0];
        if (ok(h, z)) zero++; else wrong.push(`${nameOf.get(h.asanaId)} ${h.side ?? ''} → ${z ? nameOf.get(z.asanaId) + ' ' + (z.side ?? '') : '—'}`);
        if (ok(h, sg[0])) t1++;
        if (sg.some((g) => ok(h, g))) t3++;
      }
      R += zero; N += s.holds.length;
      const p = (k: number) => `${Math.round((100 * k) / s.holds.length)} %`;
      console.log(`| S${si + 1} | ${s.date} | ${t?.name ?? '—'} | ${s.holds.length} | ${p(zero)} | ${p(t1)} | ${p(t3)} | ${ca ? 'yes' : 'no'} |`);
      if (args.includes('--list')) for (const w of wrong) console.log(`|  |  | ${w} |`);
    });
    console.log(`| All | | | ${N} | ${Math.round((100 * R) / N)} % |`);
  }
  if (!args.includes('--replay')) return;
  console.log('\n### top to bottom, correcting as you go (others as history)\n\n| S | top1 | top3 |');
  let A = 0, B = 0, N = 0;
  sessions.forEach((s, si) => {
    const history = sessions.filter((o) => o.id !== s.id).flatMap((o) => o.holds.map((h, order) => ({ asanaId: h.asanaId, side: h.side, date: o.date, sessionId: o.id, order, pose: poseOf(h) })));
    const t = x.templates.find((t) => t.id === s.templateId) ?? null;
    let a = 0, b = 0;
    s.holds.forEach((h, i) => {
      const items: ReviewItem[] = s.holds.map((o, k) =>
        k < i
          ? { key: o.id, status: 'labeled', label: { asanaId: o.asanaId, side: o.side, templateEntryIndex: o.templateEntryIndex ?? undefined }, pose: poseOf(o), videoId: o.videoId }
          : { key: o.id, status: 'open', pose: poseOf(o), videoId: o.videoId },
      );
      const sg = planSession(items, catalog, t, history, { now: s.date + 'T12:00:00Z', alignment: { minCoverage: cov, weight, novelty, costs: { skipMax } } }).suggestions[h.id] ?? [];
      const ok = (l: { asanaId: string; side: string | null } | undefined) => l?.asanaId === h.asanaId && (l.side ?? null) === h.side;
      if (ok(sg[0])) a++;
      if (sg.some(ok)) b++;
    });
    A += a; B += b; N += s.holds.length;
    console.log(`| S${si + 1} | ${Math.round((100 * a) / s.holds.length)} % | ${Math.round((100 * b) / s.holds.length)} % |`);
  });
  console.log(`| All | ${Math.round((100 * A) / N)} % | ${Math.round((100 * B) / N)} % |`);
}
