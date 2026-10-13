/**
 * Asana classes from body poses (research/REPORT.md, B2): world joints hip-centred, scaled by the
 * torso length and rotated about the vertical axis to a canonical facing, plus joint angles; a
 * pose's distance to a class (asana + side) is its distance to the nearest labeled example. Sided
 * examples also count, mirrored, for the other side.
 */
import { decodePose, type CompactPose, type PoseJoint, type Side } from '../model';

type V3 = [number, number, number];

/** Positions in `POSE_JOINTS` order. */
const J = { nose: 0, ls: 1, rs: 2, le: 3, re: 4, lw: 5, rw: 6, lh: 7, rh: 8, lk: 9, rk: 10, la: 11, ra: 12, lf: 13, rf: 14 } as const;
/** Left/right partner of each joint position. */
const PARTNER = [0, 2, 1, 4, 3, 6, 5, 8, 7, 10, 9, 12, 11, 14, 13] as const;

export interface PoseFeatures {
  /** Normalized joint positions (torso lengths). */
  points: V3[];
  /** Elbows, shoulders, hips, knees (left, right each) and the torso's angle from vertical, degrees. */
  angles: number[];
}

function angle(a: V3, b: V3, c: V3): number {
  const u = [a[0] - b[0], a[1] - b[1], a[2] - b[2]] as const;
  const v = [c[0] - b[0], c[1] - b[1], c[2] - b[2]] as const;
  const nu = Math.hypot(...u);
  const nv = Math.hypot(...v);
  if (!nu || !nv) return 0;
  const cos = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (nu * nv);
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

const mid = (a: V3, b: V3): V3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];

/** Features of decoded joints; `mirror` swaps left and right (the same pose on the other side). */
export function poseFeatures(joints: PoseJoint[], mirror = false): PoseFeatures {
  let p: V3[] = joints.map((j) => [j.x, j.y, j.z]);
  if (mirror) p = p.map((_, i) => [-p[PARTNER[i]!]![0], p[PARTNER[i]!]![1], p[PARTNER[i]!]![2]]);
  const at = (i: number) => p[i]!;
  const hip = mid(at(J.lh), at(J.rh));
  const sh = mid(at(J.ls), at(J.rs));
  const torso = Math.hypot(sh[0] - hip[0], sh[1] - hip[1], sh[2] - hip[2]) || 1;
  // Left-right axis of shoulders and hips on the horizontal x-z plane (y points down).
  const lx = at(J.ls)[0] - at(J.rs)[0] + at(J.lh)[0] - at(J.rh)[0];
  const lz = at(J.ls)[2] - at(J.rs)[2] + at(J.lh)[2] - at(J.rh)[2];
  const n = Math.hypot(lx, lz);
  const cos = n > 1e-6 ? lx / n : 1;
  const sin = n > 1e-6 ? lz / n : 0;
  const points = p.map((q): V3 => {
    const x = (q[0] - hip[0]) / torso;
    const y = (q[1] - hip[1]) / torso;
    const z = (q[2] - hip[2]) / torso;
    return [x * cos + z * sin, y, -x * sin + z * cos];
  });
  const angles = [
    angle(at(J.ls), at(J.le), at(J.lw)),
    angle(at(J.rs), at(J.re), at(J.rw)),
    angle(at(J.le), at(J.ls), at(J.lh)),
    angle(at(J.re), at(J.rs), at(J.rh)),
    angle(at(J.ls), at(J.lh), at(J.lk)),
    angle(at(J.rs), at(J.rh), at(J.rk)),
    angle(at(J.lh), at(J.lk), at(J.la)),
    angle(at(J.rh), at(J.rk), at(J.ra)),
    angle(sh, hip, [hip[0], hip[1] - 1, hip[2]]),
  ];
  return { points, angles };
}

/** Mean joint distance (torso lengths) + `angleWeight` × mean angle difference / 90°. */
export function poseDistance(a: PoseFeatures, b: PoseFeatures, angleWeight = POSE_CLASSES.angleWeight): number {
  let d = 0;
  for (let i = 0; i < a.points.length; i++) {
    const p = a.points[i]!;
    const q = b.points[i]!;
    d += Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  }
  let g = 0;
  for (let i = 0; i < a.angles.length; i++) g += Math.abs(a.angles[i]! - b.angles[i]!);
  return d / a.points.length + (angleWeight * g) / a.angles.length / 90;
}

export const POSE_CLASSES = {
  /** Weight of the joint angles in `poseDistance` (best in the research: 0.5). */
  angleWeight: 0.5,
} as const;

/** An asana + side class key. */
export function classKey(asanaId: string, side: Side | null): string {
  return `${asanaId}|${side ?? ''}`;
}

export interface PoseExample {
  asanaId: string;
  side: Side | null;
  pose: CompactPose | null | undefined;
}

/** Nearest-example classifier over labeled poses. */
export class PoseClassifier {
  private readonly examples: Array<{ key: string; f: PoseFeatures }> = [];

  constructor(examples: Iterable<PoseExample>) {
    for (const e of examples) {
      const joints = decodePose(e.pose);
      if (!joints) continue;
      this.examples.push({ key: classKey(e.asanaId, e.side), f: poseFeatures(joints) });
      if (e.side) this.examples.push({ key: classKey(e.asanaId, e.side === 'R' ? 'L' : 'R'), f: poseFeatures(joints, true) });
    }
  }

  /** Classes with at least one example. */
  get classes(): Set<string> {
    return new Set(this.examples.map((e) => e.key));
  }

  get size(): number {
    return this.examples.length;
  }

  /** Distance of `pose` to every known class (its nearest example); null without a usable pose. */
  distances(pose: CompactPose | null | undefined): Map<string, number> | null {
    const joints = decodePose(pose);
    if (!joints || !this.examples.length) return null;
    const f = poseFeatures(joints);
    const out = new Map<string, number>();
    for (const e of this.examples) {
      const d = poseDistance(f, e.f);
      if (!(d >= (out.get(e.key) ?? Infinity))) out.set(e.key, d);
    }
    return out;
  }
}
