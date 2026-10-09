/** Calendar day of an ISO date/time ("2025-08-28T18:04:43+02:00" → "28 Aug 2025"), in the recording's own date. */
export function formatDay(iso: string | null | undefined, weekday = false): string {
  if (!iso) return '';
  const d = new Date(iso.slice(0, 10) + 'T12:00:00Z');
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString(undefined, { ...(weekday ? { weekday: 'short' as const } : {}), day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
