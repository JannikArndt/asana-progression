/**
 * Pose features from MediaPipe world landmarks (metres, origin between the hips, camera-aligned
 * axes with y pointing down): hip-centred, scaled by the torso length, rotated about the vertical
 * axis so the body's left-right axis points along +x (canonical facing), plus joint angles.
 * `mirror` swaps left and right (the same pose on the other side).
 */
import type { LandmarkRow } from '../../src/ui/research/export';

type V3 = [number, number, number];

/** Body landmarks used (nose, shoulders, elbows, wrists, hips, knees, ankles, foot tips). */
export const JOINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 31, 32] as const;
/** BlazePose left/right partner of each landmark index (for mirroring). */
const PARTNER = (i: number): number => {
  if (i === 0) return 0;
  if (i >= 1 && i <= 10) return [0, 4, 5, 6, 1, 2, 3, 8, 7, 10, 9][i]!;
  return i % 2 === 1 ? i + 1 : i - 1;
};

/** Angle ABC in degrees. */
function angle(a: V3, b: V3, c: V3): number {
  const u = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const v = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
  const nu = Math.hypot(...u);
  const nv = Math.hypot(...v);
  if (!nu || !nv) return 0;
  const cos = (u[0]! * v[0]! + u[1]! * v[1]! + u[2]! * v[2]!) / (nu * nv);
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

const mid = (a: V3, b: V3): V3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export interface PoseFeatures {
  /** Normalized coordinates of JOINTS (torso lengths). */
  points: V3[];
  /** Elbows, shoulders, hips, knees (L, R each) and the torso's angle from vertical, degrees. */
  angles: number[];
}

export function poseFeatures(world: LandmarkRow[], mirror = false): PoseFeatures {
  let p: V3[] = world.map((r) => [r[0], r[1], r[2] ?? 0]);
  if (mirror) p = p.map((_, i) => {
    const q = p[PARTNER(i)]!;
    return [-q[0], q[1], q[2]];
  });
  const hip = mid(p[23]!, p[24]!);
  const sh = mid(p[11]!, p[12]!);
  const torso = Math.hypot(...sub(sh, hip)) || 1;
  // Left-right axis (shoulders and hips), projected on the horizontal x-z plane.
  const lr = [p[11]![0] - p[12]![0] + p[23]![0] - p[24]![0], p[11]![2] - p[12]![2] + p[23]![2] - p[24]![2]];
  const n = Math.hypot(lr[0]!, lr[1]!);
  const cos = n > 1e-6 ? lr[0]! / n : 1;
  const sin = n > 1e-6 ? lr[1]! / n : 0;
  const norm = (q: V3): V3 => {
    const x = (q[0] - hip[0]) / torso;
    const y = (q[1] - hip[1]) / torso;
    const z = (q[2] - hip[2]) / torso;
    return [x * cos + z * sin, y, -x * sin + z * cos];
  };
  const points = JOINTS.map((i) => norm(p[i]!));
  const angles = [
    angle(p[11]!, p[13]!, p[15]!),
    angle(p[12]!, p[14]!, p[16]!),
    angle(p[13]!, p[11]!, p[23]!),
    angle(p[14]!, p[12]!, p[24]!),
    angle(p[11]!, p[23]!, p[25]!),
    angle(p[12]!, p[24]!, p[26]!),
    angle(p[23]!, p[25]!, p[27]!),
    angle(p[24]!, p[26]!, p[28]!),
    angle(sh, hip, [hip[0], hip[1] - 1, hip[2]]),
  ];
  return { points, angles };
}

/** Distance: mean joint distance (torso lengths) + `angleWeight` × mean angle difference / 90°. */
export function poseDistance(a: PoseFeatures, b: PoseFeatures, angleWeight = 1): number {
  let d = 0;
  for (let i = 0; i < a.points.length; i++) d += Math.hypot(a.points[i]![0] - b.points[i]![0], a.points[i]![1] - b.points[i]![1], a.points[i]![2] - b.points[i]![2]);
  let g = 0;
  for (let i = 0; i < a.angles.length; i++) g += Math.abs(a.angles[i]! - b.angles[i]!);
  return d / a.points.length + (angleWeight * g) / a.angles.length / 90;
}
