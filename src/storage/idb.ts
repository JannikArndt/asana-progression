/** Minimal promise wrapper around IndexedDB. */

export function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
    tx.onerror = () => reject(tx.error);
  });
}

export function openDatabase(
  factory: IDBFactory,
  name: string,
  version: number,
  upgrade: (db: IDBDatabase, oldVersion: number, tx: IDBTransaction) => void,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(name, version);
    req.onupgradeneeded = (e) => upgrade(req.result, e.oldVersion, req.transaction!);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Database upgrade blocked by another open tab'));
  });
}
