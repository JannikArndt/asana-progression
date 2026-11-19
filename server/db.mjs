// server/db.mjs — the SQLite database in the data volume (node:sqlite, no extra dependency).
//
// Records are stored as the app sends them (JSON text, opaque here except for the few fields
// the share pages read with json_extract). Every write gets the next `rev`; devices pull what
// changed since the last rev they saw. Deletes stay as tombstones so other devices learn them.
//
// Migrations are append-only: never edit a shipped entry, add the next one.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const MIGRATIONS = [
  `CREATE TABLE records (
     store TEXT NOT NULL, key TEXT NOT NULL, rev INTEGER NOT NULL,
     deleted INTEGER NOT NULL DEFAULT 0, body TEXT, updated_at TEXT NOT NULL,
     PRIMARY KEY (store, key));
   CREATE INDEX records_rev ON records (rev);
   CREATE TABLE files (key TEXT PRIMARY KEY, bytes INTEGER NOT NULL, raw_bytes INTEGER, updated_at TEXT NOT NULL);
   CREATE TABLE credentials (
     id TEXT PRIMARY KEY, public_key BLOB NOT NULL, counter INTEGER NOT NULL, transports TEXT,
     name TEXT, created_at TEXT NOT NULL, last_used_at TEXT);
   CREATE TABLE tokens (
     hash TEXT PRIMARY KEY, kind TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
     last_used_at TEXT, label TEXT);
   CREATE TABLE shares (token TEXT PRIMARY KEY, kind TEXT NOT NULL, target TEXT NOT NULL, created_at TEXT NOT NULL);
   CREATE INDEX shares_target ON shares (kind, target);`,
];

export function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec('CREATE TABLE IF NOT EXISTS migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = new Set(db.prepare('SELECT id FROM migrations').all().map((r) => r.id));
  MIGRATIONS.forEach((sql, i) => {
    const id = i + 1;
    if (done.has(id)) return;
    tx(db, () => {
      db.exec(sql);
      db.prepare('INSERT INTO migrations (id, applied_at) VALUES (?, ?)').run(id, new Date().toISOString());
    });
  });
  return db;
}

/** Runs fn in one transaction (rolled back when it throws). */
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/**
 * Consistent copies of the database: one at start (keeps the last 5) and one a day (last 14).
 * Asset files are not copied: they are written once under their id and never changed.
 */
export function backupDb(db, dir, kind, keep) {
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '');
  const file = join(dir, `db-${kind}-${stamp}.sqlite`);
  rmSync(file, { force: true });
  db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
  const old = readdirSync(dir)
    .filter((n) => n.startsWith(`db-${kind}-`) && n.endsWith('.sqlite'))
    .sort()
    .reverse()
    .slice(keep);
  for (const n of old) rmSync(join(dir, n), { force: true });
  return file;
}
