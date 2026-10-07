/**
 * Detects packets that no other frame references, so they can be skipped when only a few frames
 * per second are needed. Works on length-prefixed NAL units (hvcC / avcC sample format).
 */

export type NalCodec = 'hevc' | 'avc';

/** NAL length size from an hvcC or avcC decoder configuration record. */
export function nalLengthSize(codec: NalCodec, description: Uint8Array | undefined): number {
  if (!description) return 4;
  if (codec === 'hevc') return description.length > 21 ? (description[21]! & 3) + 1 : 4;
  return description.length > 4 ? (description[4]! & 3) + 1 : 4;
}

/**
 * True if every VCL NAL unit in the access unit is a non-reference picture:
 * HEVC: sub-layer non-reference types (TRAIL_N, TSA_N, STSA_N, RADL_N, RASL_N, RSV_VCL_N10/12/14);
 * AVC: nal_ref_idc == 0 on slice NAL units.
 * Returns false when no VCL NAL unit is found or the data is malformed (safe default: decode it).
 */
export function isNonReference(codec: NalCodec, data: Uint8Array, lengthSize: number): boolean {
  let offset = 0;
  let sawVcl = false;
  while (offset + lengthSize <= data.length) {
    let len = 0;
    for (let i = 0; i < lengthSize; i++) len = len * 256 + data[offset + i]!;
    offset += lengthSize;
    if (len === 0 || offset + len > data.length) return false;
    const h = data[offset]!;
    if (codec === 'hevc') {
      const type = (h >> 1) & 0x3f;
      if (type < 32) {
        sawVcl = true;
        if (!(type <= 14 && type % 2 === 0)) return false;
      }
    } else {
      const type = h & 0x1f;
      if (type === 1 || type === 5) {
        sawVcl = true;
        if (((h >> 5) & 3) !== 0 || type === 5) return false;
      }
    }
    offset += len;
  }
  return sawVcl;
}
