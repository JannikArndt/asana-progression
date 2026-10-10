/**
 * Pure helpers on BlazePose landmarks (33 points in normalized image coordinates, y grows
 * downwards): the body box and a coarse posture class.
 */
import type { Box, PostureClass } from '../model/types';
import type { BodyBox, Landmark } from './types';

/** BlazePose landmark indices used by the heuristics. */
export const BLAZEPOSE = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFootIndex: 31,
  rightFootIndex: 32,
} as const;

/** Number of landmarks per BlazePose pose. */
export const BLAZEPOSE_COUNT = 33;

const DEFAULT_MIN_VISIBILITY = 0.3;
/** A body box needs at least this many usable landmarks. */
const MIN_BOX_LANDMARKS = 5;

/**
 * Body-box geometry. BlazePose has no landmark on the top of the head or the fingertips, so the
 * box is grown there before padding. Lengths are in the pixel-proportional units of the image
 * height.
 */
export const BOX_DEFAULTS = {
  /** Padding on every side as a fraction of the longer side of the grown bounds. */
  pad: 0.15,
  /** Padding at least this fraction of the image height (small figures, imprecise landmarks). */
  minPad: 0.02,
  /** Head radius = this × the largest distance of a face landmark from their centre… */
  headSpread: 1.6,
  /** …but at least this × the torso length (shoulder midpoint to hip midpoint). */
  headTorso: 0.35,
  /** Fingertips: the hand landmarks extended by this × their distance from the wrist. */
  handReach: 0.6,
} as const;

/**
 * Version of `boxFromLandmarks`. Holds whose automatic crop has an older version are cropped again
 * from their stored still (2: head and fingertips, aspect-aware padding of 0.15 instead of 0.12).
 */
export const CROP_VERSION = 2;

/** Face landmarks (nose, eyes, ears, mouth). */
const FACE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
/** Wrist, then pinky, index and thumb of each hand. */
const HANDS = [
  [15, 17, 19, 21],
  [16, 18, 20, 22],
] as const;

function usable(l: Landmark | undefined, minVisibility: number): l is Landmark {
  return !!l && Number.isFinite(l.x) && Number.isFinite(l.y) && (l.visibility === undefined || l.visibility >= minVisibility);
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Restricts a normalized box to the image ([0, 1] on both axes). */
export function clampBox(b: Box): Box {
  const x = clamp01(b.x);
  const y = clamp01(b.y);
  return { x, y, w: Math.max(0, clamp01(b.x + b.w) - x), h: Math.max(0, clamp01(b.y + b.h) - y) };
}

/** Smallest box containing all given boxes. */
export function unionBox(first: Box, ...rest: Box[]): Box {
  let x0 = first.x;
  let y0 = first.y;
  let x1 = first.x + first.w;
  let y1 = first.y + first.h;
  for (const b of rest) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export interface BoxOptions {
  /** Landmarks with a lower visibility are ignored (default 0.3; a missing visibility counts as 1). */
  minVisibility?: number;
  /** Padding on every side as a fraction of the longer side of the grown bounds (default 0.15). */
  pad?: number;
  /** Image width / height; padding and head size are measured in pixels (default 1). */
  aspect?: number;
}

/**
 * Padded body box, clamped to the image. With a full BlazePose set the bounds of the usable
 * landmarks are first grown by a head circle (the face landmarks stop at the eyes) and by the
 * fingertips (the hand landmarks stop at the knuckles); see BOX_DEFAULTS. Score = mean visibility
 * of the landmarks used. Null with fewer than 5 usable landmarks or when the box has no area.
 */
export function boxFromLandmarks(landmarks: Landmark[], opts: BoxOptions = {}): BodyBox | null {
  const minVisibility = opts.minVisibility ?? DEFAULT_MIN_VISIBILITY;
  const pad = opts.pad ?? BOX_DEFAULTS.pad;
  const aspect = opts.aspect ?? 1;
  const used = landmarks.filter((l) => usable(l, minVisibility));
  if (used.length < MIN_BOX_LANDMARKS) return null;
  // Work in pixel-proportional units: x scaled by the aspect, y in image heights.
  const pts: Pt[] = used.map((l) => ({ x: l.x * aspect, y: l.y }));
  if (landmarks.length >= BLAZEPOSE_COUNT) {
    const pt = (i: number): Pt | null => {
      const l = landmarks[i];
      return usable(l, minVisibility) ? { x: l.x * aspect, y: l.y } : null;
    };
    const face = FACE.map(pt).filter((p): p is Pt => p !== null);
    if (face.length) {
      const c = { x: face.reduce((s, p) => s + p.x, 0) / face.length, y: face.reduce((s, p) => s + p.y, 0) / face.length };
      const spread = Math.max(...face.map((p) => Math.hypot(p.x - c.x, p.y - c.y)));
      const S = mid(pt(BLAZEPOSE.leftShoulder), pt(BLAZEPOSE.rightShoulder));
      const H = mid(pt(BLAZEPOSE.leftHip), pt(BLAZEPOSE.rightHip));
      const torso = S && H ? Math.hypot(S.x - H.x, S.y - H.y) : 0;
      const r = Math.max(BOX_DEFAULTS.headSpread * spread, BOX_DEFAULTS.headTorso * torso);
      pts.push({ x: c.x - r, y: c.y - r }, { x: c.x + r, y: c.y + r });
    }
    for (const [wrist, ...tips] of HANDS) {
      const w = pt(wrist);
      if (!w) continue;
      for (const i of tips) {
        const t = pt(i);
        if (t) pts.push({ x: t.x + BOX_DEFAULTS.handReach * (t.x - w.x), y: t.y + BOX_DEFAULTS.handReach * (t.y - w.y) });
      }
    }
  }
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  // All landmarks on one spot: no body to frame.
  if (x1 - x0 <= 0 && y1 - y0 <= 0) return null;
  const visibility = used.reduce((s, l) => s + (l.visibility ?? 1), 0);
  const p = Math.max(pad * Math.max(x1 - x0, y1 - y0), pad > 0 ? BOX_DEFAULTS.minPad : 0);
  const box = clampBox({ x: (x0 - p) / aspect, y: y0 - p, w: (x1 - x0 + 2 * p) / aspect, h: y1 - y0 + 2 * p });
  if (box.w <= 0 || box.h <= 0) return null;
  return { ...box, score: visibility / used.length };
}

/**
 * Thresholds of `postureFromLandmarks`. Lengths are in torso lengths (shoulder midpoint to hip
 * midpoint), heights are measured up from the floor level (the lowest usable landmark), angles
 * are in degrees.
 */
export const POSTURE_THRESHOLDS = {
  /** Torso shorter than this (in image heights): no posture. */
  minTorso: 0.02,
  /** Inverted: torso angle from upright at least this (90 = horizontal, 180 = upside down)… */
  invertedMinTorsoAngle: 120,
  /** …and the feet at least this far above the shoulders (headstand, shoulderstand)… */
  invertedMinFeetAboveShoulders: 0.5,
  /** …or, plough family: shoulders at most this high… */
  ploughMaxShoulderHeight: 0.3,
  /** …and the feet beyond the head, at least this far from the hips horizontally. */
  ploughMinFeetReach: 0.5,
  /** Lying: torso within this many degrees of horizontal… */
  lyingMaxTorsoTilt: 30,
  /** …the body extended at the hips (angle between torso and thighs at least this)… */
  lyingMinHipAngle: 120,
  /** …and the body at least this many times wider than tall. */
  lyingMinBoxRatio: 2,
  /** Arm balance: the lowest wrist at most this high (the hands carry the body)… */
  armBalanceMaxWristHeight: 0.15,
  /** …with the hips and every foot landmark at least this far above that wrist. */
  armBalanceMinLift: 0.3,
  /** Standing: torso within this many degrees of vertical… */
  standingMaxTorsoTilt: 30,
  /** …hips above the lower knee above the lower ankle, each step at least this high… */
  standingMinStep: 0.15,
  /** …and the hips at least this high above the lower ankle. */
  standingMinLegHeight: 1,
  /** Seated: hips at most this high… */
  seatedMaxHipHeight: 0.35,
  /** …shoulders at least this far above the hips… */
  seatedMinShoulderRise: 0.15,
  /** …and the torso within this many degrees of vertical… */
  seatedMaxTorsoTilt: 60,
  /** …or folded over the legs (angle between torso and thighs at most this). */
  seatedMaxFoldAngle: 75,
} as const;

export interface PostureOptions {
  /** Image width / height; scales x so that angles and widths are measured in pixels (default 1). */
  aspect?: number;
  /** Landmarks with a lower visibility count as missing (default 0.3). */
  minVisibility?: number;
}

interface Pt {
  x: number;
  y: number;
}

function mid(a: Pt | null, b: Pt | null): Pt | null {
  return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : (a ?? b);
}

/** The lower (larger y) of two points. */
function lower(a: Pt | null, b: Pt | null): Pt | null {
  return a && b ? (a.y >= b.y ? a : b) : (a ?? b);
}

/** Angle between two vectors in degrees (NaN if one has zero length). */
function angle(ax: number, ay: number, bx: number, by: number): number {
  const cos = (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by));
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
}

/**
 * Coarse posture from one pose, assuming an upright camera. Rules, checked in this order (see
 * POSTURE_THRESHOLDS):
 *  - inverted: torso upside down and the feet clearly above the shoulders (headstand,
 *    shoulderstand), or shoulders on the floor with the feet beyond the head (plough)
 *  - lying: torso near horizontal, body extended at the hips, body box much wider than tall
 *  - arm-balance: the wrists are the lowest points, hips and feet lifted off the floor
 *  - standing: torso near vertical, hips above knees above ankles, legs long relative to the torso
 *  - seated: hips at floor level, shoulders above them, torso upright or folded over the legs
 * Null when shoulders or hips are missing or nothing fits clearly.
 */
export function postureFromLandmarks(landmarks: Landmark[], opts: PostureOptions = {}): PostureClass | null {
  const t = POSTURE_THRESHOLDS;
  const aspect = opts.aspect ?? 1;
  const minVisibility = opts.minVisibility ?? DEFAULT_MIN_VISIBILITY;
  const used = landmarks.filter((l) => usable(l, minVisibility));
  const pt = (i: number): Pt | null => {
    const l = landmarks[i];
    return usable(l, minVisibility) ? { x: l.x * aspect, y: l.y } : null;
  };
  const L = BLAZEPOSE;
  const S = mid(pt(L.leftShoulder), pt(L.rightShoulder));
  const H = mid(pt(L.leftHip), pt(L.rightHip));
  if (!S || !H) return null;
  const T = Math.hypot(S.x - H.x, S.y - H.y);
  if (T < t.minTorso) return null;

  const nose = pt(L.nose);
  const knees = mid(pt(L.leftKnee), pt(L.rightKnee));
  const ankles = mid(pt(L.leftAnkle), pt(L.rightAnkle)) ?? mid(pt(L.leftFootIndex), pt(L.rightFootIndex));
  const feet = ankles ?? knees;
  const floor = Math.max(...used.map((l) => l.y));
  const height = (p: Pt) => (floor - p.y) / T;
  const torsoAngle = angle(S.x - H.x, S.y - H.y, 0, -1);
  const thigh = knees ?? ankles;
  const hipAngle = thigh ? angle(S.x - H.x, S.y - H.y, thigh.x - H.x, thigh.y - H.y) : NaN;

  if (feet && torsoAngle >= t.invertedMinTorsoAngle) {
    if ((S.y - feet.y) / T >= t.invertedMinFeetAboveShoulders) return 'inverted';
    if (nose && height(S) <= t.ploughMaxShoulderHeight) {
      const reach = feet.x - H.x;
      const head = nose.x - H.x;
      if (Math.sign(reach) === Math.sign(head) && Math.abs(reach) >= Math.max(Math.abs(head), t.ploughMinFeetReach * T)) {
        return 'inverted';
      }
    }
  }

  const xs = used.map((l) => l.x * aspect);
  const width = Math.max(...xs) - Math.min(...xs);
  const tall = floor - Math.min(...used.map((l) => l.y));
  if (Math.abs(torsoAngle - 90) <= t.lyingMaxTorsoTilt && hipAngle >= t.lyingMinHipAngle && width >= t.lyingMinBoxRatio * tall) {
    return 'lying';
  }

  const wrist = lower(pt(L.leftWrist), pt(L.rightWrist));
  const footPoints = [L.leftAnkle, L.rightAnkle, L.leftHeel, L.rightHeel, L.leftFootIndex, L.rightFootIndex]
    .map(pt)
    .filter((p): p is Pt => p !== null);
  if (wrist && footPoints.length > 0 && height(wrist) <= t.armBalanceMaxWristHeight) {
    const lifted = (p: Pt) => (wrist.y - p.y) / T >= t.armBalanceMinLift;
    if (lifted(H) && footPoints.every(lifted)) return 'arm-balance';
  }

  const knee = lower(pt(L.leftKnee), pt(L.rightKnee));
  const ankle = lower(pt(L.leftAnkle), pt(L.rightAnkle));
  if (knee && ankle && torsoAngle <= t.standingMaxTorsoTilt) {
    const step = t.standingMinStep * T;
    if (knee.y - H.y >= step && ankle.y - knee.y >= step && (ankle.y - H.y) / T >= t.standingMinLegHeight) return 'standing';
  }

  if (
    height(H) <= t.seatedMaxHipHeight &&
    (H.y - S.y) / T >= t.seatedMinShoulderRise &&
    (torsoAngle <= t.seatedMaxTorsoTilt || hipAngle <= t.seatedMaxFoldAngle)
  ) {
    return 'seated';
  }
  return null;
}
