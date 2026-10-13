import { describe, expect, it } from 'vitest';
import { decodePose, encodePose, poseKey, POSE_JOINTS } from './pose';

const world = Array.from({ length: 33 }, (_, i) => ({ x: i / 10 - 1.5, y: -i / 20, z: (i % 3) * 0.1, visibility: (i % 5) / 4 }));

describe('compact poses', () => {
  it('keeps the 15 body joints with half precision and visibility in 1/255', () => {
    const c = encodePose(world, 'seated')!;
    expect(c).toMatchObject({ v: 1, posture: 'seated' });
    expect(c.world.length + c.vis.length).toBeLessThan(150);
    const joints = decodePose(c)!;
    expect(joints.length).toBe(POSE_JOINTS.length);
    POSE_JOINTS.forEach((i, k) => {
      const w = world[i]!;
      expect(joints[k]!.x).toBeCloseTo(w.x, 2);
      expect(joints[k]!.y).toBeCloseTo(w.y, 2);
      expect(joints[k]!.z).toBeCloseTo(w.z, 2);
      expect(Math.abs(joints[k]!.visibility - w.visibility)).toBeLessThanOrEqual(1 / 255);
    });
    // Survives JSON (IndexedDB, backups).
    expect(decodePose(JSON.parse(JSON.stringify(c)))).toEqual(joints);
  });

  it('defaults a missing z and visibility, rejects incomplete or damaged poses', () => {
    const plain = encodePose(world.map(({ x, y }) => ({ x, y })), null)!;
    expect(decodePose(plain)![0]).toMatchObject({ z: 0, visibility: 1 });
    expect(encodePose(world.slice(0, 20), null)).toBeNull();
    expect(encodePose(undefined, null)).toBeNull();
    expect(encodePose(world.map((w, i) => (i === 11 ? { ...w, x: NaN } : w)), null)).toBeNull();
    expect(decodePose(null)).toBeNull();
    expect(decodePose({ ...plain, v: 2 as 1 })).toBeNull();
    expect(decodePose({ ...plain, vis: 'AAAA' })).toBeNull();
    expect(decodePose({ ...plain, world: '%%%' })).toBeNull();
  });

  it('keys a frame by its sample index', () => {
    expect(poseKey(12.25, 4)).toBe('49');
    expect(poseKey(12.3, 4)).toBe('49');
  });
});
