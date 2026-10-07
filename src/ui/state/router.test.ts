import { describe, expect, it } from 'vitest';
import { parseHash, routeHash, type Route } from './router.svelte';

describe('router', () => {
  it('round-trips routes', () => {
    const routes: Route[] = [{ name: 'home' }, { name: 'process' }, { name: 'settings' }, { name: 'video', id: 'vid_a/b' }];
    for (const r of routes) expect(parseHash(routeHash(r))).toEqual(r);
  });
  it('falls back to home', () => {
    expect(parseHash('')).toEqual({ name: 'home' });
    expect(parseHash('#/video')).toEqual({ name: 'home' });
    expect(parseHash('#/nope')).toEqual({ name: 'home' });
  });
});
