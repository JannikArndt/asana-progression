/** Compact poses (`CompactPose`): 15 body joints of a MediaPipe pose in about 150 bytes. */
import { decodeFloat16, encodeFloat16 } from './float16';
import type { CompactPose, PostureClass } from './types';

/** BlazePose indices kept: nose, shoulders, elbows, wrists, hips, knees, ankles, foot tips. */
export const POSE_JOINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 31, 32] as const;

export interface PoseJoint {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

/** Compacts 33 world landmarks; null when the pose is incomplete. */
export function encodePose(world: ArrayLike<{ x: number; y: number; z?: number; visibility?: number }> | undefined, posture: PostureClass | null): CompactPose | null {
  if (!world || world.length < 33) return null;
  const xyz: number[] = [];
  const vis = new Uint8Array(POSE_JOINTS.length);
  POSE_JOINTS.forEach((i, k) => {
    const l = world[i]!;
    xyz.push(l.x, l.y, l.z ?? 0);
    vis[k] = Math.round(Math.min(1, Math.max(0, l.visibility ?? 1)) * 255);
  });
  if (xyz.some((v) => !Number.isFinite(v))) return null;
  return { v: 1, world: encodeFloat16(xyz), vis: toBase64(vis), posture };
}

/** The joints of `POSE_JOINTS` in order; null for an unknown version or damaged data. */
export function decodePose(p: CompactPose | null | undefined): PoseJoint[] | null {
  if (!p || p.v !== 1) return null;
  try {
    const xyz = decodeFloat16(p.world);
    const vis = fromBase64(p.vis);
    if (xyz.length !== POSE_JOINTS.length * 3 || vis.length !== POSE_JOINTS.length) return null;
    return POSE_JOINTS.map((_, k) => ({ x: xyz[3 * k]!, y: xyz[3 * k + 1]!, z: xyz[3 * k + 2]!, visibility: vis[k]! / 255 }));
  } catch {
    return null;
  }
}

/** Key of a frame in `Analysis.poses`: its sample index. */
export function poseKey(atS: number, sampleHz: number): string {
  return String(Math.round(atS * sampleHz));
}
