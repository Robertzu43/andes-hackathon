import { createApiClient, MemorySession } from '../../src/lib/api/index.ts';
import type { LocationSnapshot, TripDraft } from '../../src/lib/api/index.ts';

const api = createApiClient({ baseUrl: 'https://api.example.invalid', session: new MemorySession() });
const key = { idempotencyKey: 'one-explicit-intent' };
const draft: Promise<TripDraft> = api.createDraft({ text: 'synthetic' }, key);
const snapshot: Promise<LocationSnapshot> = api.getSnapshot('11111111-1111-4111-8111-111111111111');
void draft; void snapshot;
// These assertions are compile-only and must never make HTTP calls.
// @ts-expect-error a mutation cannot omit its idempotency key
api.reportSos('id');
// @ts-expect-error only literal explicit confirmation can activate a draft
api.confirmTrip('id', { confirmed: false, contactGrantIds: [] }, key);
// @ts-expect-error audio transcription is unsupported by the actual contract
api.createDraft({ audio: 'unimplemented' }, key);
// @ts-expect-error command names must come from the actual HTTP contract
api.commandTrip('id', 'declare_safe', key);
// @ts-expect-error provider delivery is never the contact acknowledgement result
const delivered: 'delivered' = (await api.acknowledgeIncident('id', key)).recorded;
void delivered;
