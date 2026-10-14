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

describe('updates checks', () => {
  it('keeps the automatic reload away from selected files but not the tap', async () => {
    const { updates } = await import('./update.svelte');
    let busy = false;
    let files = 0;
    updates.addQuietCheck(() => !busy);
    updates.addHiddenCheck(() => files === 0);
    expect([updates.isQuiet(), updates.mayReloadHidden()]).toEqual([true, true]);
    files = 2;
    expect([updates.isQuiet(), updates.mayReloadHidden()]).toEqual([true, false]);
    busy = true;
    expect(updates.isQuiet()).toBe(false);
    expect(updates.applyNow()).toBe(false);
  });
});
