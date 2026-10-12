import { describe, expect, it } from 'vitest';
import { formatDay, formatRecordedAt } from './format';

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
