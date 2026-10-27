import { describe, expect, it } from 'vitest';
import { asanaLink, holdPhotoMetadata, localTimeAt } from './photo-meta';
import type { Asana, Hold, Session, Video } from '../../model';
import type { ProgressionItem } from '../../progression';

describe('localTimeAt', () => {
  it('adds seconds in the time’s own offset', () => {
    expect(localTimeAt('2026-10-14T07:30:00+0200', 65.25)).toEqual({ local: '2026-10-14T07:31:05.250', offset: '+02:00' });
    expect(localTimeAt('2026-10-14T23:59:30-05:30', 45)).toEqual({ local: '2026-10-15T00:00:15', offset: '-05:30' });
    expect(localTimeAt('2026-10-14T05:00:00.5Z', 0.5)).toEqual({ local: '2026-10-14T05:00:01', offset: '+00:00' });
    expect(localTimeAt('2026-10-14T07:30', 1)).toEqual({ local: '2026-10-14T07:30:01' });
    expect(localTimeAt('yesterday')).toBeNull();
  });
});

describe('holdPhotoMetadata', () => {
  const hold: Hold = { id: 'h', sessionId: 's', videoId: 'v', asanaId: 'navasana', side: null, startS: 60, endS: 90, bestS: 75, clipStartS: 70, clipEndS: 74, crop: {} };
  const item = { hold, date: '2026-10-14T07:00:00+02:00', note: '', still: undefined, thumb: undefined, clip: undefined, rep: 2, reps: 5 } as ProgressionItem;
  const asana = { id: 'navasana', name: 'Navasana', group: 'Seated', sided: false } as Asana;
  const session: Session = { id: 's', date: '2026-10-14T07:00:00+02:00', note: 'windy', videoIds: ['v'], location: { name: 'Park', lat: 1, lon: 2 } };
  const video = {
    id: 'v',
    recordedAt: '2026-10-14T07:00:00+02:00',
    meta: { make: 'Apple', model: 'iPhone 15', location: { lat: 52.5, lon: 13.4, altM: 34 } },
  } as unknown as Video;
  const href = 'https://example.org/asana-progression/#/session/s/poses';

  it('collects name, rep, time, place, camera and link', () => {
    expect(holdPhotoMetadata({ item, asana, video, session, href, width: 800, height: 1200 })).toEqual({
      title: 'Navasana',
      description: 'Navasana · rep 2 of 5 · Park · windy',
      keywords: ['Navasana', 'Seated', 'yoga', 'asana-progression'],
      creatorTool: 'asana-progression',
      url: 'https://example.org/asana-progression/#/asana/navasana',
      width: 800,
      height: 1200,
      takenAt: { local: '2026-10-14T07:01:15', offset: '+02:00' },
      gps: { lat: 52.5, lon: 13.4, altM: 34 },
      make: 'Apple',
      model: 'iPhone 15',
      place: 'Park',
    });
  });

  it('falls back to the session’s coordinates and date', () => {
    const m = holdPhotoMetadata({ item: { ...item, rep: 1, reps: 1, hold: { ...hold, side: 'L' } }, asana, video: undefined, session, href, width: 1, height: 1 });
    expect(m.gps).toEqual({ lat: 1, lon: 2, altM: null });
    expect(m.takenAt).toEqual({ local: '2026-10-14T07:00:00', offset: '+02:00' });
    expect(m.description).toBe('Navasana · Left · Park · windy');
    expect(m.make).toBeUndefined();
    const bare = holdPhotoMetadata({ item, asana: undefined, video: undefined, session: undefined, href, width: 1, height: 1 });
    expect(bare.gps).toBeUndefined();
    expect(bare.takenAt).toBeUndefined();
    expect(bare.title).toBe('Asana');
  });

  it('links to the asana page of this deployment', () => {
    expect(asanaLink('a b', 'http://localhost:4173/asana-progression/')).toBe('http://localhost:4173/asana-progression/#/asana/a%20b');
  });
});
