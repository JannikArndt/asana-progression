import { describe, expect, it } from 'vitest';
import { formatDay, formatRecordedAt, formatShortDay, localDay } from './format';

describe('formatRecordedAt', () => {
  it("keeps the recording's own wall-clock time when it carries an offset", () => {
    const s = formatRecordedAt('2025-08-28T18:04:43+02:00');
    expect(s).toBe(`${formatDay('2025-08-28')}, 18:04:43`);
    expect(formatRecordedAt('2025-08-28T23:30:00.250-0500')).toBe(`${formatDay('2025-08-28')}, 23:30:00`);
  });
  it('shows UTC times in local time and passes unknown strings through', () => {
    expect(formatRecordedAt('2025-08-28T16:04:43Z')).toMatch(/\d\d:04:43/);
    expect(formatRecordedAt('yesterday')).toBe('yesterday');
    expect(formatRecordedAt(null)).toBe('');
  });
});

describe('short days', () => {
  it('leaves out the current year and pads the local day', () => {
    const now = new Date(2026, 10, 17, 9);
    expect(formatShortDay('2026-11-12T07:00:00+01:00', now)).not.toMatch(/2026/);
    expect(formatShortDay('2025-11-12', now)).toMatch(/2025/);
    expect(formatShortDay('', now)).toBe('');
    expect(formatShortDay('nonsense', now)).toBe('nonsense');
    expect(localDay(new Date(2026, 0, 5, 23))).toBe('2026-01-05');
  });
});
