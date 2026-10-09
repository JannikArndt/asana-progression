import {
  alignToTemplate,
  holdFromCandidate,
  matchTemplateEntry,
  mergeCandidateFor,
  mergeCandidates,
  missedCandidate,
  nudgeBest,
  reconcile,
  sortCandidates,
  splitCandidate,
  type Label,
  type SignalView,
  type Suggestion,
} from '../../labeling';
import type { DetectionParams } from '../../detection';
import { newId, type Analysis, type Hold, type ReviewCandidate, type Session, type Video } from '../../model';
import { app } from './app.svelte';
import { dialog } from './dialog.svelte';
import { combineSessions, historyFrom, parseItemKey, sameDaySessions, sessionEntries, toReviewItems, type SessionEntry } from './session-data';
import { suggestInWorker } from '../workers/suggest-client';
import { pipeline } from '../pipeline/controller.svelte';
import { invalidateSamples } from './samples';
import { capture, deleteAssets } from './capture.svelte';

const SEPARATE_KEY = 'asana.sessions.separate';

/** Sessions the user chose to keep separate from their same-day sessions. */
function separateSessions(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEPARATE_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function keepSeparate(ids: string[]) {
  try {
    localStorage.setItem(SEPARATE_KEY, JSON.stringify([...new Set([...separateSessions(), ...ids])]));
  } catch {
    /* private mode */
  }
}

/**
 * State and actions of the session review screen. Every action persists immediately
 * (IndexedDB), so there is never unsaved labeling state.
 */
export class SessionReview {
  session = $state.raw<Session | null>(null);
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
  items = $derived(alignToTemplate(toReviewItems(this.entries), this.template));

  async load(sessionId: string) {
    const db = app.db;
    const session = (await db.sessions.get(sessionId)) ?? null;
    this.session = session;
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
    capture.request(this.holds);
    await this.refreshSuggestions();
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
    if (seq === this.suggestSeq) this.suggestions = result;
  }

  // ----- persistence helpers -----

  private async saveCandidates(videoId: string, candidates: ReviewCandidate[]) {
    const a = { ...this.analyses[videoId]!, candidates: sortCandidates(candidates) };
    this.analyses = { ...this.analyses, [videoId]: a };
    await app.db.analyses.put(a);
    app.setCandidates(videoId, a.candidates);
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

  /** Captures assets again for the labeled holds of a video (e.g. after re-attaching its file). */
  recapture(videoId: string) {
    capture.request(this.holds.filter((h) => h.videoId === videoId));
  }

  private candidates(videoId: string): ReviewCandidate[] {
    return this.analyses[videoId]?.candidates ?? [];
  }

  private async replaceCandidate(videoId: string, id: string, next: ReviewCandidate[]) {
    await this.saveCandidates(videoId, [...this.candidates(videoId).filter((c) => c.id !== id), ...next]);
  }

  // ----- actions -----

  /** Labels a candidate (top suggestion if no label is given) and offers to merge with an identical previous hold. */
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
    };
    const prevKey = mergeCandidateFor(this.items, key, { asanaId: hold.asanaId, side: hold.side });
    await this.putHold(hold);
    await this.replaceCandidate(e.videoId, e.candidate.id, [{ ...e.candidate, status: 'labeled', holdId: hold.id }]);
    await this.refreshSuggestions();
    if (prevKey && parseItemKey(prevKey).videoId === e.videoId) {
      const name = app.asanas.find((a) => a.id === hold.asanaId)?.name ?? hold.asanaId;
      const choice = await dialog.ask({
        title: 'Same as the previous hold',
        message: `The previous hold is also ${name}${hold.side ? ` ${hold.side}` : ''}. Merge them? The stiller frame is kept.`,
        options: [
          { id: 'merge', label: 'Merge', kind: 'primary' },
          { id: 'keep', label: 'Keep separate', kind: 'quiet' },
        ],
      });
      if (choice === 'merge') await this.mergeWithPrevious(key);
    }
  }

  async dismiss(key: string) {
    const e = this.entry(key);
    if (!e) return;
    if (e.hold) await this.deleteHold(e.hold.id);
    const { holdId: _, ...rest } = e.candidate;
    await this.replaceCandidate(e.videoId, e.candidate.id, [{ ...rest, status: 'dismissed' }]);
    await this.refreshSuggestions();
  }

  async restore(key: string) {
    const e = this.entry(key);
    if (!e) return;
    await this.replaceCandidate(e.videoId, e.candidate.id, [{ ...e.candidate, status: 'open' }]);
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
    await this.saveCandidates(e.videoId, [
      ...this.candidates(e.videoId).filter((c) => c.id !== e.candidate.id && c.id !== p.candidate.id),
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

  async addMissed(videoId: string, atS: number): Promise<string | null> {
    if (!this.analyses[videoId]) return null;
    const c = missedCandidate(atS, this.signals(videoId));
    await this.saveCandidates(videoId, [...this.candidates(videoId), c]);
    await this.refreshSuggestions();
    return `${videoId}/${c.id}`;
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
    this.session = s;
    await app.db.sessions.put(s);
    app.upsertSession(s);
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
      keepSeparate([session.id, ...others.map((o) => o.id)]);
      this.separateVersion++;
      return;
    }
    if (choice !== 'combine') return;
    this.combining = true;
    try {
      const db = app.db;
      const r = combineSessions(session, others, app.videos, app.holds);
      // Order makes an interrupted run safe to repeat: the target gets every video first, then the
      // holds move, and only then are the other sessions deleted.
      await db.sessions.put(r.session);
      for (const h of r.holds) await db.holds.put(h);
      for (const id of r.deleteIds) await db.sessions.delete(id);
      await app.refresh();
      await this.load(session.id);
    } finally {
      this.combining = false;
    }
  }

  separateVersion = $state(0);

  /** Same-day sessions the user has not chosen to keep separate. */
  get combinable(): Session[] {
    void this.separateVersion;
    const kept = separateSessions();
    return this.sameDay.filter((o) => !(kept.has(o.id) && this.session && kept.has(this.session.id)));
  }

  async setNote(note: string) {
    if (!this.session || this.session.note === note) return;
    const s = { ...this.session, note };
    this.session = s;
    await app.db.sessions.put(s);
    app.upsertSession(s);
  }

  /** Re-runs detection from stored samples and keeps labels, manual holds and dismissals. */
  async rerun(videoId: string, params: DetectionParams, onProgress?: (done: number, total: number) => void) {
    const previous = this.candidates(videoId);
    await pipeline.reanalyze(videoId, params, onProgress);
    invalidateSamples(videoId);
    const fresh = await app.db.analyses.get(videoId);
    if (!fresh) return;
    const candidates = reconcile(fresh.candidates, previous, this.holds);
    const a = { ...fresh, candidates };
    await app.db.analyses.put(a);
    this.analyses = { ...this.analyses, [videoId]: a };
    app.setCandidates(videoId, candidates);
    await this.refreshSuggestions();
  }
}
