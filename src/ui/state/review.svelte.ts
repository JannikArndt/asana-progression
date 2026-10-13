import {
  alignToTemplate,
  detectInRange,
  freeSpanAround,
  holdFromCandidate,
  matchTemplateEntry,
  mergeCandidates,
  missedCandidate,
  nudgeBest,
  reconcile,
  sortCandidates,
  splitCandidate,
  splitInto,
  type Label,
  type SignalView,
  type Suggestion,
  type TimeRange,
} from '../../labeling';
import type { DetectionParams } from '../../detection';
import { newId, poseKey, type Analysis, type Hold, type ReviewCandidate, type Session, type Video } from '../../model';
import { app } from './app.svelte';
import { dialog } from './dialog.svelte';
import {
  combineSessions,
  historyFrom,
  itemKey,
  parseItemKey,
  sameDaySessions,
  sessionEntries,
  toReviewItems,
  unnamedNear,
  withPlaceName,
  type SessionEntry,
} from './session-data';
import { suggestInWorker } from '../workers/suggest-client';
import { pipeline } from '../pipeline/controller.svelte';
import { invalidateSamples, sampleReader } from './samples';
import { capture, deleteAssets } from './capture.svelte';

/**
 * State and actions of the session review screen. Every action persists immediately
 * (IndexedDB), so there is never unsaved labeling state.
 */
export class SessionReview {
  private sessionId = $state<string | null>(null);
  /** The session as the app state holds it: edits made elsewhere (e.g. coordinates read from a re-attached file) show up here. */
  session = $derived<Session | null>(this.sessionId ? (app.sessions.find((s) => s.id === this.sessionId) ?? null) : null);
  videos = $state.raw<Video[]>([]);
  analyses = $state.raw<Record<string, Analysis>>({});
  /** Holds of this session — read from the app state, the single source of truth (captures update crops there). */
  holds = $derived<Hold[]>(this.session ? app.holds.filter((h) => h.sessionId === this.session!.id) : []);
  suggestions = $state.raw<Record<string, Suggestion[]>>({});
  loaded = $state(false);
  private suggestSeq = 0;

  template = $derived(app.templates.find((t) => t.id === this.session?.templateId) ?? null);
  entries = $derived<SessionEntry[]>(this.session ? sessionEntries(this.session, this.analyses, this.holds) : []);
  /** Review items with template entries re-aligned to the current template (it may have been switched or edited). */
  items = $derived(
    alignToTemplate(
      toReviewItems(this.entries, (videoId, bestS) => {
        const a = this.analyses[videoId];
        return a ? a.poses?.[poseKey(bestS, a.sampleHz)] : undefined;
      }),
      this.template,
    ),
  );
  /** "Confirm all": labels the pose alignment gives open cards (null without enough poses). */
  confirmAllPlan = $state.raw<Array<{ key: string; label: Label }> | null>(null);
  private unsubscribe: (() => void) | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  async load(sessionId: string) {
    const db = app.db;
    const session = (await db.sessions.get(sessionId)) ?? null;
    if (session) app.upsertSession(session);
    this.sessionId = session ? sessionId : null;
    if (!session) {
      this.loaded = true;
      return;
    }
    const videos = (await Promise.all(session.videoIds.map((id) => db.videos.get(id)))).filter((v): v is Video => !!v);
    const analyses: Record<string, Analysis> = {};
    for (const v of videos) {
      const a = await db.analyses.get(v.id);
      if (a) analyses[v.id] = a;
    }
    this.videos = videos;
    this.analyses = analyses;
    this.loaded = true;
    // Frame poses arrive in the background: take them in and suggest again (calmly).
    this.unsubscribe?.();
    this.unsubscribe = app.onAnalysis((a) => {
      if (!this.analyses[a.videoId]) return;
      this.analyses = { ...this.analyses, [a.videoId]: a };
      if (this.refreshTimer) clearTimeout(this.refreshTimer);
      this.refreshTimer = setTimeout(() => void this.refreshSuggestions(), 400);
    });
    capture.request(this.holds);
    this.requestPoses();
    await this.refreshSuggestions();
  }

  /** Stops listening for background updates (screen closed). */
  dispose() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
  }

  /** A hold's pose: the one it has (from its still), else the stored pose of its candidate's best frame. */
  private poseFor(e: SessionEntry): Pick<Hold, 'pose'> {
    if (e.hold?.pose !== undefined && e.hold.bestS === e.candidate.bestS) return { pose: e.hold.pose };
    const a = this.analyses[e.videoId];
    const p = a?.poses?.[poseKey(e.candidate.bestS, a.sampleHz)];
    return p ? { pose: p } : {};
  }

  /**
   * "Confirm all": labels every open card of the plan with the label the pose alignment gives it
   * (one batch of holds, one analysis write per video). Returns the number of cards labeled.
   */
  async confirmAll(): Promise<number> {
    const plan = this.confirmAllPlan;
    const session = this.session;
    if (!plan?.length || !session) return 0;
    const holds: Hold[] = [];
    const byVideo = new Map<string, Map<string, string>>();
    for (const { key, label } of plan) {
      const e = this.entry(key);
      if (!e || e.candidate.status !== 'open') continue;
      const c = e.candidate;
      const hold: Hold = {
        id: newId('hold'),
        sessionId: session.id,
        videoId: e.videoId,
        asanaId: label.asanaId,
        side: label.side,
        startS: c.startS,
        endS: c.endS,
        bestS: c.bestS,
        clipStartS: c.clipStartS,
        clipEndS: c.clipEndS,
        ...(label.templateEntryIndex !== undefined ? { templateEntryIndex: label.templateEntryIndex } : {}),
        crop: {},
        ...this.poseFor(e),
      };
      holds.push(hold);
      byVideo.set(e.videoId, (byVideo.get(e.videoId) ?? new Map()).set(c.id, hold.id));
    }
    if (!holds.length) return 0;
    await app.db.batch(holds.map((put) => ({ store: 'holds' as const, put })));
    for (const h of holds) app.upsertHold(h);
    for (const [videoId, ids] of byVideo) {
      const a = await app.updateAnalysis(videoId, (stored) => ({
        ...stored,
        candidates: stored.candidates.map((c) => (c.status === 'open' && ids.has(c.id) ? { ...c, status: 'labeled' as const, holdId: ids.get(c.id)! } : c)),
      }));
      if (a) this.analyses = { ...this.analyses, [videoId]: a };
    }
    capture.request(holds);
    await this.refreshSuggestions();
    return holds.length;
  }

  /** Asks for the poses of candidates' best frames that are not stored yet (needs the video file). */
  requestPoses(videoId?: string) {
    for (const [id, a] of Object.entries(this.analyses)) {
      if (videoId && id !== videoId) continue;
      const frames = a.candidates
        .filter((c) => c.status !== 'dismissed')
        .map((c) => ({ key: poseKey(c.bestS, a.sampleHz), atS: c.bestS }))
        .filter((f) => !(a.poses && f.key in a.poses));
      if (frames.length) capture.requestFramePoses(id, frames);
    }
  }

  entry(key: string): SessionEntry | undefined {
    return this.entries.find((e) => e.key === key);
  }

  signals(videoId: string): SignalView {
    const a = this.analyses[videoId]!;
    const v = this.videos.find((x) => x.id === videoId);
    return {
      sampleHz: a.sampleHz,
      m: a.m,
      C: a.C,
      durationS: v?.durationS ?? a.sampleCount / a.sampleHz,
      bestFrameMiddle: a.params.bestFrameMiddle,
      clipWindowS: a.params.clipWindowS,
    };
  }

  async refreshSuggestions() {
    if (!this.session) return;
    const seq = ++this.suggestSeq;
    const result = await suggestInWorker({
      items: this.items,
      catalog: app.asanas,
      template: this.template,
      history: historyFrom(app.sessions, app.holds, this.session.id),
      options: { now: new Date().toISOString() },
    });
    if (seq === this.suggestSeq) {
      this.suggestions = result.suggestions;
      this.confirmAllPlan = result.confirmAll;
    }
  }

  // ----- persistence helpers -----

  private async saveCandidates(videoId: string, candidates: ReviewCandidate[]) {
    const sorted = sortCandidates(candidates);
    this.analyses = { ...this.analyses, [videoId]: { ...this.analyses[videoId]!, candidates: sorted } };
    // Read-modify-write: background frame poses stored meanwhile are kept.
    const a = await app.updateAnalysis(videoId, (stored) => ({ ...stored, candidates: sorted }));
    if (a) this.analyses = { ...this.analyses, [videoId]: a };
    this.requestPoses(videoId);
  }

  /** Saves a hold and (re-)captures its still and clip when they no longer match. */
  private async putHold(h: Hold) {
    await app.db.holds.put(h);
    app.upsertHold(h);
    capture.request([h]);
  }

  private async deleteHold(id: string) {
    await app.db.holds.delete(id);
    app.removeHold(id);
    await deleteAssets(app.assets.filter((a) => a.holdId === id));
  }

  private candidates(videoId: string): ReviewCandidate[] {
    return this.analyses[videoId]?.candidates ?? [];
  }

  private async replaceCandidate(videoId: string, id: string, next: ReviewCandidate[]) {
    await this.saveCandidates(videoId, [...this.candidates(videoId).filter((c) => c.id !== id), ...next]);
  }

  // ----- actions -----

  /**
   * Labels a candidate (top suggestion if no label is given). The same label as the previous hold
   * makes it another rep; "Merge with previous" stays available for a hold split by mistake.
   */
  async confirm(key: string, label?: Label) {
    const e = this.entry(key);
    const session = this.session;
    if (!e || !session) return;
    const chosen = label ?? this.suggestions[key]?.[0];
    if (!chosen) return;
    const templateEntryIndex =
      chosen.templateEntryIndex ?? matchTemplateEntry(this.items, key, { asanaId: chosen.asanaId, side: chosen.side }, this.template);
    const hold: Hold = {
      id: e.hold?.id ?? newId('hold'),
      sessionId: session.id,
      videoId: e.videoId,
      asanaId: chosen.asanaId,
      side: chosen.side,
      startS: e.candidate.startS,
      endS: e.candidate.endS,
      bestS: e.candidate.bestS,
      clipStartS: e.candidate.clipStartS,
      clipEndS: e.candidate.clipEndS,
      ...(templateEntryIndex !== undefined ? { templateEntryIndex } : {}),
      crop: e.hold?.crop ?? {},
      ...this.poseFor(e),
    };
    await this.putHold(hold);
    await this.replaceCandidate(e.videoId, e.candidate.id, [{ ...e.candidate, status: 'labeled', holdId: hold.id }]);
    await this.refreshSuggestions();
  }

  async dismiss(key: string) {
    const e = this.entry(key);
    if (!e) return;
    if (e.hold) await this.deleteHold(e.hold.id);
    const { holdId: _, ...rest } = e.candidate;
    await this.replaceCandidate(e.videoId, e.candidate.id, [{ ...rest, status: 'dismissed' }]);
    await this.refreshSuggestions();
  }

  /** Previous candidate in the same video (any status except dismissed). */
  previousOf(key: string): SessionEntry | undefined {
    const i = this.entries.findIndex((e) => e.key === key);
    const e = this.entries[i];
    for (let j = i - 1; j >= 0; j--) {
      const p = this.entries[j]!;
      if (p.videoId !== e?.videoId) return undefined;
      if (p.candidate.status !== 'dismissed') return p;
    }
    return undefined;
  }

  /**
   * Merges a card into the previous visible one. A label always survives (either card's hold);
   * "Not a pose" candidates between them are absorbed.
   */
  async mergeWithPrevious(key: string) {
    const e = this.entry(key);
    const p = this.previousOf(key);
    if (!e || !p) return;
    const merged = mergeCandidates(p.candidate, e.candidate, this.signals(e.videoId));
    // Only one hold survives: the previous card's if it has one.
    const keepHold = p.hold ?? e.hold;
    const dropHold = p.hold && e.hold ? e.hold : undefined;
    if (dropHold) await this.deleteHold(dropHold.id);
    const next: ReviewCandidate = { ...merged, ...(keepHold ? { holdId: keepHold.id, status: 'labeled' as const } : {}) };
    if (keepHold) await this.putHold(holdFromCandidate(keepHold, next));
    const absorbed = (c: ReviewCandidate) => c.status === 'dismissed' && c.startS >= next.startS && c.endS <= next.endS;
    await this.saveCandidates(e.videoId, [
      ...this.candidates(e.videoId).filter((c) => c.id !== e.candidate.id && c.id !== p.candidate.id && !absorbed(c)),
      next,
    ]);
    await this.refreshSuggestions();
  }

  async split(key: string, atS: number) {
    const e = this.entry(key);
    if (!e) return;
    const [left, right] = splitCandidate(e.candidate, atS, this.signals(e.videoId));
    if (e.hold) await this.putHold(holdFromCandidate(e.hold, left));
    await this.replaceCandidate(e.videoId, e.candidate.id, [left, right]);
    await this.refreshSuggestions();
  }

  /** Splits a hold into `k` holds at the strongest posture changes (k e.g. from the template). */
  async splitInto(key: string, k: number) {
    const e = this.entry(key);
    if (!e) return;
    const parts = splitInto(e.candidate, k, this.signals(e.videoId));
    if (parts.length < 2) return;
    if (e.hold) await this.putHold(holdFromCandidate(e.hold, parts[0]!));
    await this.replaceCandidate(e.videoId, e.candidate.id, parts);
    await this.refreshSuggestions();
  }

  /**
   * Adds a hold the detector missed around `atS`. Its span stays inside `bounds` (the uncovered
   * gap it was picked from) or, without bounds, between the neighbouring candidates.
   */
  async addMissed(videoId: string, atS: number, bounds?: TimeRange): Promise<string | null> {
    if (!this.analyses[videoId]) return null;
    const c = missedCandidate(atS, this.signals(videoId), bounds ?? freeSpanAround(this.candidates(videoId), atS) ?? undefined);
    await this.saveCandidates(videoId, [...this.candidates(videoId), c]);
    await this.refreshSuggestions();
    return `${videoId}/${c.id}`;
  }

  /**
   * Analyses one stretch of a video on its own (an uncovered gap; `labeling.detectInRange`) and
   * adds the holds found there as open cards. Spans the user marked "Not a pose" are not offered
   * again. Returns the keys of the new cards.
   */
  async findHolds(videoId: string, range: TimeRange): Promise<string[]> {
    const a = this.analyses[videoId];
    if (!a) return [];
    const reader = await sampleReader(videoId, a.frameWidth * a.frameHeight);
    const frames = reader && (await reader.count()) >= a.sampleCount ? { frame: (i: number) => reader.read(i) } : null;
    const current = this.candidates(videoId);
    const dismissed = current.filter((c) => c.status === 'dismissed');
    const overlap = (x: ReviewCandidate, y: ReviewCandidate) => Math.max(0, Math.min(x.endS, y.endS) - Math.max(x.startS, y.startS));
    const found = (await detectInRange(range, this.signals(videoId), a.params, frames)).filter(
      (f) => !current.some((c) => c.status !== 'dismissed' && overlap(c, f) > 0) && !dismissed.some((d) => overlap(d, f) >= 0.5 * (f.endS - f.startS)),
    );
    if (!found.length) return [];
    await this.saveCandidates(videoId, [...current, ...found]);
    await this.refreshSuggestions();
    return found.map((c) => itemKey(videoId, c.id));
  }

  /** Brings back the "Not a pose" candidates inside `range` as open cards. */
  async restoreIn(videoId: string, range: TimeRange) {
    const inside = (c: ReviewCandidate) => c.status === 'dismissed' && c.endS > range.fromS && c.startS < range.toS;
    const current = this.candidates(videoId);
    if (!current.some(inside)) return;
    await this.saveCandidates(videoId, current.map((c) => (inside(c) ? { ...c, status: 'open' as const } : c)));
    await this.refreshSuggestions();
  }

  async nudge(key: string, bestS: number) {
    const e = this.entry(key);
    if (!e) return;
    const c = nudgeBest(e.candidate, bestS);
    if (e.hold) await this.putHold(holdFromCandidate(e.hold, c));
    await this.replaceCandidate(e.videoId, e.candidate.id, [c]);
  }

  async setTemplate(templateId: string | null) {
    if (!this.session) return;
    const { templateId: _, ...rest } = this.session;
    const s: Session = templateId ? { ...rest, templateId } : rest;
    await app.db.sessions.put(s);
    app.upsertSession(s);
    await this.refreshSuggestions();
  }

  /**
   * New order of the session's videos (a permutation of `session.videoIds`): the session timeline,
   * the card list and template suggestions follow it.
   */
  async setVideoOrder(videoIds: string[]) {
    const session = this.session;
    if (!session || videoIds.join('\n') === session.videoIds.join('\n')) return;
    const s: Session = { ...session, videoIds };
    await app.db.sessions.put(s);
    app.upsertSession(s);
    const byId = new Map(this.videos.map((v) => [v.id, v]));
    this.videos = videoIds.map((id) => byId.get(id)).filter((v): v is Video => !!v);
    await this.refreshSuggestions();
  }

  /** Other sessions recorded on the same day (e.g. clips cut from one practice). */
  get sameDay(): Session[] {
    return this.session ? sameDaySessions(app.sessions, this.session) : [];
  }

  combining = $state(false);

  /** Moves the videos and holds of all same-day sessions into this one, after a confirmation. */
  async combineSameDay() {
    const session = this.session;
    if (!session || this.combining) return;
    const others = sameDaySessions(app.sessions, session);
    if (!others.length) return;
    const holdsOf = (id: string) => app.holds.filter((h) => h.sessionId === id).length;
    const list = others.map((o) => `${o.videoIds.length} ${o.videoIds.length === 1 ? 'video' : 'videos'}, ${holdsOf(o.id)} labeled`).join('; ');
    const choice = await dialog.ask({
      title: 'Combine sessions?',
      message: `Moves ${others.length === 1 ? 'the other session' : `${others.length} other sessions`} (${list}) into this one. Notes are joined; this cannot be undone.`,
      options: [
        { id: 'combine', label: 'Combine', kind: 'primary' },
        { id: 'separate', label: 'Keep separate', detail: 'Stop suggesting this for these sessions.' },
        { id: 'cancel', label: 'Cancel', kind: 'quiet' },
      ],
    });
    if (choice === 'separate') {
      const marked = [session, ...others].filter((o) => !o.keepSeparate).map((o) => ({ ...o, keepSeparate: true }));
      await app.db.batch(marked.map((put) => ({ store: 'sessions', put })));
      for (const s of marked) app.upsertSession(s);
      return;
    }
    if (choice !== 'combine') return;
    this.combining = true;
    try {
      const db = app.db;
      const r = combineSessions(session, others, app.videos, app.holds);
      // One transaction: the target session, the moved holds and the deletions land together.
      await db.batch([
        { store: 'sessions', put: r.session },
        ...r.holds.map((put) => ({ store: 'holds' as const, put })),
        ...r.deleteIds.map((id) => ({ store: 'sessions' as const, delete: id })),
      ]);
      await app.refresh();
      await this.load(session.id);
    } finally {
      this.combining = false;
    }
  }

  /** Same-day sessions the user has not chosen to keep separate. */
  get combinable(): Session[] {
    return this.sameDay.filter((o) => !(o.keepSeparate && this.session?.keepSeparate));
  }

  async setNote(note: string) {
    if (!this.session || this.session.note === note) return;
    const s = { ...this.session, note };
    await app.db.sessions.put(s);
    app.upsertSession(s);
  }

  /** Other sessions here (within 300 m) without a name: a name given to this session applies to them too. */
  get unnamedNearby(): Session[] {
    return this.session ? unnamedNear(app.sessions, this.session) : [];
  }

  /** Names the place (empty removes the name; coordinates stay). Unnamed sessions nearby get the name too. */
  async setPlaceName(name: string) {
    const session = this.session;
    if (!session) return;
    const next = withPlaceName(session, name);
    const others = next.location?.name ? this.unnamedNearby.map((o) => withPlaceName(o, name)) : [];
    const all = [next, ...others];
    await app.db.batch(all.map((put) => ({ store: 'sessions' as const, put })));
    for (const s of all) app.upsertSession(s);
  }

  /** Re-runs detection from stored samples and keeps labels, manual holds and dismissals. */
  async rerun(videoId: string, params: DetectionParams, onProgress?: (done: number, total: number) => void) {
    const previous = this.candidates(videoId);
    await pipeline.reanalyze(videoId, params, onProgress);
    invalidateSamples(videoId);
    const a = await app.updateAnalysis(videoId, (fresh) => ({ ...fresh, candidates: reconcile(fresh.candidates, previous, this.holds) }));
    if (!a) return;
    this.analyses = { ...this.analyses, [videoId]: a };
    this.requestPoses(videoId);
    await this.refreshSuggestions();
  }
}
