/** Calendar day of an ISO date/time ("2025-08-28T18:04:43+02:00" → "28 Aug 2025"), in the recording's own date. */
export function formatDay(iso: string | null | undefined, weekday = false): string {
  if (!iso) return '';
  const d = new Date(iso.slice(0, 10) + 'T12:00:00Z');
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString(undefined, { ...(weekday ? { weekday: 'short' as const } : {}), day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Recording date and time. A time with a UTC offset ("2025-08-28T18:04:43+02:00") is shown as the
 * recording's own wall-clock time ("28 Aug 2025, 18:04:43"); UTC times (file dates) in local time.
 */
export function formatRecordedAt(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^\d{4}-\d\d-\d\dT(\d\d:\d\d(?::\d\d)?)(?:\.\d+)?([+-]\d\d:?\d\d)$/.exec(iso);
  if (m) return `${formatDay(iso)}, ${m[1]}`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}
