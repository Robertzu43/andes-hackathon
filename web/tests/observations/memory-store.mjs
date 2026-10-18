// In-memory test double for the store contract in store.mjs.
// JSON round-trips values to mimic IndexedDB structured-clone semantics.
// delayMs makes every operation yield for that long, so tests can reproduce
// interleavings that real (asynchronous) IndexedDB produces.
export function createMemoryStore({ delayMs = 0 } = {}) {
  const map = new Map();
  const copy = (value) => (value === undefined ? value : JSON.parse(JSON.stringify(value)));
  const wait = () => (delayMs > 0 ? new Promise((resolve) => setTimeout(resolve, delayMs)) : undefined);
  return {
    async get(key) { await wait(); return copy(map.get(key)); },
    async getAll() { await wait(); return copy([...map.values()]); },
    async put(key, record) { await wait(); map.set(key, copy(record)); },
    async delete(key) { await wait(); map.delete(key); },
    async clear() { await wait(); map.clear(); },
    async count() { await wait(); return map.size; },
  };
}

export function createMemoryStores(options = {}) {
  return { records: createMemoryStore(options), meta: createMemoryStore(options) };
}

// Unsigned JWT-shaped test token. The uploader only reads `sub` (to never
// send one owner's samples with another identity's credentials); the server
// does the verification.
export const tokenFor = (sub) => `e30.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.unsigned`;
