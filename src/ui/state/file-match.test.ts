import { describe, expect, it, vi } from 'vitest';
import type { Video } from '../../model';
import { fingerprint } from '../../source';
import { attachSummary, joinNames, matchFiles, photosSearchDate, recordedClock, type FileMatch, type MatchDeps } from './file-match';

function file(name: string, size: number, seed: number): File {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 31 + seed) & 0xff;
  return new File([bytes], name);
}

async function videoOf(id: string, f: File, durationS: number, recordedAt: string | null = null): Promise<Video> {
  return {
    id,
    fingerprint: await fingerprint(f, durationS),
    fileName: f.name,
    fileSize: f.size,
    durationS,
    codec: null,
    width: 1,
    height: 1,
    fps: null,
    recordedAt,
    importedAt: '',
  };
}

function deps(meta: Record<string, { durationS: number; recordedAt: string | null }> = {}): MatchDeps & { probe: ReturnType<typeof vi.fn> } {
  return {
    fingerprint,
    probe: vi.fn(async (f: File) => {
      const m = meta[f.name];
      if (!m) throw new Error('not a video');
      return m;
    }),
  };
}

describe('matchFiles', () => {
  it('matches files to videos in any order without opening them', async () => {
    const a = file('IMG_1.MOV', 3000, 1);
    const b = file('IMG_2.MOV', 5000, 2);
    const videos = [await videoOf('va', a, 600), await videoOf('vb', b, 1200)];
    const d = deps();
    const out = await matchFiles([b, a], videos, d);
    expect(out.map((m) => (m.kind === 'video' ? m.video.id : m.kind))).toEqual(['vb', 'va']);
    expect(d.probe).not.toHaveBeenCalled();
  });

  it('tells same-size files apart by their content', async () => {
    const a = file('a.mov', 4000, 1);
    const b = file('b.mov', 4000, 2);
    const videos = [await videoOf('va', a, 60), await videoOf('vb', b, 60)];
    const out = await matchFiles([b], videos, deps());
    expect(out[0]).toMatchObject({ kind: 'video', video: { id: 'vb' } });
  });

  it('falls back to the full fingerprint when the stored size differs', async () => {
    const a = file('a.mov', 2000, 1);
    const v = { ...(await videoOf('va', a, 90)), fileSize: 1 };
    const d = deps({ 'a.mov': { durationS: 90, recordedAt: null } });
    const out = await matchFiles([a], [v], d);
    expect(out[0]).toMatchObject({ kind: 'video', video: { id: 'va' } });
    expect(d.probe).toHaveBeenCalledOnce();
  });

  it('recognises a converted copy by length plus recording time or name', async () => {
    const original = file('IMG_7.MOV', 6000, 1);
    const v = await videoOf('v7', original, 1800.2, '2026-10-14T07:12:30+02:00');
    const byTime = file('export.mp4', 1500, 9);
    const byName = file('img_7.mp4', 1600, 8);
    const other = file('IMG_8.MOV', 1700, 7);
    const d = deps({
      'export.mp4': { durationS: 1800, recordedAt: '2026-10-14T07:12:59+02:00' },
      'img_7.mp4': { durationS: 1800.4, recordedAt: null },
      'IMG_8.MOV': { durationS: 1800.2, recordedAt: '2026-10-14T09:00:00+02:00' },
    });
    expect((await matchFiles([byTime], [v], d))[0]).toMatchObject({ kind: 'converted', video: { id: 'v7' } });
    expect((await matchFiles([byName], [v], d))[0]).toMatchObject({ kind: 'converted', video: { id: 'v7' } });
    expect((await matchFiles([other], [v], d))[0]).toMatchObject({ kind: 'unknown' });
    const longer = deps({ 'export.mp4': { durationS: 1801, recordedAt: '2026-10-14T07:12:59+02:00' } });
    expect((await matchFiles([byTime], [v], longer))[0]).toMatchObject({ kind: 'unknown' });
  });

  it('gives each video to one file only and reports unreadable files', async () => {
    const a = file('a.mov', 1000, 1);
    const v = await videoOf('va', a, 30);
    const twice = new File([a], 'a copy.mov');
    const out = await matchFiles([a, twice, file('notes.txt', 10, 3)], [v], deps({ 'a copy.mov': { durationS: 30, recordedAt: null } }));
    expect(out.map((m) => m.kind)).toEqual(['video', 'unknown', 'unreadable']);
    expect(out[2]).toMatchObject({ error: 'not a video' });
  });
});

describe('attachSummary', () => {
  const v = (id: string, fileName: string) => ({ id, fileName }) as Video;
  const f = (name: string) => new File([], name);
  it('names what was selected and what was not', () => {
    const rest: FileMatch[] = [
      { file: f('x.mov'), kind: 'unknown' },
      { file: f('y.mp4'), kind: 'converted', video: v('v9', 'Y.MOV') },
      { file: f('z.txt'), kind: 'unreadable', error: 'bad' },
    ];
    expect(attachSummary([v('v1', 'A.MOV'), v('v2', 'B.MOV'), v('v3', 'C.MOV')], rest, new Set(['v1', 'v2']))).toBe(
      'Selected A.MOV and B.MOV. Also selected C.MOV (a video of another session). x.mov is not one of the imported videos. ' +
        'The converted copy y.mp4 was not used. Cannot read z.txt: bad',
    );
    expect(attachSummary([v('v3', 'C'), v('v4', 'D')], [{ file: f('p'), kind: 'unknown' }, { file: f('q'), kind: 'unknown' }], new Set())).toBe(
      'Also selected C and D (videos of another session). 2 files are not among the imported videos.',
    );
    expect(attachSummary([], [], new Set())).toBe('No file selected.');
  });
  it('joins names', () => {
    expect(joinNames([])).toBe('');
    expect(joinNames(['a'])).toBe('a');
    expect(joinNames(['a', 'b', 'c'])).toBe('a, b and c');
  });
});

describe('photosSearchDate', () => {
  it("uses the recording's own date when the time carries an offset", () => {
    expect(photosSearchDate('2026-10-14T23:30:00+02:00', 'en-US')).toBe('October 14, 2026');
    expect(photosSearchDate('2026-10-14T00:10:00-0500', 'en-GB')).toBe('14 October 2026');
    expect(photosSearchDate('2026-10-14', 'de-DE')).toBe('14. Oktober 2026');
  });
  it('uses the local date for UTC times and nothing for unknown ones', () => {
    const iso = '2026-10-14T12:00:00Z';
    const d = new Date(iso);
    expect(photosSearchDate(iso, 'en-US')).toBe(
      new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12)).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }),
    );
    expect(photosSearchDate(null)).toBe('');
    expect(photosSearchDate('soon')).toBe('');
  });
});

describe('recordedClock', () => {
  it('shows the wall-clock time', () => {
    expect(recordedClock('2026-10-14T07:12:30+02:00')).toBe('07:12');
    expect(recordedClock('2026-10-14T07:12:30.5-0500')).toBe('07:12');
    expect(recordedClock('2026-10-14T07:12:30Z')).toMatch(/^\d\d:12$/);
    expect(recordedClock('2026-10-14')).toBe('');
    expect(recordedClock('later')).toBe('');
    expect(recordedClock(undefined)).toBe('');
  });
});
