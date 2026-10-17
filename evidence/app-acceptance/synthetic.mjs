import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BACKEND_SHA, SCHEMA } from './oracle.mjs';
const exchange = (method, route, actor, response, request = {}, status = 200) =>
  ({ method, route, actor, request, status, response });
const fields = { truckId: 'synthetic-truck', origin: 'A', destination: 'B', country: 'BR', locale: 'pt-BR', timeZone: 'America/Sao_Paulo' };
export function syntheticControl() {
  const snapshot = (stale = false) => ({ tripId: 'synthetic-trip',
    location: { capturedAt: '2026-10-17T12:00:00.000Z', receivedAt: '2026-10-17T12:00:01.000Z' },
    readAt: stale ? '2026-10-17T12:02:01.000Z' : '2026-10-17T12:00:02.000Z',
    freshness: stale ? 'stale' : 'fresh', ageMs: stale ? 121000 : 2000 });
  const sos = () => ({ id: 'synthetic-incident', tripId: 'synthetic-trip', status: 'active', groupCapability: 'unavailable' });
  return { schema: SCHEMA, kind: 'synthetic-control', backendSha: BACKEND_SHA,
    externalSends: false, isolatedDatabase: true, producer: 'lane52-authored-synthetic-control',
    command: 'node evidence/app-acceptance/synthetic.mjs', cases: [
      { id: 'setup', steps: [
        exchange('GET', '/v1/me', 'driver', { id: 'synthetic-driver' }),
        exchange('POST', '/v1/trucks', 'driver', { id: 'synthetic-truck' }, { label: 'SYNTHETIC' }),
        exchange('POST', '/v1/contacts', 'driver', { id: 'synthetic-grant', status: 'pending' }, { map: true, incident: true }),
        exchange('POST', '/v1/contacts/:id/accept', 'contact', { id: 'synthetic-grant', status: 'accepted', map: true, incident: false }, { map: true, incident: false }),
      ] },
      { id: 'explicit-confirm', steps: [
        exchange('POST', '/v1/trip-drafts', 'driver', { id: 'synthetic-trip', status: 'draft' }, { fields: { ...fields } }),
        exchange('POST', '/v1/trip-drafts/:id/confirm', 'driver', { id: 'synthetic-trip', status: 'active', fields: { ...fields } }, { confirmed: true, contactGrantIds: ['synthetic-grant'] }),
      ] },
      { id: 'duplicate-confirm', steps: [
        { ...exchange('POST', '/v1/trip-drafts/:id/confirm', 'driver', { id: 'synthetic-trip', status: 'active' }), keyAlias: 'same-key' },
        { ...exchange('POST', '/v1/trip-drafts/:id/confirm', 'driver', { id: 'synthetic-trip', status: 'active' }), keyAlias: 'same-key' },
        { ...exchange('POST', '/v1/trip-drafts/:id/confirm', 'driver', { code: 'draft_already_confirmed' }, {}, 409), keyAlias: 'new-key' },
      ] },
      { id: 'stale-snapshot', steps: [
        exchange('GET', '/v1/trips/:id/snapshot', 'contact', snapshot()),
        exchange('GET', '/v1/trips/:id/snapshot', 'contact', snapshot(true)),
      ] },
      { id: 'unavailable-snapshot', steps: [exchange('GET', '/v1/trips/:id/snapshot', 'contact', { location: null, ageMs: null, freshness: 'unavailable' })] },
      { id: 'revocation', steps: [
        exchange('POST', '/v1/trips/:id/contacts/:grantId/revoke', 'contact', { revoked: true }),
        exchange('GET', '/v1/trips/:id/snapshot', 'contact', { code: 'forbidden' }, {}, 403),
        exchange('GET', '/v1/incidents/:id', 'contact', { code: 'forbidden' }, {}, 403),
      ] },
      { id: 'sos-acceptance', steps: [exchange('POST', '/v1/trips/:id/sos', 'driver', sos()), exchange('POST', '/v1/trips/:id/sos', 'driver', sos())] },
      { id: 'acknowledgement-action', steps: [
        exchange('POST', '/v1/incidents/:id/acknowledgements', 'contact', { id: 'synthetic-incident', status: 'active', recorded: 'acknowledged' }),
        exchange('POST', '/v1/incidents/:id/actions', 'contact', { id: 'synthetic-incident', status: 'active', recorded: 'action' }, { action: 'SYNTHETIC reported action; not corroboration' }),
      ] },
      { id: 'arrival-preserves-sos', steps: [
        exchange('POST', '/v1/trips/:id/sos', 'driver', sos()),
        exchange('POST', '/v1/trips/:id/commands', 'driver', { command: 'arrived' }, { type: 'arrived' }),
        exchange('GET', '/v1/incidents/:id', 'contact', { id: 'synthetic-incident', status: 'active', resolvedAt: null }),
        exchange('GET', '/v1/trips/:id/snapshot', 'contact', { code: 'map_inactive' }, {}, 403),
      ] },
      { id: 'owner-resolution', steps: [
        exchange('POST', '/v1/incidents/:id/resolve', 'contact', { code: 'forbidden' }, {}, 403),
        exchange('POST', '/v1/incidents/:id/resolve', 'driver', { status: 'resolved' }),
      ] },
      { id: 'cross-user', steps: [exchange('GET', '/v1/trips/:id', 'stranger', { code: 'forbidden' }, {}, 403), exchange('POST', '/v1/trips/:id/sos', 'stranger', { code: 'forbidden' }, {}, 403)] },
      { id: 'self-report', steps: ['checkin_ok', 'rest_report'].map(type => exchange('POST', '/v1/trips/:id/commands', 'driver', { command: type, automaticEscalation: false }, { type })) },
    ] };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(syntheticControl(), null, 2));
