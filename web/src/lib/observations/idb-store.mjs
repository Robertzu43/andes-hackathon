// IndexedDB-backed store collections for the observation queue.
// Thin wrapper: all queue semantics live in queue.mjs. This module only
// adapts the key/value contract in store.mjs onto IndexedDB and reports
// unavailable storage explicitly instead of degrading silently.

import { StorageUnavailableError } from './store.mjs';

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

class IdbCollection {
  constructor(db, storeName) {
    this.db = db;
    this.storeName = storeName;
  }

  store(mode) {
    return this.db.transaction(this.storeName, mode).objectStore(this.storeName);
  }

  async get(key) {
    return requestToPromise(this.store('readonly').get(key));
  }

  async getAll() {
    return (await requestToPromise(this.store('readonly').getAll())) ?? [];
  }

  async put(key, record) {
    const tx = this.db.transaction(this.storeName, 'readwrite');
    tx.objectStore(this.storeName).put(record);
    await transactionDone(tx);
  }

  async delete(key) {
    const tx = this.db.transaction(this.storeName, 'readwrite');
    tx.objectStore(this.storeName).delete(key);
    await transactionDone(tx);
  }

  async clear() {
    const tx = this.db.transaction(this.storeName, 'readwrite');
    tx.objectStore(this.storeName).clear();
    await transactionDone(tx);
  }

  async count() {
    return requestToPromise(this.store('readonly').count());
  }
}

// Opens (or creates) the queue database. Rejects with
// StorageUnavailableError when IndexedDB is missing, blocked or refused
// (private modes, disabled storage) so the host can surface an explicit
// unavailable state rather than pretend durability.
export function openIdbStores({ idbFactory = globalThis.indexedDB, dbName = 'andes-observations' } = {}) {
  if (!idbFactory || typeof idbFactory.open !== 'function') {
    return Promise.reject(new StorageUnavailableError('IndexedDB is not available in this context'));
  }
  return new Promise((resolve, reject) => {
    let request;
    try {
      request = idbFactory.open(dbName, 1);
    } catch (error) {
      reject(new StorageUnavailableError(`IndexedDB open threw: ${error?.message ?? 'unknown'}`));
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'queueId' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
    };
    request.onerror = () => reject(new StorageUnavailableError(`IndexedDB open failed: ${request.error?.message ?? 'unknown'}`));
    request.onblocked = () => reject(new StorageUnavailableError('IndexedDB open blocked by another context'));
    request.onsuccess = () => {
      const db = request.result;
      resolve({
        records: new IdbCollection(db, 'queue'),
        meta: new IdbCollection(db, 'meta'),
        close: () => db.close(),
      });
    };
  });
}

// Non-throwing variant for hosts: returns { ok: true, stores } or
// { ok: false, reason } so a page can render an explicit
// storage-unavailable state instead of crashing.
export async function openObservationStores(options = {}) {
  try {
    const stores = await openIdbStores(options);
    return { ok: true, stores };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof StorageUnavailableError ? error.message : `unexpected storage error: ${error?.message ?? 'unknown'}`,
    };
  }
}
