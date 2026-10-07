import { describe, expect, it } from 'vitest';
import { isNewer } from './update.svelte';

describe('isNewer', () => {
  it('detects a different deployed version', () => {
    expect(isNewer('a-1', { version: 'b-2' })).toBe(true);
    expect(isNewer('a-1', { version: 'a-1' })).toBe(false);
    expect(isNewer('a-1', { version: '' })).toBe(false);
    expect(isNewer('a-1', null)).toBe(false);
    expect(isNewer('a-1', 'x')).toBe(false);
  });
});
