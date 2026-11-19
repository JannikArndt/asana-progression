/**
 * The public page of a share link (/s/<token>): the shared session's or hold's photos, cropped
 * like in the app. Read-only, no sign-in; data from /api/public/<token>.
 */
import '../styles/tokens.css';
import './share.css';

interface Img {
  id: string;
  width: number;
  height: number;
  url: string;
}
interface Item {
  id: string;
  asana: string;
  side: 'R' | 'L' | null;
  rep?: number;
  reps?: number;
  crop: { x: number; y: number; w: number; h: number } | null;
  still: Img | null;
  thumb: Img | null;
}
interface View {
  kind: 'session' | 'hold';
  title: string;
  date: string;
  series: string | null;
  items: Item[];
}

const root = document.getElementById('share')!;
const token = location.pathname.split('/').filter(Boolean)[1] ?? '';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: Array<Node | string>): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids);
  return e;
}

const sideName = (s: Item['side']) => (s === 'R' ? 'right' : s === 'L' ? 'left' : '');
function caption(i: Item): string {
  return [i.asana, sideName(i.side), i.reps && i.reps > 1 ? `rep ${i.rep}/${i.reps}` : ''].filter(Boolean).join(' · ');
}

function formatDate(day: string): string {
  const d = new Date(`${day}T12:00:00`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

/** A photo cut to the hold's crop (normalized box) by positioning the image in a clipped frame. */
function cropped(img: Img, crop: Item['crop'], alt: string): HTMLElement {
  const c = crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const frame = el('div', { class: 'frame' });
  frame.style.aspectRatio = `${c.w * img.width} / ${c.h * img.height}`;
  frame.style.setProperty('--a', String((c.w * img.width) / (c.h * img.height)));
  const pic = el('img', { src: img.url, alt, loading: 'lazy', decoding: 'async' });
  pic.style.width = `${100 / c.w}%`;
  pic.style.height = `${100 / c.h}%`;
  pic.style.left = `${(-c.x / c.w) * 100}%`;
  pic.style.top = `${(-c.y / c.h) * 100}%`;
  frame.append(pic);
  return frame;
}

function viewer(items: Item[], start: number) {
  let i = start;
  const stage = el('div', { class: 'stage' });
  const label = el('p', { class: 'caption' });
  const close = el('button', { class: 'round', type: 'button', 'aria-label': 'Close' }, '✕');
  const prev = el('button', { class: 'nav', type: 'button', 'aria-label': 'Previous' }, '‹');
  const next = el('button', { class: 'nav', type: 'button', 'aria-label': 'Next' }, '›');
  const box = el('div', { class: 'viewer', role: 'dialog', 'aria-modal': 'true' }, el('header', {}, close, label), stage, el('footer', {}, prev, next));
  const show = () => {
    const it = items[i]!;
    stage.replaceChildren(cropped((it.still ?? it.thumb)!, it.crop, caption(it)));
    label.textContent = caption(it);
    prev.disabled = i === 0;
    next.disabled = i === items.length - 1;
  };
  const end = () => {
    box.remove();
    document.removeEventListener('keydown', key);
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') end();
    if (e.key === 'ArrowLeft' && i > 0) (i--, show());
    if (e.key === 'ArrowRight' && i < items.length - 1) (i++, show());
  };
  close.onclick = end;
  prev.onclick = () => i > 0 && (i--, show());
  next.onclick = () => i < items.length - 1 && (i++, show());
  let x0: number | null = null;
  stage.addEventListener('pointerdown', (e) => (x0 = e.clientX));
  stage.addEventListener('pointerup', (e) => {
    if (x0 === null) return;
    const dx = e.clientX - x0;
    x0 = null;
    if (dx < -40 && i < items.length - 1) (i++, show());
    else if (dx > 40 && i > 0) (i--, show());
  });
  document.addEventListener('keydown', key);
  document.body.append(box);
  show();
  close.focus();
}

function render(v: View) {
  document.title = v.title;
  const head = el('header', { class: 'head' }, el('h1', {}, v.kind === 'hold' && v.items[0] ? caption(v.items[0]) : (v.series ?? 'Practice')), el('p', { class: 'muted' }, v.date ? formatDate(v.date) : ''));
  const grid = el('div', { class: v.items.length === 1 ? 'grid single' : 'grid' });
  v.items.forEach((it, idx) => {
    const img = (v.items.length === 1 ? (it.still ?? it.thumb) : (it.thumb ?? it.still))!;
    const tile = el('button', { class: 'tile', type: 'button', 'aria-label': caption(it) }, cropped(img, it.crop, caption(it)), el('span', { class: 'caption' }, caption(it)));
    tile.onclick = () => viewer(v.items, idx);
    grid.append(tile);
  });
  root.replaceChildren(head, v.items.length ? grid : el('p', { class: 'muted' }, 'No photos yet.'), el('footer', { class: 'foot muted' }, 'Asana Progression'));
}

async function load() {
  root.replaceChildren(el('p', { class: 'muted center' }, 'Loading…'));
  try {
    const res = await fetch(`/api/public/${encodeURIComponent(token)}`);
    if (res.status === 404) {
      root.replaceChildren(el('p', { class: 'muted center' }, 'This link was removed or never existed.'));
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    render((await res.json()) as View);
  } catch (e) {
    const retry = el('button', { class: 'btn', type: 'button' }, 'Try again');
    retry.onclick = () => void load();
    root.replaceChildren(el('p', { class: 'center' }, `Could not load the photos (${(e as Error).message}).`), retry);
  }
}

void load();
