import { describe, expect, it } from 'vitest';
import { parseHash, routeHash, type Route } from './router.svelte';

describe('router', () => {
  it('round-trips routes', () => {
    const routes: Route[] = [
      { name: 'home' },
      { name: 'home', tab: 'sessions' },
      { name: 'home', tab: 'asanas' },
      { name: 'process' },
      { name: 'settings' },
      { name: 'video', id: 'vid_a/b' },
      { name: 'session', id: 'ses_1' },
      { name: 'asana', id: 'navasana' },
    ];
    for (const r of routes) expect(parseHash(routeHash(r))).toEqual(r);
  });
  it('falls back to home', () => {
    expect(parseHash('')).toEqual({ name: 'home' });
    expect(parseHash('#/video')).toEqual({ name: 'home' });
    expect(parseHash('#/nope')).toEqual({ name: 'home' });
  });
});

describe('catalog routes', () => {
  it('round-trips catalog and template routes', () => {
    expect(parseHash('#/catalog')).toEqual({ name: 'catalog' });
    expect(parseHash(routeHash({ name: 'template', id: 'a b' }))).toEqual({ name: 'template', id: 'a b' });
  });
});
