/** Tiny hash router: #/, #/process, #/video/<id>, #/settings */
export type Route =
  | { name: 'home' }
  | { name: 'process' }
  | { name: 'video'; id: string }
  | { name: 'settings' };

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'process') return { name: 'process' };
  if (parts[0] === 'settings') return { name: 'settings' };
  if (parts[0] === 'video' && parts[1]) return { name: 'video', id: parts[1] };
  return { name: 'home' };
}

export function routeHash(r: Route): string {
  switch (r.name) {
    case 'home':
      return '#/';
    case 'process':
      return '#/process';
    case 'settings':
      return '#/settings';
    case 'video':
      return `#/video/${encodeURIComponent(r.id)}`;
  }
}

class Router {
  route = $state<Route>({ name: 'home' });

  constructor() {
    if (typeof window === 'undefined') return;
    this.route = parseHash(location.hash);
    window.addEventListener('hashchange', () => {
      this.route = parseHash(location.hash);
      window.scrollTo(0, 0);
    });
  }

  go(r: Route, replace = false) {
    const h = routeHash(r);
    if (replace) history.replaceState(null, '', h);
    else history.pushState(null, '', h);
    this.route = r;
    window.scrollTo(0, 0);
  }
}

export const router = new Router();
