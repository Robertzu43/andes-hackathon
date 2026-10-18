// Runtime capture identities must not depend on a trip template or wall clock.
export function newObservationSessionId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    throw new Error('Cryptographic randomness is required for observation identity');
  }
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}
