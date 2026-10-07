/** Human readable profile from a WebCodecs codec string. */
export function describeCodec(codecString: string | null): string | null {
  if (!codecString) return null;
  const parts = codecString.split('.');
  const fourcc = parts[0];
  if (fourcc === 'hvc1' || fourcc === 'hev1') {
    const space = parts[1] ?? '';
    const idc = Number(space.replace(/^[ABC]/, ''));
    const names: Record<number, string> = { 1: 'Main', 2: 'Main 10', 3: 'Main Still Picture', 4: 'Range Extensions' };
    return `HEVC ${names[idc] ?? `profile ${space}`}`;
  }
  if (fourcc === 'avc1' || fourcc === 'avc3') {
    const p = parseInt((parts[1] ?? '').slice(0, 2), 16);
    const names: Record<number, string> = { 66: 'Baseline', 77: 'Main', 88: 'Extended', 100: 'High', 110: 'High 10', 122: 'High 4:2:2', 244: 'High 4:4:4' };
    return `H.264 ${names[p] ?? `profile ${p}`}`;
  }
  if (fourcc === 'vp09') return `VP9 profile ${Number(parts[1] ?? 0)}`;
  if (fourcc === 'av01') return `AV1 profile ${Number(parts[1] ?? 0)}`;
  return fourcc ?? null;
}
