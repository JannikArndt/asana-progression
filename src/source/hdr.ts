/**
 * HDR helpers for the spike's HDR probe: frame description and a reference BT.2100 HLG → SDR
 * (BT.709/sRGB) tone-mapping applied to raw 10-bit YUV from VideoFrame.copyTo().
 *
 * Constants: HLG OETF from ITU-R BT.2100; reference white 203 cd/m² (ITU-R BT.2408);
 * nominal peak 1000 cd/m² with system gamma 1.2.
 */

export interface FrameDescription {
  format: string | null;
  codedWidth: number;
  codedHeight: number;
  displayWidth: number;
  displayHeight: number;
  primaries: string | null;
  transfer: string | null;
  matrix: string | null;
  fullRange: boolean | null;
}

export function describeFrame(frame: VideoFrame): FrameDescription {
  const cs = frame.colorSpace;
  return {
    format: frame.format ?? null,
    codedWidth: frame.codedWidth,
    codedHeight: frame.codedHeight,
    displayWidth: frame.displayWidth,
    displayHeight: frame.displayHeight,
    primaries: cs?.primaries ?? null,
    transfer: cs?.transfer ?? null,
    matrix: cs?.matrix ?? null,
    fullRange: cs?.fullRange ?? null,
  };
}

const HLG_A = 0.17883277;
const HLG_B = 0.28466892;
const HLG_C = 0.55991073;
const PEAK_NITS = 1000;
const REF_WHITE_NITS = 203;
const SYSTEM_GAMMA = 1.2;

/** HLG inverse OETF: non-linear signal E' ∈ [0,1] → normalized scene linear light E ∈ [0,1]. */
export function hlgInverseOetf(e: number): number {
  if (e <= 0) return 0;
  if (e <= 0.5) return (e * e) / 3;
  return (Math.exp((e - HLG_C) / HLG_A) + HLG_B) / 12;
}

/** sRGB OETF (IEC 61966-2-1), input clamped to [0,1]. */
export function srgbOetf(l: number): number {
  const v = Math.min(1, Math.max(0, l));
  return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

/** Identity below `knee`, exponential roll-off above it (slope 1 at the knee, asymptote 1). */
export function softKnee(x: number, knee = 0.75): number {
  if (x <= knee) return x;
  const r = 1 - knee;
  return knee + r * (1 - Math.exp(-(x - knee) / r));
}

/** BT.2020 → BT.709 primaries (linear light). */
const M_2020_TO_709 = [
  [1.6605, -0.5876, -0.0728],
  [-0.1246, 1.1329, -0.0083],
  [-0.0182, -0.1006, 1.1187],
] as const;

/**
 * One HLG R'G'B' pixel (BT.2020, values 0–1) → sRGB bytes. Steps: inverse OETF → OOTF (γ = 1.2,
 * 1000 nits) → scale so 203 nits = SDR white → soft knee for highlights → BT.709 gamut → sRGB.
 */
export function hlgPixelToSrgb(r: number, g: number, b: number, out: Uint8ClampedArray, o: number): void {
  const R = hlgInverseOetf(r);
  const G = hlgInverseOetf(g);
  const B = hlgInverseOetf(b);
  const Ys = 0.2627 * R + 0.678 * G + 0.0593 * B;
  const gain = Ys > 0 ? (PEAK_NITS * Math.pow(Ys, SYSTEM_GAMMA - 1)) / REF_WHITE_NITS : 0;
  const Yd = Ys * gain;
  const scale = Yd > 0 ? softKnee(Yd) / Yd : 0;
  const k = gain * scale;
  const lr = R * k;
  const lg = G * k;
  const lb = B * k;
  const m = M_2020_TO_709;
  out[o] = Math.round(255 * srgbOetf(m[0][0] * lr + m[0][1] * lg + m[0][2] * lb));
  out[o + 1] = Math.round(255 * srgbOetf(m[1][0] * lr + m[1][1] * lg + m[1][2] * lb));
  out[o + 2] = Math.round(255 * srgbOetf(m[2][0] * lr + m[2][1] * lg + m[2][2] * lb));
  out[o + 3] = 255;
}

/** 10-bit limited-range BT.2020 non-constant-luminance Y'CbCr → R'G'B' (0–1). */
export function yuv10ToRgb(y: number, u: number, v: number, fullRange: boolean): [number, number, number] {
  const Y = fullRange ? y / 1023 : (y - 64) / 876;
  const Cb = fullRange ? (u - 512) / 1023 : (u - 512) / 896;
  const Cr = fullRange ? (v - 512) / 1023 : (v - 512) / 896;
  return [Y + 1.4746 * Cr, Y - 0.16455 * Cb - 0.57135 * Cr, Y + 1.8814 * Cb];
}

/**
 * Tone-maps an I420P10 HLG frame in software. Returns null (with a reason) for other formats —
 * on engines that hide the raw pixel format this path is unavailable.
 */
export async function toneMapHlgFrame(
  frame: VideoFrame,
  maxLongSide = 1280,
): Promise<{ image: ImageData } | { reason: string }> {
  if ((frame.format as string | null) !== 'I420P10') return { reason: `pixel format ${frame.format ?? 'opaque'} is not readable as 10-bit YUV` };
  const w = frame.codedWidth;
  const h = frame.codedHeight;
  const buf = new Uint16Array(frame.allocationSize() / 2);
  const layout = await frame.copyTo(buf);
  const [yL, uL, vL] = layout;
  if (!yL || !uL || !vL) return { reason: 'unexpected plane layout' };
  const step = Math.max(1, Math.ceil(Math.max(w, h) / maxLongSide));
  const ow = Math.floor(w / step);
  const oh = Math.floor(h / step);
  const img = new ImageData(ow, oh);
  const full = frame.colorSpace?.fullRange === true;
  for (let oy = 0; oy < oh; oy++) {
    const y = oy * step;
    for (let ox = 0; ox < ow; ox++) {
      const x = ox * step;
      const Y = buf[(yL.offset >> 1) + y * (yL.stride >> 1) + x]!;
      const U = buf[(uL.offset >> 1) + (y >> 1) * (uL.stride >> 1) + (x >> 1)]!;
      const V = buf[(vL.offset >> 1) + (y >> 1) * (vL.stride >> 1) + (x >> 1)]!;
      const [r, g, b] = yuv10ToRgb(Y, U, V, full);
      hlgPixelToSrgb(r, g, b, img.data, (oy * ow + ox) * 4);
    }
  }
  return { image: img };
}
