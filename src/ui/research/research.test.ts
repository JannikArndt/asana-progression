import { describe, expect, it } from 'vitest';
import { analyzeFrames, DEFAULT_PARAMS, findCandidates, type DetectionParams, type GrayFrame } from '../../detection';
import { POSES, synthesize, type Segment } from '../../detection/__fixtures__/synthetic';
import { expandGrid } from '../../labeling';
import type { Analysis, Asana, Asset, Hold, SequenceTemplate, Session, Video } from '../../model';
import type { Landmark, PoseDetection } from '../../crop';
import { decodeFloat16, encodeFloat16, fromFloat16Bits, toFloat16Bits } from '../../model';
import { buildResearchExport, isFullyLabeled, RESEARCH_FORMAT, type ResearchDeps, type ResearchSource, type StoredFrames } from './export';
import { DEFAULT_LAB_GRID, gridText, labReport, runLab, type LabVideo } from './lab';

describe('float16', () => {
  it('round-trips with half precision and keeps special values', () => {
    for (const v of [0, 1, -2, 0.1, 3.1249, 65504, 1e-5, 6e-8, -0.33333]) {
      const back = fromFloat16Bits(toFloat16Bits(v));
      expect(Math.abs(back - v)).toBeLessThanOrEqual(Math.max(Math.abs(v) * 2 ** -11, 2 ** -25));
    }
    expect(fromFloat16Bits(toFloat16Bits(NaN))).toBeNaN();
    expect(fromFloat16Bits(toFloat16Bits(Infinity))).toBe(Infinity);
    expect(fromFloat16Bits(toFloat16Bits(-1e9))).toBe(-Infinity);
    expect(fromFloat16Bits(toFloat16Bits(1e-9))).toBe(0);
    // Ties round to even: 2049 lies halfway between 2048 and 2050.
    expect(fromFloat16Bits(toFloat16Bits(2049))).toBe(2048);
    expect(fromFloat16Bits(toFloat16Bits(2051))).toBe(2052);
    // Subnormal rounding up into the smallest normal number.
    expect(fromFloat16Bits(toFloat16Bits(2 ** -14 * 0.99999))).toBe(2 ** -14);
    expect(fromFloat16Bits(toFloat16Bits(3 * 2 ** -25))).toBe(2 ** -23);
    const values = Float32Array.from([1.5, NaN, -0.25, 12.345]);
    const back = decodeFloat16(encodeFloat16(values));
    expect(back.length).toBe(4);
    expect(back[1]).toBeNaN();
    expect(back[3]).toBeCloseTo(12.345, 2);
  });
});

// ---- a small library: two sessions, three videos ---------------------------------------------

const SEGMENTS: Segment[] = [
  { kind: 'move', seconds: 4, to: POSES.standing },
  { kind: 'hold', seconds: 20, pose: POSES.standing, sway: 0.2 },
  { kind: 'move', seconds: 5, to: POSES.triangle },
  { kind: 'hold', seconds: 20, pose: POSES.triangle, sway: 0.3 },
  { kind: 'move', seconds: 5, to: POSES.seated },
  { kind: 'hold', seconds: 25, pose: POSES.seated, sway: 0.2 },
  { kind: 'move', seconds: 5, to: POSES.forwardFold },
  { kind: 'hold', seconds: 15, pose: POSES.forwardFold, sway: 0.2 },
  { kind: 'move', seconds: 5, to: POSES.standing },
];

const SECRET = { fileName: 'IMG_4711-secret.MOV', note: 'my private note', lat: 52.520008, lon: 13.404954, place: 'Secret Garden' };

interface Lib {
  src: ResearchSource;
  frames: Map<string, GrayFrame[]>;
}

async function library(): Promise<Lib> {
  const frames = new Map<string, GrayFrame[]>();
  const videos: Video[] = [];
  const analyses: Analysis[] = [];
  const holds: Hold[] = [];
  const assets: Asset[] = [];
  const asanaIds = ['samasthitih', 'trikonasana', 'dandasana', 'paschimottanasana-a'];
  const make = async (id: string, sessionId: string, seed: number, labeled: boolean, params: DetectionParams = { ...DEFAULT_PARAMS }) => {
    const video = synthesize(POSES.standing, SEGMENTS, { seed });
    frames.set(id, video.frames);
    const { signals, result } = await analyzeFrames(video.frames, params);
    const candidates = result.candidates.map((c, i) => {
      if (!labeled) return { ...c, origin: 'detected' as const };
      const holdId = `${id}-h${i}`;
      holds.push({
        id: holdId,
        sessionId,
        videoId: id,
        asanaId: asanaIds[i % asanaIds.length]!,
        side: i === 1 ? 'R' : null,
        startS: c.startS,
        endS: c.endS,
        bestS: c.bestS,
        clipStartS: c.clipStartS,
        clipEndS: c.clipEndS,
        templateEntryIndex: i,
        crop: { auto: { x: 0.1, y: 0.2, w: 0.5, h: 0.6 }, autoVersion: 2, ...(i === 0 ? { manual: { x: 0.05, y: 0.1, w: 0.7, h: 0.8 } } : {}) },
      });
      if (i < 2) {
        assets.push({ id: `${holdId}-still`, holdId, kind: 'still', mime: 'image/jpeg', width: 1920, height: 1080, bytes: 1, storageKey: `assets/${holdId}.jpg`, atS: c.bestS, createdAt: '2026-01-01' });
      }
      return { ...c, status: 'labeled' as const, holdId, origin: 'detected' as const };
    });
    videos.push({
      id,
      fingerprint: `fp-${id}`,
      fileName: SECRET.fileName,
      fileSize: 123,
      durationS: video.frames.length / 4,
      codec: 'hevc',
      width: 1920,
      height: 1080,
      fps: 30,
      recordedAt: '2025-04-03T07:12:00+02:00',
      importedAt: '2026-01-01T00:00:00Z',
      meta: { fileName: SECRET.fileName, location: { lat: SECRET.lat, lon: SECRET.lon } },
    });
    analyses.push({
      videoId: id,
      params,
      sampleHz: 4,
      frameWidth: video.frames[0]!.width,
      frameHeight: video.frames[0]!.height,
      sampleCount: video.frames.length,
      m: signals.m,
      C: signals.C,
      threshold: result.threshold,
      singleStill: result.singleStill,
      candidates,
      preMerge: result.preMerge,
      createdAt: '2026-01-01',
      stats: null,
    });
  };
  await make('v1', 's1', 1, true);
  await make('v2', 's2', 2, true, { ...DEFAULT_PARAMS, changeWindowS: 3 });
  await make('v3', 's3', 3, false);
  const sessions: Session[] = [
    { id: 's1', date: '2025-04-03T07:12:00+02:00', note: SECRET.note, videoIds: ['v1'], templateId: 't1', location: { name: SECRET.place, lat: SECRET.lat, lon: SECRET.lon } },
    { id: 's2', date: '2026-09-01T07:00:00+02:00', note: SECRET.note, videoIds: ['v2'] },
    { id: 's3', date: '2026-10-01T07:00:00+02:00', note: '', videoIds: ['v3'] },
  ];
  const asanas: Asana[] = asanaIds.map((id) => ({ id, name: id, sided: id === 'trikonasana', group: 'Standing' }));
  const templates: SequenceTemplate[] = [{ id: 't1', name: 'Test', entries: asanaIds.map((asanaId) => ({ asanaId })) }];
  return { src: { asanas, templates, sessions, videos, analyses, holds, assets }, frames };
}

function stored(frames: GrayFrame[]): StoredFrames {
  return { count: frames.length, frame: (i) => frames[i]!.data };
}

const landmarks = (n: number, z: boolean): Landmark[] =>
  Array.from({ length: n }, (_, i) => ({ x: 0.3 + (i % 5) * 0.05, y: 0.2 + Math.floor(i / 5) * 0.08, ...(z ? { z: -0.1 * i } : {}), visibility: i === 7 ? 0.1 : 0.9 }));

function deps(lib: Lib, overrides: Partial<ResearchDeps> = {}): ResearchDeps {
  const detection: PoseDetection = {
    box: { x: 0.2, y: 0.1, w: 0.4, h: 0.7, score: 0.87654321 },
    posture: 'standing',
    landmarks: landmarks(33, true),
    worldLandmarks: landmarks(33, true),
  };
  return {
    frames: async (a) => {
      const f = lib.frames.get(a.videoId);
      return f ? stored(f) : null;
    },
    pose: async () => ({ detection, width: 640, height: 360, cropper: 'mediapipe-pose' }),
    app: { version: 'test', builtAt: '2026-10-12T00:00:00Z' },
    now: new Date('2026-10-12T12:00:00Z'),
    ...overrides,
  };
}

describe('research export', () => {
  it('holds no file names, notes, places, coordinates or frames', async () => {
    const lib = await library();
    const x = await buildResearchExport(lib.src, deps(lib));
    const json = JSON.stringify(x);
    for (const secret of [SECRET.fileName, SECRET.note, SECRET.place, String(SECRET.lat), String(SECRET.lon), 'IMG_', 'fingerprint', 'fp-v1']) {
      expect(json).not.toContain(secret);
    }
    for (const key of ['"fileName"', '"note"', '"location"', '"lat"', '"lon"', '"meta"', '"frames"', '"storageKey"']) expect(json).not.toContain(key);
    // No pooled frame in any encoding: the only long strings are the float16 signals.
    const strings = [...json.matchAll(/"([A-Za-z0-9+/=]{200,})"/g)].map((m) => m[1]!);
    expect(strings.length).toBe(2 * x.analyses.filter((a) => a.signals).length);
    expect(x.sessions[0]).toEqual({ id: 's1', date: '2025-04-03', templateId: 't1', videoIds: ['v1'], fullyLabeled: true });
    expect(x.videos[0]).toEqual({ id: 'v1', durationS: lib.src.videos[0]!.durationS, width: 1920, height: 1080, fps: 30, codec: 'hevc', recordedAt: '2025-04-03T07:12:00+02:00' });
    expect(x).toMatchObject({ format: RESEARCH_FORMAT, version: 1, exportedAt: '2026-10-12T12:00:00.000Z', cropper: 'mediapipe-pose', app: { version: 'test' } });
    expect(x.catalog[1]).toEqual({ id: 'trikonasana', name: 'trikonasana', sided: true, group: 'Standing', posture: null });
    expect(x.templates).toEqual(lib.src.templates);
  });

  it('re-runs detection with the defaults on the stored frames, with the merge inputs and a score', async () => {
    const lib = await library();
    const x = await buildResearchExport(lib.src, deps(lib));
    const [a1, a2, a3] = x.analyses;
    // Stored signals with the default signal parameters are used as they are.
    expect(a1!.signals!.from).toBe('stored');
    const m = decodeFloat16(a1!.signals!.m);
    const orig = lib.src.analyses[0]!.m;
    for (let i = 0; i < m.length; i++) expect(Math.abs(m[i]! - orig[i]!)).toBeLessThanOrEqual(Math.abs(orig[i]!) * 2 ** -10 + 1e-7);
    const again = await findCandidates({ sampleHz: 4, m: orig, C: lib.src.analyses[0]!.C }, stored(lib.frames.get('v1')!), DEFAULT_PARAMS);
    expect(a1!.fresh!.candidates.map((c) => [c.startS, c.endS, c.bestS])).toEqual(again.candidates.map((c) => [c.startS, c.endS, c.bestS]));
    expect(a1!.fresh!.mergeInputs.length).toBe((a1!.fresh!.preMerge.length * (a1!.fresh!.preMerge.length - 1)) / 2);
    expect(a1!.fresh!.mergeInputs[0]).toMatchObject({ a: 0, b: 1, diff: expect.any(Number), gapMaxM: expect.any(Number) });
    // Another signal window: the signals are recomputed with the defaults.
    expect(a2!.params.changeWindowS).toBe(3);
    expect(a2!.signals!.from).toBe('recomputed');
    expect(a1!.candidates[0]).toMatchObject({ status: 'labeled', origin: 'detected', holdId: 'v1-h0' });
    expect(a3!.candidates[0]).toMatchObject({ status: 'open', holdId: null });
    expect([a1!.fullyLabeled, a2!.fullyLabeled, a3!.fullyLabeled]).toEqual([true, true, false]);
    expect(x.summary.videos[0]!.defaults).toMatchObject({ holds: 4, own: 4, editCost: 0 });
    expect(x.summary.videos[2]!.defaults).toMatchObject({ holds: 0, falsePos: 4 });
    expect(x.summary.fullyLabeled).toMatchObject({ holds: 8, missed: 0 });
  });

  it('describes holds with reps, crops and the pose at the still', async () => {
    const lib = await library();
    lib.src.holds.push({ ...lib.src.holds[3]!, id: 'v1-h4', startS: 200, endS: 210, bestS: 205 });
    const x = await buildResearchExport(lib.src, deps(lib));
    const h0 = x.holds.find((h) => h.id === 'v1-h0')!;
    expect(h0).toMatchObject({ sessionId: 's1', asanaId: 'samasthitih', side: null, templateEntryIndex: 0, rep: 1, reps: 1, poseStatus: 'ok' });
    expect(h0.crop).toEqual({ auto: { x: 0.1, y: 0.2, w: 0.5, h: 0.6 }, manual: { x: 0.05, y: 0.1, w: 0.7, h: 0.8 }, autoVersion: 2 });
    expect(h0.still).toEqual({ width: 1920, height: 1080, atS: h0.bestS });
    expect(h0.pose!.landmarks.length).toBe(33);
    expect(h0.pose!.landmarks[1]).toEqual([0.35, 0.2, -0.1, 0.9]);
    expect(h0.pose!.world!.length).toBe(33);
    expect(h0.pose!.box.score).toBe(0.8765);
    expect(h0.pose!.preview).toEqual({ width: 640, height: 360 });
    // The box from every landmark includes the low-visibility one.
    expect(h0.pose!.boxAll).not.toBeNull();
    // Two consecutive holds of the same asana are reps 1 and 2.
    expect(x.holds.filter((h) => h.id === 'v1-h3' || h.id === 'v1-h4').map((h) => [h.rep, h.reps])).toEqual([
      [1, 2],
      [2, 2],
    ]);
    expect(x.holds.find((h) => h.id === 'v1-h2')).toMatchObject({ pose: null, poseStatus: 'no-still', still: null });
  });

  it('reports missing frames, missing bodies, no model and pose errors', async () => {
    const lib = await library();
    let call = 0;
    const statuses = ['no-body', 'no-model', 'error'] as const;
    const x = await buildResearchExport(
      lib.src,
      deps(lib, {
        frames: async (a) => {
          if (a.videoId === 'v2') throw new Error('locked');
          return a.videoId === 'v1' ? null : stored(lib.frames.get(a.videoId)!);
        },
        pose: async () => {
          const s = statuses[call++ % 3];
          if (s === 'error') throw new Error('boom');
          return { detection: null, width: 640, height: 360, cropper: s === 'no-model' ? 'none' : 'mediapipe-pose' };
        },
      }),
    );
    expect(x.analyses[0]).toMatchObject({ fresh: null, freshError: expect.stringMatching(/not stored/) });
    // The stored signals have the default parameters: they are exported anyway.
    expect(x.analyses[0]!.signals!.from).toBe('stored');
    // Other signal parameters and no frames: no signals.
    expect(x.analyses[1]!.signals).toBeNull();
    expect(x.summary.videos[0]!.defaults).toBeNull();
    expect(x.holds.filter((h) => h.still).map((h) => h.poseStatus)).toEqual(['no-body', 'no-model', 'error', 'no-body']);
    expect(x.cropper).toBe('mediapipe-pose');
    expect(x.summary.fullyLabeled).toBeNull();
    const failing = await buildResearchExport(lib.src, deps(lib, { frames: async (a) => ({ count: 5, frame: () => { throw new Error(`no frame ${a.videoId}`); } }) }));
    expect(failing.analyses[0]!.freshError).toMatch(/no frame v1/);
  });

  it('reports progress per analysis and hold', async () => {
    const lib = await library();
    const seen: string[] = [];
    await buildResearchExport(lib.src, deps(lib, { onProgress: (phase, done, total) => seen.push(`${phase} ${done}/${total}`) }));
    expect(seen[0]).toBe('analyses 0/3');
    expect(seen).toContain('analyses 3/3');
    expect(seen.at(-1)).toBe(`poses ${lib.src.holds.length}/${lib.src.holds.length}`);
  });

  it('fully labeled = no open candidate and at least one labeled', () => {
    const c = (status: 'open' | 'labeled' | 'dismissed') => ({ status }) as Analysis['candidates'][number];
    expect(isFullyLabeled({ candidates: [c('labeled'), c('dismissed')] })).toBe(true);
    expect(isFullyLabeled({ candidates: [c('labeled'), c('open')] })).toBe(false);
    expect(isFullyLabeled({ candidates: [c('dismissed')] })).toBe(false);
    expect(isFullyLabeled({ candidates: [] })).toBe(false);
  });
});

describe('detection lab', () => {
  async function labVideos(lib: Lib): Promise<LabVideo[]> {
    return lib.src.analyses
      .filter(isFullyLabeled)
      .map((a) => ({
        videoId: a.videoId,
        sessionId: lib.src.sessions.find((s) => s.videoIds.includes(a.videoId))!.id,
        holds: lib.src.holds.filter((h) => h.videoId === a.videoId),
        analysis: a,
        load: async () => stored(lib.frames.get(a.videoId)!),
      }));
  }

  it('scores every combination per video, ranks them and picks per held-out session', async () => {
    const lib = await library();
    const videos = await labVideos(lib);
    const combos = expandGrid({ vary: { minHoldS: [6, 30], changeWindowS: [4, 3] } });
    const progress: string[] = [];
    const result = await runLab(videos, combos, { onProgress: (p) => progress.push(`${p.video}:${p.combo}`) });
    expect(result.videos.map((v) => v.videoId)).toEqual(['v1', 'v2']);
    expect(result.scores.length).toBe(4);
    expect(result.reference.map((s) => s.editCost)).toEqual([0, 0]);
    expect(progress.at(-1)).toBe('2:4');
    const report = labReport(result, { vary: { minHoldS: [6, 30], changeWindowS: [4, 3] } }, { now: new Date(0) });
    expect(report.sessions).toEqual(['s1', 's2']);
    expect(report.combos[0]!.diff).toEqual({});
    expect(report.combos[3]!.diff).toEqual({ minHoldS: 30, changeWindowS: 3 });
    expect(report.ranking[0]).toBe(0);
    expect(report.reference.perSession).toEqual({ s1: 0, s2: 0 });
    expect(report.loso.map((l) => [l.session, l.defaultCost])).toEqual([
      ['s1', 0],
      ['s2', 0],
    ]);
    // Holds of 15–25 s are all missed with a minimum hold of 30 s.
    expect(report.combos[2]!.total).toMatchObject({ missed: 8, editCost: 16 });
    expect(report.ranking.slice(2).sort()).toEqual([2, 3]);
    const json = JSON.stringify(report);
    expect(json).not.toContain(SECRET.fileName);
    expect(json).not.toContain(SECRET.note);
  });

  it('skips videos without stored frames and stops when aborted', async () => {
    const lib = await library();
    const videos = await labVideos(lib);
    videos[0]!.load = async () => null;
    const result = await runLab(videos, expandGrid({ vary: {} }));
    expect(result.skipped).toEqual([{ videoId: 'v1', reason: expect.stringMatching(/not stored/) }]);
    expect(result.videos.length).toBe(1);
    const abort = new AbortController();
    abort.abort();
    await expect(runLab(videos, expandGrid({ vary: {} }), { signal: abort.signal })).rejects.toThrow();
  });

  it('the prefilled grid is valid and small enough to run on a phone', () => {
    const combos = expandGrid(DEFAULT_LAB_GRID);
    expect(combos.length).toBe(144);
    expect(combos[0]).toEqual({ ...DEFAULT_PARAMS, stillPercentile: 50, similarMergeFactor: 1.5, stillPercentileExit: 55 });
  });
});

describe('gridText', () => {
  it('writes one line per parameter and parses back', () => {
    const text = gridText(DEFAULT_LAB_GRID);
    expect(text.split('\n')).toContain('    "stillPercentile": [50, 55, 60],');
    expect(JSON.parse(text)).toEqual(DEFAULT_LAB_GRID);
    const other = { base: { minHoldS: 8 }, vary: { thresholdMode: ['rolling'] } };
    expect(JSON.parse(gridText(other))).toEqual(other);
    expect(gridText({ vary: {} })).toBe('{\n  "base": {},\n  "vary": {}\n}');
  });
});
