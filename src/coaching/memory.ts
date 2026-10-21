// Optional post-trip note in Atomic Memory. Nothing on the trip, check, SOS or delivery path reads or waits for it.
// Wire contract: docs.atomicstrata.ai/api-reference/http (ingest/quick, by-external-id, DELETE /v1/memories/:id).
export interface CoachingNote { text: string }
export interface CoachingMemory {
  read(actorId: string): Promise<CoachingNote | null>;
  save(actorId: string, text: string): Promise<CoachingNote>;
  remove(actorId: string): Promise<boolean>;
}
export interface CoachingMemoryConfig { apiUrl: URL; apiKey: string; timeoutMs: number }
/** The provider failed, timed out or answered outside the documented contract; nothing about the note is known. */
export class CoachingMemoryUnavailable extends Error {}
// One record per driver: re-ingesting the same caller-owned externalId updates that record in place.
const EXTERNAL_ID = 'tandem-post-trip-note';
const NOTE_MAX = 280;
const loopback = ['localhost', '127.0.0.1', '[::1]'];
/** Both or neither: no URL and no key leaves the feature off; partial or malformed values are rejected by the parser. */
export function coachingMemoryConfig(env: NodeJS.ProcessEnv): CoachingMemoryConfig | null {
  const { ATOMICMEMORY_API_URL: url, ATOMICMEMORY_API_KEY: apiKey, ATOMICMEMORY_TIMEOUT_MS: timeout } = env;
  if (!url && !apiKey) return null;
  if (!url || !apiKey) throw new Error('ATOMICMEMORY_API_URL and ATOMICMEMORY_API_KEY are set together or not at all');
  let apiUrl: URL;
  try { apiUrl = new URL(url); } catch { throw new Error('ATOMICMEMORY_API_URL is not a URL'); }
  if (apiUrl.username || apiUrl.password || apiUrl.search || apiUrl.hash) throw new Error('ATOMICMEMORY_API_URL must be a plain origin');
  if (apiUrl.protocol !== 'https:' && !(apiUrl.protocol === 'http:' && loopback.includes(apiUrl.hostname))) throw new Error('ATOMICMEMORY_API_URL must use HTTPS (HTTP only on loopback)');
  const timeoutMs = Number(timeout ?? 2000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 5000) throw new Error('ATOMICMEMORY_TIMEOUT_MS must be an integer from 100 to 5000');
  return { apiUrl, apiKey, timeoutMs };
}
/** Startup entry: a partial or invalid memory configuration turns notes off with one warning; it never stops the safety backend. */
export function loadCoachingMemory(env: NodeJS.ProcessEnv, warn: (reason: string) => void, transport: typeof fetch = fetch): CoachingMemory | undefined {
  let config: CoachingMemoryConfig | null;
  try { config = coachingMemoryConfig(env); }
  catch (error) { warn(error instanceof Error ? error.message : 'invalid memory configuration'); return undefined; }
  return config ? createCoachingMemory(config, transport) : undefined;
}
// The memory subject comes only from the authenticated identity row, never from request input.
const subject = (actorId: string) => `tandem-driver:${actorId}`;
function record(value: unknown): { id: string; content: string } {
  if (value && typeof value === 'object' && 'id' in value && 'content' in value && typeof value.id === 'string' && value.id && typeof value.content === 'string') return { id: value.id, content: value.content };
  throw new CoachingMemoryUnavailable('unexpected memory record');
}
export function createCoachingMemory({ apiUrl, apiKey, timeoutMs }: CoachingMemoryConfig, transport: typeof fetch = fetch): CoachingMemory {
  // One deadline per driver action, shared by its calls, so a slow provider costs at most timeoutMs.
  async function call(signal: AbortSignal, method: string, path: string, query: Record<string, string>, body?: unknown) {
    const url = new URL(path, apiUrl);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    let response: Response;
    try {
      response = await transport(url, { method, signal, redirect: 'error', headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch { throw new CoachingMemoryUnavailable('memory request failed'); }
    if (response.status === 404 && method !== 'POST') return null;
    if (!response.ok) throw new CoachingMemoryUnavailable(`memory status ${response.status}`);
    try { const value: unknown = await response.json(); return value; } catch { throw new CoachingMemoryUnavailable('memory response was not JSON'); }
  }
  async function lookup(signal: AbortSignal, actorId: string) {
    const found = await call(signal, 'GET', `/v1/memories/by-external-id/${EXTERNAL_ID}`, { user_id: subject(actorId) });
    return found === null ? null : record(found);
  }
  const note = (content: string): CoachingNote => ({ text: content.slice(0, NOTE_MAX) });
  return {
    async read(actorId) {
      const found = await lookup(AbortSignal.timeout(timeoutMs), actorId);
      return found && note(found.content);
    },
    async save(actorId, text) {
      const signal = AbortSignal.timeout(timeoutMs);
      const result = await call(signal, 'POST', '/v1/memories/ingest/quick', {}, { user_id: subject(actorId), conversation: text, source_site: 'tandem',
        skip_extraction: true, content_class: 'summary', metadata: { externalId: EXTERNAL_ID } });
      if (!result || typeof result !== 'object' || !('stored_memory_ids' in result) || !Array.isArray(result.stored_memory_ids)) throw new CoachingMemoryUnavailable('unexpected ingest result');
      // Report only what reads back: a 200 alone does not prove which text the driver will see next time.
      const stored = await lookup(signal, actorId);
      if (stored?.content !== text) throw new CoachingMemoryUnavailable('saved note did not read back');
      return note(stored.content);
    },
    async remove(actorId) {
      const signal = AbortSignal.timeout(timeoutMs);
      const found = await lookup(signal, actorId);
      if (!found) return false;
      await call(signal, 'DELETE', `/v1/memories/${encodeURIComponent(found.id)}`, { user_id: subject(actorId) });
      if (await lookup(signal, actorId)) throw new CoachingMemoryUnavailable('deletion did not read back');
      return true;
    }
  };
}
export const noteSchema = { type: 'string', minLength: 1, maxLength: NOTE_MAX, pattern: '\\S' };
