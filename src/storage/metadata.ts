import { openDatabase, request, transactionDone } from './idb';
import type { BatchOp, KeyValueStore, MetadataStore, Repository } from './types';

export const DB_NAME = 'asana-progression';
export const DB_VERSION = 1;

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
];

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

  get(key: string): Promise<T | undefined> {
    return this.run('readonly', (s) => s.get(key) as IDBRequest<T | undefined>);
  }

  async put(value: T): Promise<void> {
    await this.run('readwrite', (s) => s.put(value));
  }

  async delete(key: string): Promise<void> {
    await this.run('readwrite', (s) => s.delete(key));
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

export async function openMetadataStore(factory: IDBFactory = indexedDB, name = DB_NAME): Promise<MetadataStore> {
  const db = await openDatabase(factory, name, DB_VERSION, (database) => {
    for (const spec of STORES) {
      if (database.objectStoreNames.contains(spec.name)) continue;
      const store = database.createObjectStore(spec.name, { keyPath: spec.keyPath });
      for (const ix of spec.indexes ?? []) store.createIndex(ix.name, ix.keyPath, { multiEntry: ix.multiEntry ?? false });
    }
  });
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
    batch: async (ops: BatchOp[]) => {
      if (!ops.length) return;
      const tx = db.transaction([...new Set(ops.map((o) => o.store))], 'readwrite');
      const done = transactionDone(tx);
      try {
        for (const op of ops) {
          const store = tx.objectStore(op.store);
          if ('put' in op) store.put(op.put);
          else store.delete(op.delete);
        }
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
