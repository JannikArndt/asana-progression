/**
 * Parses QuickTime date strings such as `com.apple.quicktime.creationdate`
 * ("2024-05-12T07:31:22+0200") without relying on engine-specific Date parsing.
 * Returns a normalized ISO 8601 string that keeps the original UTC offset.
 */
export function parseQuickTimeDate(raw: string | null | undefined): { iso: string; epochMs: number } | null {
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(raw.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s = '00', frac, tz] = m;
  const ms = frac ? Math.round(Number(`0.${frac}`) * 1000) : 0;
  let offsetMin = 0;
  let tzOut = 'Z';
  if (tz && tz !== 'Z') {
    const sign = tz[0] === '-' ? -1 : 1;
    const digits = tz.slice(1).replace(':', '');
    const oh = Number(digits.slice(0, 2));
    const om = Number(digits.slice(2, 4));
    offsetMin = sign * (oh * 60 + om);
    tzOut = `${tz[0]}${digits.slice(0, 2)}:${digits.slice(2, 4)}`;
  } else if (!tz) {
    tzOut = '';
  }
  const utc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), ms) - offsetMin * 60000;
  if (!Number.isFinite(utc)) return null;
  const msPart = ms ? `.${String(ms).padStart(3, '0')}` : '';
  return { iso: `${y}-${mo}-${d}T${h}:${mi}:${s}${msPart}${tzOut}`, epochMs: utc };
}

/** Formats an epoch time as local ISO 8601 with offset (used for file.lastModified fallback). */
export function toLocalIso(epochMs: number, offsetMin = -new Date(epochMs).getTimezoneOffset()): string {
  const d = new Date(epochMs + offsetMin * 60000);
  const pad = (n: number, l = 2) => String(n).padStart(l, '0');
  const sign = offsetMin < 0 ? '-' : '+';
  const a = Math.abs(offsetMin);
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}` +
    `${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`
  );
}
