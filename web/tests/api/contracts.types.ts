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

const loaded = await api.getBootstrap();
const more: boolean = loaded.hasMore.contacts;
const limit: 50 = loaded.limits.activeTrips;
void more; void limit;
// @ts-expect-error owner selection is authenticated, not an input parameter
api.getBootstrap({ ownerId: 'another-actor' });
// @ts-expect-error the published read contract supplies no server readAt
const readAt: string = loaded.readAt;
// @ts-expect-error summaries never include raw draft text
const rawText: string = loaded.trips.active[0]?.rawText;
void readAt; void rawText;

import { createSessionGateway } from '../../src/lib/api/index.ts';
const gateway = createSessionGateway({ session: new MemorySession(), api, mode: 'external' });
const mode: 'external' | 'demo' = gateway.getSnapshot().mode;
void mode;
// @ts-expect-error the UI gateway cannot expose a credential
const gatewayToken: string = gateway.getSnapshot().accessToken;
void gatewayToken;

// Additive PR74 operations keep the demo exception explicit and status source-only.
api.getTripStatus('11111111-1111-4111-8111-111111111111');
api.setSharing('11111111-1111-4111-8111-111111111111', { state: 'stopped', reason: 'page_hidden' }, key);
api.createDemoSession({ demo: true });
// @ts-expect-error anonymous demo creation requires an explicit demo choice
api.createDemoSession();
// @ts-expect-error normal sharing mutations still require the caller's captured key
api.setSharing('id', { state: 'resumed', reason: 'user' });
// @ts-expect-error the server exposes no read-time field in this status contract
const statusReadAt: string = (await api.getTripStatus('id')).readAt;
void statusReadAt;
