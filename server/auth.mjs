// server/auth.mjs — passkeys (WebAuthn via @simplewebauthn/server) and sign-in cookies.
//
// One owner. The first passkey needs SETUP_TOKEN (a CapRover env var); every further passkey
// needs a signed-in device. Session tokens are stored as SHA-256 hashes only.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { HttpError, parseCookies } from './http.mjs';

export const COOKIE = 'asana_sid';
const SESSION_DAYS = 400;
const CHALLENGE_MS = 5 * 60_000;

const sha = (s) => createHash('sha256').update(s).digest('hex');
const now = () => new Date();

export class Auth {
  constructor(db, { rpId, origin, setupToken, rpName = 'Asana progression' }) {
    this.db = db;
    this.rpId = rpId;
    this.origin = origin;
    this.setupToken = setupToken || '';
    this.rpName = rpName;
    this.secure = origin.startsWith('https:');
    this.challenges = new Map(); // challenge -> { kind, expires }
    this.failures = []; // timestamps of failed setup-token attempts
  }

  hasCredentials() {
    return this.db.prepare('SELECT 1 FROM credentials LIMIT 1').get() !== undefined;
  }

  // ---- tokens ---------------------------------------------------------------------------

  issueToken(kind, ms, label) {
    const raw = randomBytes(32).toString('base64url');
    const t = now();
    this.db
      .prepare('INSERT INTO tokens (hash, kind, created_at, expires_at, label) VALUES (?, ?, ?, ?, ?)')
      .run(sha(raw), kind, t.toISOString(), new Date(t.getTime() + ms).toISOString(), label ?? null);
    return { token: raw, expiresAt: new Date(t.getTime() + ms).toISOString() };
  }

  findToken(kind, key) {
    if (!key) return null;
    const row = this.db.prepare('SELECT hash, expires_at, last_used_at FROM tokens WHERE hash = ? AND kind = ?').get(sha(key), kind);
    if (!row || row.expires_at < now().toISOString()) return null;
    // Touch at most once an hour (a write per request is pointless).
    if (!row.last_used_at || Date.now() - Date.parse(row.last_used_at) > 3_600_000) {
      this.db.prepare('UPDATE tokens SET last_used_at = ? WHERE hash = ?').run(now().toISOString(), row.hash);
    }
    return row;
  }

  /** 'session' when the request carries a valid sign-in cookie, else null. */
  who(req) {
    const sid = parseCookies(req.headers.cookie)[COOKIE];
    return sid && this.findToken('session', sid) ? 'session' : null;
  }

  sessionCookie(token) {
    return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${this.secure ? '; Secure' : ''}`;
  }

  clearCookie() {
    return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${this.secure ? '; Secure' : ''}`;
  }

  signIn(label) {
    return this.issueToken('session', SESSION_DAYS * 86400_000, label).token;
  }

  signOut(req) {
    const sid = parseCookies(req.headers.cookie)[COOKIE];
    if (sid) this.db.prepare("DELETE FROM tokens WHERE hash = ? AND kind = 'session'").run(sha(sid));
  }

  pruneTokens() {
    this.db.prepare('DELETE FROM tokens WHERE expires_at < ?').run(now().toISOString());
  }

  // ---- challenges -----------------------------------------------------------------------

  remember(challenge, kind) {
    const t = Date.now();
    for (const [c, v] of this.challenges) if (v.expires < t) this.challenges.delete(c);
    this.challenges.set(challenge, { kind, expires: t + CHALLENGE_MS });
  }

  /** Accepts a challenge once (for verify*Response's expectedChallenge callback). */
  take(kind) {
    return (challenge) => {
      const v = this.challenges.get(challenge);
      if (!v || v.kind !== kind || v.expires < Date.now()) return false;
      this.challenges.delete(challenge);
      return true;
    };
  }

  checkSetupToken(given) {
    const t = Date.now();
    this.failures = this.failures.filter((x) => t - x < 60_000);
    if (this.failures.length >= 10) throw new HttpError(429, 'Too many attempts, wait a minute');
    if (!this.setupToken) throw new HttpError(403, 'The server has no SETUP_TOKEN: set it in CapRover to create the first passkey');
    const a = Buffer.from(sha(String(given || '')));
    const b = Buffer.from(sha(this.setupToken));
    if (!timingSafeEqual(a, b)) {
      this.failures.push(t);
      throw new HttpError(403, 'Wrong setup token');
    }
  }

  // ---- registration ---------------------------------------------------------------------

  async registrationOptions(req, body) {
    if (this.who(req) !== 'session') {
      if (this.hasCredentials()) throw new HttpError(401, 'Sign in on a device that has a passkey to add another one');
      this.checkSetupToken(body.setupToken);
    }
    const existing = this.db.prepare('SELECT id, transports FROM credentials').all();
    const options = await generateRegistrationOptions({
      rpName: this.rpName,
      rpID: this.rpId,
      userName: 'owner',
      userDisplayName: 'Asana progression',
      userID: new TextEncoder().encode('owner'),
      attestationType: 'none',
      excludeCredentials: existing.map((c) => ({ id: c.id, transports: c.transports ? JSON.parse(c.transports) : undefined })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    });
    this.remember(options.challenge, 'register');
    return options;
  }

  async registrationVerify(req, body) {
    const result = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge: this.take('register'),
      expectedOrigin: this.origin,
      expectedRPID: this.rpId,
      requireUserVerification: false,
    }).catch((e) => {
      throw new HttpError(400, `Passkey not accepted: ${e.message}`);
    });
    if (!result.verified || !result.registrationInfo) throw new HttpError(400, 'Passkey not accepted');
    const c = result.registrationInfo.credential;
    const name = String(body.name || '').slice(0, 80) || null;
    this.db
      .prepare('INSERT OR REPLACE INTO credentials (id, public_key, counter, transports, name, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(c.id, Buffer.from(c.publicKey), c.counter, c.transports ? JSON.stringify(c.transports) : null, name, now().toISOString());
    return c.id;
  }

  // ---- authentication -------------------------------------------------------------------

  async authenticationOptions() {
    const options = await generateAuthenticationOptions({ rpID: this.rpId, userVerification: 'preferred' });
    this.remember(options.challenge, 'login');
    return options;
  }

  async authenticationVerify(body) {
    const id = String(body.response?.id || '');
    const row = this.db.prepare('SELECT id, public_key, counter, transports FROM credentials WHERE id = ?').get(id);
    if (!row) throw new HttpError(401, 'Unknown passkey');
    const result = await verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge: this.take('login'),
      expectedOrigin: this.origin,
      expectedRPID: this.rpId,
      credential: {
        id: row.id,
        publicKey: new Uint8Array(row.public_key),
        counter: row.counter,
        transports: row.transports ? JSON.parse(row.transports) : undefined,
      },
      requireUserVerification: false,
    }).catch((e) => {
      throw new HttpError(401, `Sign-in failed: ${e.message}`);
    });
    if (!result.verified) throw new HttpError(401, 'Sign-in failed');
    this.db
      .prepare('UPDATE credentials SET counter = ?, last_used_at = ? WHERE id = ?')
      .run(result.authenticationInfo.newCounter, now().toISOString(), row.id);
    return row.id;
  }

  passkeys() {
    return this.db.prepare('SELECT id, name, created_at AS createdAt, last_used_at AS lastUsedAt FROM credentials ORDER BY created_at').all();
  }
}
