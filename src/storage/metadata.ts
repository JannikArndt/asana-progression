import { isDeviceSetting } from './device-settings';
import { openDatabase, request, transactionDone } from './idb';
import type { BatchOp, KeyValueStore, MetadataStore, Outbox, OutboxEntry, Repository, SyncedStore } from './types';

export const DB_NAME = 'asana-progression';
/** v2: `outbox` (changes waiting for the server). */
export const DB_VERSION = 2;

interface StoreSpec {
  name: string;
  keyPath: string;
  indexes?: Array<{ name: string; keyPath: string; multiEntry?: boolean }>;
}

const STORES: StoreSpec[] = [
  { name: 'asanas', keyPath: 'id' },
  { name: 'templates', keyPath: 'id' },
  { name: 'sessions', keyPath: 'id', indexes: [{ name: 'date', keyPath: 'date' }, { name: 'videoIds', keyPath: 'videoIds', multiEntry: true }] },
  { name: 'videos', keyPath: 'id', indexes: [{ name: 'fingerprint', keyPath: 'fingerprint' }] },
  { name: 'analyses', keyPath: 'videoId' },
  {
    name: 'holds',
    keyPath: 'id',
    indexes: [
      { name: 'asanaId', keyPath: 'asanaId' },
      { name: 'sessionId', keyPath: 'sessionId' },
      { name: 'videoId', keyPath: 'videoId' },
    ],
  },
  { name: 'assets', keyPath: 'id', indexes: [{ name: 'holdId', keyPath: 'holdId' }] },
  { name: 'jobs', keyPath: 'videoId', indexes: [{ name: 'fingerprint', keyPath: 'fingerprint' }] },
  { name: 'settings', keyPath: 'key' },
  { name: 'outbox', keyPath: 'id' },
];

const KEY_PATH: Record<string, string> = Object.fromEntries(STORES.map((s) => [s.name, s.keyPath]));
const SYNCED = new Set<string>(['asanas', 'templates', 'sessions', 'videos', 'analyses', 'holds', 'assets', 'settings']);

let lastStamp = 0;
/** Strictly increasing per page (and in practice across workers: milliseconds × 1000). */
function stamp(): number {
  lastStamp = Math.max(lastStamp + 1, Date.now() * 1000);
  return lastStamp;
}

/** The outbox entry a write produces, or null for stores and settings that are not synced. */
function entryFor(store: string, key: unknown): OutboxEntry | null {
  if (!SYNCED.has(store) || typeof key !== 'string') return null;
  if (store === 'settings' && isDeviceSetting(key)) return null;
  return { id: `${store}/${key}`, store: store as SyncedStore, key, at: stamp() };
}

function keyOf(store: string, value: unknown): unknown {
  return (value as Record<string, unknown> | null)?.[KEY_PATH[store]!];
}

class IdbRepository<T> implements Repository<T> {
  constructor(
    private readonly db: IDBDatabase,
    private readonly store: string,
  ) {}

  private async run<R>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<R>): Promise<R> {
    const tx = this.db.transaction(this.store, mode);
    const [result] = await Promise.all([request(fn(tx.objectStore(this.store))), transactionDone(tx)]);
    return result;
  }

  /** A write plus its outbox entry in one transaction. */
  private async write(key: unknown, fn: (s: IDBObjectStore) => IDBRequest): Promise<void> {
    const entry = entryFor(this.store, key);
    if (!entry) {
      await this.run('readwrite', fn);
      return;
    }
    const tx = this.db.transaction([this.store, 'outbox'], 'readwrite');
    const done = transactionDone(tx);
    fn(tx.objectStore(this.store));
    tx.objectStore('outbox').put(entry);
    await done;
  }

  get(key: string): Promise<T | undefined> {
    return this.run('readonly', (s) => s.get(key) as IDBRequest<T | undefined>);
  }

  async put(value: T): Promise<void> {
    await this.write(keyOf(this.store, value), (s) => s.put(value));
  }

  async delete(key: string): Promise<void> {
    await this.write(key, (s) => s.delete(key));
  }

  all(): Promise<T[]> {
    return this.run('readonly', (s) => s.getAll() as IDBRequest<T[]>);
  }

  findBy(index: string, value: IDBValidKey): Promise<T[]> {
    return this.run('readonly', (s) => s.index(index).getAll(value) as IDBRequest<T[]>);
  }
}

class IdbKeyValue implements KeyValueStore {
  private readonly repo: IdbRepository<{ key: string; value: unknown }>;

  constructor(db: IDBDatabase) {
    this.repo = new IdbRepository(db, 'settings');
  }

  async get<T>(key: string): Promise<T | undefined> {
    return (await this.repo.get(key))?.value as T | undefined;
  }

  set<T>(key: string, value: T): Promise<void> {
    return this.repo.put({ key, value });
  }

  delete(key: string): Promise<void> {
    return this.repo.delete(key);
  }

  entries(): Promise<Array<{ key: string; value: unknown }>> {
    return this.repo.all();
  }
}

class IdbOutbox implements Outbox {
  constructor(private readonly db: IDBDatabase) {}

  private async run<R>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<R>): Promise<R> {
    const tx = this.db.transaction('outbox', mode);
    const [result] = await Promise.all([request(fn(tx.objectStore('outbox'))), transactionDone(tx)]);
    return result;
  }

  async list(limit?: number): Promise<OutboxEntry[]> {
    const all = await this.run('readonly', (s) => s.getAll() as IDBRequest<OutboxEntry[]>);
    all.sort((a, b) => a.at - b.at);
    return limit === undefined ? all : all.slice(0, limit);
  }

  count(): Promise<number> {
    return this.run('readonly', (s) => s.count());
  }

  async ack(entries: OutboxEntry[]): Promise<void> {
    if (!entries.length) return;
    const tx = this.db.transaction('outbox', 'readwrite');
    const done = transactionDone(tx);
    const store = tx.objectStore('outbox');
    for (const e of entries) {
      const req = store.get(e.id) as IDBRequest<OutboxEntry | undefined>;
      req.onsuccess = () => {
        if (req.result && req.result.at === e.at) store.delete(e.id);
      };
    }
    await done;
  }

  async pendingIds(): Promise<Set<string>> {
    return new Set((await this.run('readonly', (s) => s.getAllKeys())) as string[]);
  }
}

export async function openMetadataStore(factory: IDBFactory = indexedDB, name = DB_NAME): Promise<MetadataStore> {
  const db = await openDatabase(factory, name, DB_VERSION, (database) => {
    for (const spec of STORES) {
      if (database.objectStoreNames.contains(spec.name)) continue;
      const store = database.createObjectStore(spec.name, { keyPath: spec.keyPath });
      for (const ix of spec.indexes ?? []) store.createIndex(ix.name, ix.keyPath, { multiEntry: ix.multiEntry ?? false });
    }
  });
  // A newer version (an update in another tab) must not be blocked by this connection.
  db.onversionchange = () => db.close();
  const repo = <T>(store: string) => new IdbRepository<T>(db, store);
  return {
    asanas: repo('asanas'),
    templates: repo('templates'),
    sessions: repo('sessions'),
    videos: repo('videos'),
    analyses: repo('analyses'),
    holds: repo('holds'),
    assets: repo('assets'),
    jobs: repo('jobs'),
    settings: new IdbKeyValue(db),
    outbox: new IdbOutbox(db),
    batch: async (ops: BatchOp[], opts: { track?: boolean } = {}) => {
      if (!ops.length) return;
      const track = opts.track ?? true;
      const entries = track ? ops.map((o) => entryFor(o.store, 'put' in o ? keyOf(o.store, o.put) : o.delete)) : [];
      const names = new Set<string>(ops.map((o) => o.store));
      if (entries.some(Boolean)) names.add('outbox');
      const tx = db.transaction([...names], 'readwrite');
      const done = transactionDone(tx);
      try {
        ops.forEach((op, i) => {
          const store = tx.objectStore(op.store);
          if ('put' in op) store.put(op.put);
          else store.delete(op.delete);
          const e = entries[i];
          if (e) tx.objectStore('outbox').put(e);
        });
      } catch (e) {
        tx.abort();
        await done.catch(() => {});
        throw e;
      }
      await done;
    },
    close: () => db.close(),
  };
}
