// In-memory test double for the store contract in store.mjs.
// JSON round-trips values to mimic IndexedDB structured-clone semantics.
export function createMemoryStore() {
  const map = new Map();
  const copy = (value) => (value === undefined ? value : JSON.parse(JSON.stringify(value)));
  return {
    async get(key) { return copy(map.get(key)); },
    async getAll() { return copy([...map.values()]); },
    async put(key, record) { map.set(key, copy(record)); },
    async delete(key) { map.delete(key); },
    async clear() { map.clear(); },
    async count() { return map.size; },
  };
}

export function createMemoryStores() {
  return { records: createMemoryStore(), meta: createMemoryStore() };
}
