import type { Video } from '../../model';

/** What a picked file is: one of the imported videos, a converted copy of one, or none of them. */
export type FileMatch =
  | { file: File; kind: 'video'; video: Video }
  | { file: File; kind: 'converted'; video: Video }
  | { file: File; kind: 'unknown' }
  | { file: File; kind: 'unreadable'; error: string };

export interface MatchDeps {
  fingerprint(file: Blob, durationS: number): Promise<string>;
  /** Duration and recording time read from the file (only for files no imported video has the size of). */
  probe(file: File): Promise<{ durationS: number; recordedAt: string | null }>;
}

/** Same length within this many seconds: a converted copy (re-encoded, other container) keeps it. */
export const CONVERTED_DURATION_S = 0.5;

function stem(name: string): string {
  return name.replace(/\.[^.]*$/, '').toLowerCase();
}

/** Recording times equal to the minute (a converted copy keeps the creation date). */
function sameMinute(a: string | null, b: string | null): boolean {
  return !!a && !!b && a.slice(0, 16) === b.slice(0, 16);
}

/**
 * Finds the imported video of every picked file. Fast path: only videos of the file's size are
 * fingerprinted, with their stored duration (reads 8 MiB, no demuxing), so a session's files can
 * be picked in any order and files of other sizes cost nothing. Otherwise the file is opened: its
 * own fingerprint (exact match), else a video of the same length and recording time or name is a
 * converted copy (the Photos picker may re-encode unless its format is "Current"). Each video
 * matches one file at most.
 */
export async function matchFiles(files: File[], videos: Video[], deps: MatchDeps): Promise<FileMatch[]> {
  const out: FileMatch[] = [];
  const taken = new Set<string>();
  const free = () => videos.filter((v) => !taken.has(v.id));
  for (const file of files) {
    const m = await matchFile(file, free(), deps);
    if (m.kind === 'video' || m.kind === 'converted') taken.add(m.video.id);
    out.push(m);
  }
  return out;
}

async function matchFile(file: File, videos: Video[], deps: MatchDeps): Promise<FileMatch> {
  try {
    for (const v of videos) {
      if (v.fileSize === file.size && (await deps.fingerprint(file, v.durationS)) === v.fingerprint) return { file, kind: 'video', video: v };
    }
    const meta = await deps.probe(file);
    const fp = await deps.fingerprint(file, meta.durationS);
    const exact = videos.find((v) => v.fingerprint === fp);
    if (exact) return { file, kind: 'video', video: exact };
    const alike = videos
      .filter((v) => Math.abs(v.durationS - meta.durationS) <= CONVERTED_DURATION_S)
      .filter((v) => sameMinute(v.recordedAt, meta.recordedAt) || stem(v.fileName) === stem(file.name))
      .sort((a, b) => Math.abs(a.durationS - meta.durationS) - Math.abs(b.durationS - meta.durationS))[0];
    return alike ? { file, kind: 'converted', video: alike } : { file, kind: 'unknown' };
  } catch (err) {
    return { file, kind: 'unreadable', error: err instanceof Error ? err.message : String(err) };
  }
}

/** Joins names: "a", "a and b", "a, b and c". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * One line about a pick: what was attached, what was not, and why. `expected`: the videos the
 * screen asked for (others that matched are named as such).
 */
export function attachSummary(attached: Video[], rest: FileMatch[], expected: Set<string>): string {
  const parts: string[] = [];
  const asked = attached.filter((v) => expected.has(v.id));
  const other = attached.filter((v) => !expected.has(v.id));
  if (asked.length) parts.push(`Selected ${joinNames(asked.map((v) => v.fileName))}.`);
  if (other.length) parts.push(`Also selected ${joinNames(other.map((v) => v.fileName))} (${other.length === 1 ? 'a video' : 'videos'} of another session).`);
  const unknown = rest.filter((m) => m.kind === 'unknown');
  if (unknown.length === 1) parts.push(`${unknown[0]!.file.name} is not one of the imported videos.`);
  else if (unknown.length > 1) parts.push(`${unknown.length} files are not among the imported videos.`);
  for (const m of rest) {
    if (m.kind === 'converted') parts.push(`The converted copy ${m.file.name} was not used.`);
    else if (m.kind === 'unreadable') parts.push(`Cannot read ${m.file.name}: ${m.error}`);
  }
  return parts.join(' ') || 'No file selected.';
}

/**
 * Date to type into the Photos search (it finds photos and videos by date): the recording's own
 * calendar date when the time carries its UTC offset, else the local date, in the device's
 * language ("October 14, 2026", "14. Oktober 2026").
 */
export function photosSearchDate(iso: string | null | undefined, locale?: string): string {
  if (!iso) return '';
  let day = /[+-]\d\d:?\d\d$/.test(iso) || /^\d{4}-\d\d-\d\d$/.test(iso) ? iso.slice(0, 10) : '';
  if (!day) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  const noon = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(noon.getTime())) return '';
  return noon.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** Wall-clock time of a recording ("07:12"): its own when it carries an offset, else local. */
export function recordedClock(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^\d{4}-\d\d-\d\dT(\d\d:\d\d)(?::\d\d(?:\.\d+)?)?([+-]\d\d:?\d\d)$/.exec(iso);
  if (m) return m[1]!;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || !iso.includes('T')) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
