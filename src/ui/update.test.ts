import { describe, expect, it } from 'vitest';
import { isNewer, mayAutoReload, MIN_PAGE_AGE_MS } from './update.svelte';

describe('isNewer', () => {
  it('detects a different deployed build', () => {
    expect(isNewer('a1', { build: 'b2', version: 'x', builtAt: 'y' })).toBe(true);
    expect(isNewer('a1', { build: 'a1' })).toBe(false);
    expect(isNewer('a1', { build: '' })).toBe(false);
    expect(isNewer('a1', { version: 'b2' })).toBe(false); // only `build` counts: version changes on every CI run
    expect(isNewer('a1', null)).toBe(false);
    expect(isNewer('a1', 'x')).toBe(false);
  });

  it('stays silent in an unstamped (dev) page', () => {
    expect(isNewer('dev', { build: 'b2' })).toBe(false);
  });
});

describe('mayAutoReload', () => {
  it('waits for the first 20 s and never reloads twice for the same build', () => {
    expect(mayAutoReload('b2', MIN_PAGE_AGE_MS - 1, null)).toBe(false);
    expect(mayAutoReload('b2', MIN_PAGE_AGE_MS, null)).toBe(true);
    expect(mayAutoReload('b2', 60_000, 'b2')).toBe(false);
    expect(mayAutoReload('b3', 60_000, 'b2')).toBe(true);
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
