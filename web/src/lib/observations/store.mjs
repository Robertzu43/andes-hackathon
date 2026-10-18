// Storage contract for the durable observation queue.
//
// The queue never talks to IndexedDB directly. It talks to two narrow
// collections (one for queue records, one for queue meta) behind this
// interface, so tests can inject an in-memory double and the browser host
// injects the IndexedDB implementation from idb-store.mjs. Every method is
// async and every value is JSON-safe.

export class StorageUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StorageUnavailableError';
  }
}

// Interface (implemented by idb-store.mjs and by test doubles):
//   get(key)           -> Promise<record | undefined>
//   getAll()           -> Promise<record[]>
//   put(key, record)   -> Promise<void>
//   delete(key)        -> Promise<void>
//   clear()            -> Promise<void>
//   count()            -> Promise<number>
//
// `key` must equal the record's own key field (`queueId` for records,
// `id` for meta), matching the IndexedDB keyPath.
