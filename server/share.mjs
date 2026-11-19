// server/share.mjs — unlisted share links for a session's poses or a single hold.
//
// A link shows the photos (cropped in the page), asana names, sides, reps and the day; never
// notes, places, coordinates, file names, clips or analysis frames. Revoking deletes the row.
import { randomBytes } from 'node:crypto';
import { HttpError } from './http.mjs';

const KINDS = new Set(['session', 'hold']);

const body = (db, store, key) => {
  const r = db.prepare('SELECT body FROM records WHERE store = ? AND key = ? AND deleted = 0').get(store, key);
  return r ? JSON.parse(r.body) : null;
};

export function createShare(db, kind, target) {
  if (!KINDS.has(kind) || typeof target !== 'string') throw new HttpError(400, 'Share a session or a hold');
  if (!body(db, kind === 'session' ? 'sessions' : 'holds', target)) throw new HttpError(404, `That ${kind} is not on the server yet; wait for the sync`);
  const have = db.prepare('SELECT token, created_at AS createdAt FROM shares WHERE kind = ? AND target = ?').get(kind, target);
  if (have) return { token: have.token, kind, target, createdAt: have.createdAt };
  const token = randomBytes(16).toString('base64url');
  const createdAt = new Date().toISOString();
  db.prepare('INSERT INTO shares (token, kind, target, created_at) VALUES (?, ?, ?, ?)').run(token, kind, target, createdAt);
  return { token, kind, target, createdAt };
}

export function listShares(db) {
  return db
    .prepare('SELECT token, kind, target, created_at AS createdAt FROM shares ORDER BY created_at DESC')
    .all()
    .map((s) => ({ ...s, title: titleOf(db, s) }));
}

export function deleteShare(db, token) {
  db.prepare('DELETE FROM shares WHERE token = ?').run(String(token));
}

function titleOf(db, share) {
  try {
    const v = shareView(db, share);
    return v ? v.title : '(deleted)';
  } catch {
    return '(unreadable)';
  }
}

export function findShare(db, token) {
  if (!/^[\w-]{10,64}$/.test(String(token))) return null;
  return db.prepare('SELECT token, kind, target FROM shares WHERE token = ?').get(token) ?? null;
}

const dayOf = (iso) => (typeof iso === 'string' ? iso.slice(0, 10) : '');

/** Session holds in practice order: the session's video order, then time in the video. */
function sessionHolds(db, session) {
  const holds = db
    .prepare("SELECT body FROM records WHERE store = 'holds' AND deleted = 0 AND json_extract(body, '$.sessionId') = ?")
    .all(session.id)
    .map((r) => JSON.parse(r.body));
  const order = new Map((session.videoIds || []).map((id, i) => [id, i]));
  return holds.sort((a, b) => (order.get(a.videoId) ?? 1e9) - (order.get(b.videoId) ?? 1e9) || a.startS - b.startS);
}

function assetsOf(db, holdIds) {
  if (!holdIds.length) return [];
  const marks = holdIds.map(() => '?').join(',');
  return db
    .prepare(`SELECT body FROM records WHERE store = 'assets' AND deleted = 0 AND json_extract(body, '$.holdId') IN (${marks})`)
    .all(...holdIds)
    .map((r) => JSON.parse(r.body));
}

/** The public view of a share: { kind, title, date, series?, items: [...] } or null when gone. */
export function shareView(db, share) {
  let holds;
  let date;
  let series = null;
  if (share.kind === 'session') {
    const s = body(db, 'sessions', share.target);
    if (!s) return null;
    holds = sessionHolds(db, s);
    date = dayOf(s.date);
    if (s.templateId) series = body(db, 'templates', s.templateId)?.name ?? null;
  } else {
    const h = body(db, 'holds', share.target);
    if (!h) return null;
    const s = body(db, 'sessions', h.sessionId);
    // Reps need the neighbours.
    holds = s ? sessionHolds(db, s) : [h];
    date = dayOf(s?.date);
  }
  const names = new Map();
  const nameOf = (id) => {
    if (!names.has(id)) names.set(id, body(db, 'asanas', id)?.name ?? 'Unknown asana');
    return names.get(id);
  };
  // Runs of the same asana and side are reps 1…n.
  const reps = new Map();
  for (let i = 0; i < holds.length; ) {
    let j = i;
    while (j + 1 < holds.length && holds[j + 1].asanaId === holds[i].asanaId && holds[j + 1].side === holds[i].side) j++;
    for (let k = i; k <= j; k++) reps.set(holds[k].id, { rep: k - i + 1, reps: j - i + 1 });
    i = j + 1;
  }
  const shown = share.kind === 'hold' ? holds.filter((h) => h.id === share.target) : holds;
  const assets = assetsOf(
    db,
    shown.map((h) => h.id),
  );
  const pick = (holdId, kind) => {
    const a = assets.filter((x) => x.holdId === holdId && x.kind === kind).sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt)))[0];
    return a ? { id: a.id, width: a.width, height: a.height } : null;
  };
  const items = shown
    .map((h) => ({
      id: h.id,
      asana: nameOf(h.asanaId),
      side: h.side ?? null,
      ...reps.get(h.id),
      crop: h.crop?.manual ?? h.crop?.auto ?? null,
      still: pick(h.id, 'still'),
      thumb: pick(h.id, 'thumb'),
    }))
    .filter((i) => i.still || i.thumb);
  const first = items[0];
  const title =
    share.kind === 'hold' && first
      ? `${first.asana}${first.side ? ` ${first.side}` : ''}${date ? ` · ${date}` : ''}`
      : `${series ?? 'Practice'}${date ? ` · ${date}` : ''}`;
  return { kind: share.kind, title, date, series, items };
}

/** Asset record of a shared file, only if it belongs to a hold the share shows. */
export function sharedAsset(db, share, assetId) {
  const view = shareView(db, share);
  if (!view) return null;
  const ok = view.items.some((i) => i.still?.id === assetId || i.thumb?.id === assetId);
  return ok ? body(db, 'assets', assetId) : null;
}
