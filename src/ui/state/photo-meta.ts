import type { PhotoMetadata } from '../../capture';
import type { Asana, Session, Video } from '../../model';
import type { ProgressionItem } from '../../progression';
import { routeHash } from './router.svelte';

const SIDE: Record<string, string> = { R: 'Right', L: 'Left' };

/**
 * Wall-clock time `plusS` seconds after an ISO 8601 time, in that time's own UTC offset:
 * "2026-10-14T07:30:00+0200" + 65.25 → { local: "2026-10-14T07:31:05.250", offset: "+02:00" }.
 * "Z" is "+00:00"; without an offset there is none. Null when the string does not parse.
 */
export function localTimeAt(iso: string, plusS = 0): { local: string; offset?: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(iso.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s = '0', frac = '0', tz] = m;
  const ms = Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +s) + Math.round(Number(`0.${frac}`) * 1000) + Math.round(plusS * 1000);
  const t = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const sub = t.getUTCMilliseconds();
  const local = `${p(t.getUTCFullYear(), 4)}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}T${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())}${sub ? `.${p(sub, 3)}` : ''}`;
  if (!tz) return { local };
  if (tz === 'Z') return { local, offset: '+00:00' };
  const digits = tz.replace(':', '');
  return { local, offset: `${digits.slice(0, 3)}:${digits.slice(3)}` };
}

/** Link to the asana's progression page in this deployment (`href` = the page's address). */
export function asanaLink(asanaId: string, href: string): string {
  return href.split('#')[0] + routeHash({ name: 'asana', id: asanaId });
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

export interface PhotoContext {
  item: ProgressionItem;
  asana: Asana | undefined;
  video: Video | undefined;
  session: Session | undefined;
  /** The page's address (for the link back to the app). */
  href: string;
  width: number;
  height: number;
}

/**
 * Everything known about a hold's photo: asana name (+ side, rep) as title and caption, the
 * recording time of its frame (video start + best time, in the recording's own UTC offset), the
 * place (video coordinates, else the session's; the session's place name), the camera from the
 * video's metadata, the session note, and a link to the asana's page.
 */
export function holdPhotoMetadata({ item, asana, video, session, href, width, height }: PhotoContext): PhotoMetadata {
  const { hold } = item;
  const name = asana?.name ?? 'Asana';
  const side = hold.side ? SIDE[hold.side] : undefined;
  const caption = [name, side, item.reps > 1 ? `rep ${item.rep} of ${item.reps}` : undefined].filter(Boolean).join(' · ');
  const meta = (video?.meta ?? {}) as Record<string, unknown>;
  const loc = meta.location as { lat?: unknown; lon?: unknown; altM?: unknown } | null | undefined;
  const lat = num(loc?.lat) ?? num(session?.location?.lat);
  const lon = num(loc?.lon) ?? num(session?.location?.lon);
  const fromVideo = num(loc?.lat) !== null && num(loc?.lon) !== null;
  const takenAt = (video?.recordedAt && localTimeAt(video.recordedAt, hold.bestS)) || (session?.date ? localTimeAt(session.date) : null);
  const note = str(session?.note);
  const place = str(session?.location?.name);
  const out: PhotoMetadata = {
    title: name,
    description: [caption, place, note].filter(Boolean).join(' · '),
    keywords: [name, asana?.group, side, 'yoga', 'asana-progression'].filter((k): k is string => !!k),
    creatorTool: 'asana-progression',
    url: asanaLink(hold.asanaId, href),
    width,
    height,
  };
  if (takenAt) out.takenAt = takenAt;
  if (lat !== null && lon !== null) out.gps = { lat, lon, altM: fromVideo ? num(loc?.altM) : null };
  const make = str(meta.make);
  const model = str(meta.model);
  if (make) out.make = make;
  if (model) out.model = model;
  if (place) out.place = place;
  return out;
}
