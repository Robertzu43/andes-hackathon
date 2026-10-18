// Development-only synthetic HTTP replies. No real auth, backend, delivery or participants.
import { createRoot } from 'react-dom/client';
import { FoundationRoot } from '../../src/foundation/index.ts';
import { createApiClient, createSessionGateway, MemorySession } from '../../src/lib/api/index.ts';
import { createContactRoutes } from '../../src/features/contacts/routes.tsx';
import '../../src/styles/tokens.css';
import '../../src/styles/foundation.css';

if (!import.meta.env.DEV) throw new Error('Synthetic contact fixture is development-only');
const params = new URLSearchParams(location.search);
const id = { driver: '00000000-0000-4000-8000-000000000001', contact: '00000000-0000-4000-8000-000000000002',
  trip: '00000000-0000-4000-8000-000000000003', grant: '00000000-0000-4000-8000-000000000004', incident: '00000000-0000-4000-8000-000000000005' };
const screen = params.get('screen');
const route = screen === 'trip' ? `/contact/trips/${id.trip}` : screen === 'invitation' ? `/contact/invitations/${id.grant}`
  : screen === 'privacy' ? '/privacy' : '/contacts';
history.replaceState(null, '', route);
const fixture = {
  mode: params.get('scenario') ?? 'normal', calls: [] as { method: string; path: string; key: string | null; body: string | null }[],
  identity: screen === 'trip' || screen === 'invitation' ? id.contact : id.driver,
  revoked: false, attempts: 0,
};
const row = () => ({ id: id.grant, contactId: id.contact, role: 'family', map: { requested: true, accepted: true },
  incident: { requested: true, accepted: true }, status: fixture.revoked ? 'revoked' : 'accepted',
  acceptedAt: '2026-10-17T12:00:00.000Z', revokedAt: fixture.revoked ? '2026-10-17T12:01:00.000Z' : null,
  revokedBy: fixture.revoked ? 'driver' : null });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const session = new MemorySession();
const api = createApiClient({ baseUrl: 'https://synthetic.invalid', session, fetch: async (input, init) => {
  const path = new URL(String(input)).pathname; const method = init?.method ?? 'GET';
  const key = new Headers(init?.headers).get('Idempotency-Key');
  fixture.calls.push({ method, path, key, body: typeof init?.body === 'string' ? init.body : null });
  if (fixture.mode === 'slow') await new Promise(resolve => setTimeout(resolve, 450));
  if (path === '/v1/me') return json({ id: fixture.identity });
  if (fixture.mode === 'unauthorized') return json({ code: 'unauthorized' }, 401);
  if (fixture.mode === 'forbidden' || fixture.revoked && path.endsWith('/snapshot')) return json({ code: 'forbidden' }, 403);
  if (fixture.mode === 'server-error') return json({ code: 'internal' }, 500);
  if (fixture.mode === 'map-denied' && path.endsWith('/snapshot')) return json({ code: 'map_inactive' }, 403);
  if (fixture.mode === 'incident-denied' && method === 'GET' && path.startsWith('/v1/incidents/')) return json({ code: 'denied' }, 403);
  if (method === 'GET' && path === '/v1/contacts') return json({ contacts: fixture.mode === 'empty' ? [] : [row()], limit: 100,
    hasMore: fixture.mode === 'truncated', readAt: '2026-10-17T12:03:00.000Z' });
  // GET /v1/trips/:id/status (#74). Map-only contacts get no check, incident or deliveries.
  if (method === 'GET' && path === `/v1/trips/${id.trip}/status`) {
    const hidden = fixture.mode === 'map-only' || fixture.mode === 'asking';
    return json({ trip: { status: 'active', paused: false, expectedArrivalAt: null },
      check: fixture.mode === 'asking' ? { status: 'asking', reason: 'sharing_stopped', askUntil: '2026-10-17T12:06:00.000Z' } : null,
      incident: hidden ? null : { id: id.incident, trigger: 'missed_check', checkReason: 'silence',
        status: fixture.mode === 'resolved' ? 'resolved' : 'active', label: 'sin_senal', createdAt: '2026-10-17T12:00:00.000Z' },
      deliveries: hidden ? [] : [{ role: 'colleague', channel: 'sms', status: 'pending', unavailableReason: null },
        { role: 'group', channel: 'group', status: 'unavailable', unavailableReason: 'group_support_unverified' }] });
  }
  if (fixture.mode === 'map-only' && method === 'GET' && path.startsWith('/v1/incidents/')) return json({ code: 'forbidden' }, 403);
  if (path.endsWith('/snapshot')) return json({ tripId: id.trip, readAt: '2026-10-17T12:03:00.000Z',
    location: fixture.mode === 'no-location' ? null : { latitude: -23.55, longitude: -46.63, accuracy: 25,
      capturedAt: '2026-10-17T12:00:00.000Z', receivedAt: '2026-10-17T12:02:59.000Z' },
    ageMs: fixture.mode === 'no-location' ? null : 180000, freshness: fixture.mode === 'no-location' ? 'unavailable' : 'stale' });
  if (method === 'GET' && path === `/v1/incidents/${id.incident}`) return json({ id: id.incident, tripId: id.trip,
    status: fixture.mode === 'resolved' ? 'resolved' : 'active', createdAt: '2026-10-17T12:00:00.000Z',
    resolvedAt: fixture.mode === 'resolved' ? '2026-10-17T12:05:00.000Z' : null, groupCapability: 'unavailable' });
  if (method === 'POST' && path === '/v1/contacts') {
    if (fixture.mode === 'unknown-invite' && fixture.attempts++ === 0) throw new TypeError('SYNTHETIC invitation reply lost');
    return json({ id: id.grant, status: 'pending' });
  }
  if (path.endsWith('/revoke')) {
    fixture.attempts++;
    if (fixture.mode === 'unknown-revoke' && fixture.attempts === 1) throw new TypeError('SYNTHETIC lost reply');
    if (fixture.mode === 'unknown-revoke' && fixture.attempts > 1) return json({ code: 'conflict' }, 409);
    fixture.revoked = true;
    return json({ id: id.grant, revoked: true, ...(path.includes('/trips/') ? { tripId: id.trip } : {}) });
  }
  if (path.endsWith('/acknowledgements')) return json({ id: id.incident, status: 'active', recorded: 'acknowledged' });
  if (path.endsWith('/actions')) return json({ id: id.incident, status: 'active', recorded: 'action' });
  return json({ code: 'not_found' }, 404);
} });
const gateway = createSessionGateway({ api, session, mode: 'demo', acquire: async () => ({ issuer: 'synthetic-test',
  subject: 'synthetic-contact-fixture', accessToken: 'synthetic-not-an-oidc-token', expiresAt: Date.now() + 600000 }) });
const routes = createContactRoutes({ api, session, gateway,
  incidentReference: params.get('references') === 'missing' ? undefined : () => id.incident,
  grantReference: params.get('references') === 'missing' ? undefined : () => id.grant,
});
Object.assign(window, { __CONTACT_FIXTURE__: fixture, __CONTACT_GATEWAY__: gateway });
if (params.get('scenario') !== 'signed-out') await gateway.begin?.();
createRoot(document.getElementById('root')!).render(<FoundationRoot routes={routes} session={gateway}
  initialLocale={params.get('locale') === 'pt-BR' ? 'pt-BR' : 'es'} />);
