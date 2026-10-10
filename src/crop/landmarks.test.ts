import { describe, expect, it } from 'vitest';
import { BLAZEPOSE, BLAZEPOSE_COUNT, BOX_DEFAULTS, POSTURE_THRESHOLDS, boxFromLandmarks, clampBox, postureFromLandmarks, unionBox } from './landmarks';
import type { Landmark } from './types';

type P = [number, number];
type Paired = 'shoulder' | 'elbow' | 'wrist' | 'hip' | 'knee' | 'ankle' | 'heel' | 'footIndex';
/** Joints in metres, x forward, y up, floor at 0. A pair is [left, right]; a single point is used for both sides. */
type Figure = { nose?: P } & Partial<Record<Paired, P | [P, P]>>;

const isPair = (v: P | [P, P]): v is [P, P] => Array.isArray(v[0]);
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

/** Stick figure → 33 BlazePose landmarks; joints not given are invisible. */
function landmarks(fig: Figure, { aspect = 1, visibility = 0.9 as number | undefined, hide = [] as Array<keyof typeof BLAZEPOSE> } = {}) {
  const scale = 0.4; // image heights per metre
  const out: Landmark[] = Array.from({ length: BLAZEPOSE_COUNT }, () => ({ x: 0, y: 0, visibility: 0 }));
  const put = (name: keyof typeof BLAZEPOSE, [x, y]: P) => {
    const l: Landmark = { x: 0.5 + (x * scale) / aspect, y: 0.9 - y * scale };
    if (visibility !== undefined) l.visibility = hide.includes(name) ? 0 : visibility;
    out[BLAZEPOSE[name]] = l;
  };
  if (fig.nose) put('nose', fig.nose);
  for (const k of ['shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle', 'heel', 'footIndex'] as const) {
    const v = fig[k];
    if (!v) continue;
    const [l, r] = isPair(v) ? v : [v, v];
    put(`left${cap(k)}` as keyof typeof BLAZEPOSE, l);
    put(`right${cap(k)}` as keyof typeof BLAZEPOSE, r);
  }
  return out;
}

// Side views unless noted; realistic proportions (torso 0.5 m, legs 0.88 m).
const standing: Figure = {
  nose: [0.08, 1.58],
  shoulder: [0, 1.42],
  elbow: [0, 1.12],
  wrist: [0.02, 0.85],
  hip: [0, 0.92],
  knee: [0.02, 0.5],
  ankle: [0, 0.08],
  heel: [-0.05, 0.03],
  footIndex: [0.15, 0.02],
};
const seatedForwardFold: Figure = {
  nose: [0.65, 0.22],
  shoulder: [0.45, 0.3],
  elbow: [0.62, 0.16],
  wrist: [0.9, 0.12],
  hip: [0, 0.1],
  knee: [0.45, 0.1],
  ankle: [0.88, 0.08],
  heel: [0.88, 0.02],
  footIndex: [0.95, 0.18],
};
const dandasana: Figure = {
  nose: [0.1, 0.78],
  shoulder: [0, 0.62],
  elbow: [0, 0.35],
  wrist: [0.02, 0.1],
  hip: [0, 0.12],
  knee: [0.45, 0.1],
  ankle: [0.88, 0.08],
  heel: [0.86, 0.02],
  footIndex: [0.92, 0.2],
};
const navasana: Figure = {
  nose: [-0.3, 0.6],
  shoulder: [-0.38, 0.44],
  elbow: [-0.1, 0.42],
  wrist: [0.15, 0.42],
  hip: [0, 0.12],
  knee: [0.26, 0.49],
  ankle: [0.5, 0.84],
  heel: [0.48, 0.82],
  footIndex: [0.55, 0.95],
};
const supine: Figure = {
  nose: [-0.72, 0.17],
  shoulder: [-0.5, 0.1],
  elbow: [-0.3, 0.07],
  wrist: [-0.05, 0.05],
  hip: [0, 0.1],
  knee: [0.45, 0.1],
  ankle: [0.88, 0.08],
  heel: [0.88, 0.03],
  footIndex: [0.95, 0.15],
};
const headstand: Figure = {
  nose: [0.05, 0.12],
  shoulder: [0, 0.3],
  elbow: [-0.2, 0.03],
  wrist: [0.02, 0.04],
  hip: [0, 0.8],
  knee: [0, 1.22],
  ankle: [0, 1.65],
  heel: [-0.04, 1.68],
  footIndex: [0.06, 1.75],
};
const shoulderstand: Figure = {
  nose: [-0.18, 0.12],
  shoulder: [0, 0.08],
  elbow: [0.25, 0.04],
  wrist: [0.12, 0.45],
  hip: [0.05, 0.57],
  knee: [0.05, 1.0],
  ankle: [0.05, 1.43],
  heel: [0, 1.46],
  footIndex: [0.1, 1.52],
};
const plough: Figure = {
  nose: [-0.18, 0.12],
  shoulder: [0, 0.08],
  elbow: [0.3, 0.04],
  wrist: [0.55, 0.04],
  hip: [0.05, 0.57],
  knee: [-0.33, 0.34],
  ankle: [-0.7, 0.1],
  heel: [-0.68, 0.15],
  footIndex: [-0.82, 0.02],
};
const bhujapidasana: Figure = {
  nose: [0.15, 0.55],
  shoulder: [-0.05, 0.5],
  elbow: [-0.02, 0.28],
  wrist: [0, 0.03],
  hip: [-0.43, 0.82],
  knee: [-0.02, 0.52],
  ankle: [0.35, 0.28],
  heel: [0.3, 0.3],
  footIndex: [0.45, 0.3],
};
const kukkutasana: Figure = {
  nose: [0.08, 1.0],
  shoulder: [0, 0.85],
  elbow: [0, 0.25],
  wrist: [0, 0.03],
  hip: [-0.02, 0.35],
  knee: [0.2, 0.42],
  ankle: [0.05, 0.45],
  heel: [0.05, 0.45],
  footIndex: [0.1, 0.48],
};
const standingForwardFold: Figure = {
  nose: [0.1, 0.25],
  shoulder: [0.12, 0.45],
  elbow: [0.3, 0.25],
  wrist: [0.15, 0.04],
  hip: [-0.05, 0.92],
  knee: [0.02, 0.5],
  ankle: [0, 0.08],
  heel: [-0.05, 0.03],
  footIndex: [0.15, 0.02],
};
/** Wide-legged forward fold, crown on the floor (hips slightly forward of the feet). */
const prasarita: Figure = {
  nose: [0.14, 0.08],
  shoulder: [0.08, 0.15],
  elbow: [0, 0.2],
  wrist: [-0.05, 0.03],
  hip: [0.05, 0.65],
  knee: [0.02, 0.4],
  ankle: [0, 0.08],
  heel: [-0.05, 0.03],
  footIndex: [0.12, 0.02],
};
/** Front view: torso tilted sideways, feet wide apart. */
const trikonasana: Figure = {
  nose: [0.6, 1.05],
  shoulder: [
    [0.4, 1.17],
    [0.54, 0.87],
  ],
  elbow: [
    [0.4, 1.45],
    [0.6, 0.6],
  ],
  wrist: [
    [0.4, 1.72],
    [0.62, 0.35],
  ],
  hip: [
    [-0.1, 0.85],
    [0.1, 0.85],
  ],
  knee: [
    [-0.28, 0.47],
    [0.28, 0.47],
  ],
  ankle: [
    [-0.5, 0.08],
    [0.5, 0.08],
  ],
  heel: [
    [-0.52, 0.03],
    [0.48, 0.03],
  ],
  footIndex: [
    [-0.58, 0.02],
    [0.62, 0.02],
  ],
};

describe('postureFromLandmarks', () => {
  it('standing', () => {
    expect(postureFromLandmarks(landmarks(standing))).toBe('standing');
  });

  it('seated: forward fold, upright and leaning back', () => {
    expect(postureFromLandmarks(landmarks(seatedForwardFold))).toBe('seated');
    expect(postureFromLandmarks(landmarks(dandasana))).toBe('seated');
    expect(postureFromLandmarks(landmarks(navasana))).toBe('seated');
  });

  it('lying supine', () => {
    expect(postureFromLandmarks(landmarks(supine))).toBe('lying');
  });

  it('inverted: headstand, shoulderstand and plough', () => {
    expect(postureFromLandmarks(landmarks(headstand))).toBe('inverted');
    expect(postureFromLandmarks(landmarks(shoulderstand))).toBe('inverted');
    expect(postureFromLandmarks(landmarks(plough))).toBe('inverted');
  });

  it('arm balance: folded forward and upright', () => {
    expect(postureFromLandmarks(landmarks(bhujapidasana))).toBe('arm-balance');
    expect(postureFromLandmarks(landmarks(kukkutasana))).toBe('arm-balance');
  });

  it('forward folds on the feet are not inverted (nor arm balances)', () => {
    expect(postureFromLandmarks(landmarks(standingForwardFold))).toBeNull();
    expect(postureFromLandmarks(landmarks(prasarita))).toBeNull();
    const hipsBehind: Figure = { ...prasarita, hip: [-0.03, 0.65] };
    expect(postureFromLandmarks(landmarks(hipsBehind))).toBeNull();
  });

  it('null when nothing fits clearly', () => {
    expect(postureFromLandmarks(landmarks(trikonasana))).toBeNull();
  });

  it('corrects for the image aspect ratio', () => {
    // Portrait 9:16 frame: normalized x stretches horizontal distances.
    const aspect = 9 / 16;
    const lm = landmarks(navasana, { aspect });
    expect(postureFromLandmarks(lm, { aspect })).toBe('seated');
    expect(postureFromLandmarks(lm)).not.toBe('seated');
  });

  it('uses one side when the other is hidden', () => {
    expect(postureFromLandmarks(landmarks(standing, { hide: ['leftShoulder', 'rightHip', 'leftKnee', 'rightAnkle'] }))).toBe('standing');
    expect(postureFromLandmarks(landmarks(standing, { hide: ['rightShoulder', 'leftHip'] }))).toBe('standing');
  });

  it('falls back to the toes, then the knees, for the feet', () => {
    expect(postureFromLandmarks(landmarks(headstand, { hide: ['leftAnkle', 'rightAnkle'] }))).toBe('inverted');
    const legsCut = landmarks(headstand, { hide: ['leftAnkle', 'rightAnkle', 'leftHeel', 'rightHeel', 'leftFootIndex', 'rightFootIndex'] });
    expect(postureFromLandmarks(legsCut)).toBe('inverted');
  });

  it('needs the head to tell a plough from a fold', () => {
    expect(postureFromLandmarks(landmarks(plough, { hide: ['nose'] }))).toBeNull();
  });

  it('needs the legs to call a pose lying', () => {
    const legless = landmarks(supine, { hide: ['leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle', 'leftHeel', 'rightHeel', 'leftFootIndex', 'rightFootIndex'] });
    expect(postureFromLandmarks(legless)).toBeNull();
  });

  it('null without a torso', () => {
    expect(postureFromLandmarks([])).toBeNull();
    expect(postureFromLandmarks(landmarks(standing, { hide: ['leftShoulder', 'rightShoulder'] }))).toBeNull();
    expect(postureFromLandmarks(landmarks(standing).slice(0, 20))).toBeNull();
    const collapsed: Figure = { ...standing, shoulder: [0, 0.92] };
    expect(postureFromLandmarks(landmarks(collapsed))).toBeNull();
  });

  it('respects minVisibility and missing visibility', () => {
    expect(postureFromLandmarks(landmarks(standing, { visibility: 0.5 }), { minVisibility: 0.6 })).toBeNull();
    expect(postureFromLandmarks(landmarks(standing, { visibility: undefined }))).toBe('standing');
  });

  it('exposes its thresholds', () => {
    expect(POSTURE_THRESHOLDS.invertedMinTorsoAngle).toBeGreaterThan(90);
    expect(POSTURE_THRESHOLDS.lyingMinBoxRatio).toBeGreaterThan(1);
  });
});

describe('boxFromLandmarks', () => {
  const pts = (coords: Array<[number, number, number?]>): Landmark[] =>
    coords.map(([x, y, visibility]) => (visibility === undefined ? { x, y } : { x, y, visibility }));

  it('pads the bounds by pad × the longer side', () => {
    const b = boxFromLandmarks(pts([[0.4, 0.2, 1], [0.6, 0.2, 0.5], [0.5, 0.6, 1], [0.45, 0.4, 1], [0.55, 0.4, 0.5]]))!;
    const p = 0.15 * 0.4;
    expect(b.x).toBeCloseTo(0.4 - p);
    expect(b.y).toBeCloseTo(0.2 - p);
    expect(b.w).toBeCloseTo(0.2 + 2 * p);
    expect(b.h).toBeCloseTo(0.4 + 2 * p);
    expect(b.score).toBeCloseTo(0.8);
  });

  it('honours the pad option and treats missing visibility as 1', () => {
    const b = boxFromLandmarks(pts([[0.1, 0.1], [0.3, 0.1], [0.2, 0.5], [0.2, 0.3], [0.25, 0.3]]), { pad: 0 })!;
    expect(b).toEqual({ x: 0.1, y: 0.1, w: expect.closeTo(0.2) as number, h: expect.closeTo(0.4) as number, score: 1 });
  });

  it('clamps to the image', () => {
    const b = boxFromLandmarks(pts([[0.02, 0.05], [0.98, 0.05], [0.5, 0.99], [1.1, 0.5], [0.5, 0.5]]))!;
    expect(b.x).toBe(0);
    expect(b.y).toBe(0);
    expect(b.x + b.w).toBe(1);
    expect(b.y + b.h).toBe(1);
  });

  it('ignores low-visibility and non-finite landmarks', () => {
    const lm = pts([[0.4, 0.4], [0.5, 0.4], [0.4, 0.5], [0.5, 0.5], [0.45, 0.45], [0.95, 0.95, 0.1]]);
    lm.push({ x: NaN, y: 0.1 });
    const b = boxFromLandmarks(lm, { pad: 0 })!;
    expect(b.x + b.w).toBeCloseTo(0.5);
    const all = boxFromLandmarks(lm, { pad: 0, minVisibility: 0 })!;
    expect(all.x + all.w).toBeCloseTo(0.95);
    expect(all.y).toBeCloseTo(0.4);
  });

  it('works on a full BlazePose set', () => {
    const b = boxFromLandmarks(landmarks(standing))!;
    expect(b.h).toBeGreaterThan(b.w);
    expect(b.score).toBeCloseTo(0.9);
  });

  it('keeps the top of the head: a head circle around the face landmarks', () => {
    // Standing figure (0.4 image heights per metre): the nose is the highest landmark at 1.58 m;
    // the crown is ≈ 0.17 m higher and must be inside the box before any padding.
    const lm = landmarks(standing);
    const crownY = 0.9 - 1.75 * 0.4;
    const b = boxFromLandmarks(lm, { pad: 0 })!;
    expect(b.y).toBeLessThanOrEqual(crownY);
    // Face landmarks spread out: the radius follows their spread.
    const face = lm.map((l) => ({ ...l }));
    const nose = face[BLAZEPOSE.nose]!;
    face[7] = { x: nose.x - 0.03, y: nose.y, visibility: 0.9 };
    face[8] = { x: nose.x + 0.03, y: nose.y, visibility: 0.9 };
    const wide = boxFromLandmarks(face, { pad: 0 })!;
    const c = { x: nose.x, y: nose.y };
    const r = Math.max(BOX_DEFAULTS.headSpread * 0.02, BOX_DEFAULTS.headTorso * 0.5 * 0.4);
    expect(wide.y).toBeCloseTo(c.y - r);
  });

  it('reaches past the hand landmarks to the fingertips', () => {
    const lm = landmarks(standing);
    // Arm stretched forward: wrist and index far in front of the body.
    lm[BLAZEPOSE.leftWrist] = { x: 0.8, y: 0.3, visibility: 0.9 };
    lm[19] = { x: 0.84, y: 0.3, visibility: 0.9 };
    const b = boxFromLandmarks(lm, { pad: 0 })!;
    expect(b.x + b.w).toBeCloseTo(0.84 + BOX_DEFAULTS.handReach * 0.04);
  });

  it('pads in pixels on wide images', () => {
    const lm = pts([[0.4, 0.2], [0.6, 0.2], [0.5, 0.6], [0.45, 0.4], [0.55, 0.4]]);
    const b = boxFromLandmarks(lm, { aspect: 2 })!;
    // Longer side in pixel units: 0.4 image heights (x extent 0.2 × 2 = 0.4 as well).
    const p = 0.15 * 0.4;
    expect(b.y).toBeCloseTo(0.2 - p);
    expect(b.x).toBeCloseTo(0.4 - p / 2);
    // A tiny figure still gets the minimum padding.
    const tiny = boxFromLandmarks(pts([[0.5, 0.5], [0.501, 0.5], [0.5, 0.502], [0.501, 0.501], [0.5005, 0.5005]]))!;
    expect(tiny.y).toBeCloseTo(0.5 - BOX_DEFAULTS.minPad);
  });

  it('null with fewer than 5 usable landmarks or a degenerate box', () => {
    expect(boxFromLandmarks([])).toBeNull();
    expect(boxFromLandmarks(pts([[0.1, 0.1], [0.2, 0.2], [0.3, 0.3], [0.4, 0.4], [0.5, 0.5, 0.2]]))).toBeNull();
    expect(boxFromLandmarks(pts(Array.from({ length: 6 }, () => [0.5, 0.5] as [number, number])))).toBeNull();
    expect(boxFromLandmarks(pts([[1.2, 0.1], [1.3, 0.2], [1.4, 0.3], [1.5, 0.4], [1.6, 0.5]]))).toBeNull();
  });
});

describe('box helpers', () => {
  it('clampBox', () => {
    expect(clampBox({ x: -0.1, y: 0.5, w: 0.5, h: 0.8 })).toEqual({ x: 0, y: 0.5, w: 0.4, h: 0.5 });
    expect(clampBox({ x: 1.2, y: 0.2, w: 0.3, h: 0.3 })).toEqual({ x: 1, y: 0.2, w: 0, h: expect.closeTo(0.3) as number });
  });

  it('unionBox', () => {
    const a = { x: 0.1, y: 0.2, w: 0.2, h: 0.2 };
    expect(unionBox(a).w).toBeCloseTo(a.w);
    const u = unionBox(a, { x: 0.25, y: 0.1, w: 0.25, h: 0.2 }, { x: 0.2, y: 0.3, w: 0.1, h: 0.3 });
    expect(u.x).toBeCloseTo(0.1);
    expect(u.y).toBeCloseTo(0.1);
    expect(u.w).toBeCloseTo(0.4);
    expect(u.h).toBeCloseTo(0.5);
  });
});
