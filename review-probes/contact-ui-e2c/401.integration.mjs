// Run in the composition produced by compose-ui.mjs; dependencies must exist, never silently skip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient, createSessionGateway, MemorySession } from '../../src/lib/api/index.ts';
import { createContactView } from '../../src/features/contacts/view-store.ts';
import { ids, point, incident, deferred } from './fixtures.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const row = () => ({ id: ids.grant, contactId: ids.contact, phone: '+5511000000000', status: 'accepted',
  map: { requested: true, accepted: true }, incident: { requested: true, accepted: true },
  acceptedAt: '2026-10-17T12:00:00.000Z', revokedAt: null, revokedBy: null });
async function until(predicate) {
  for (let count = 0; count < 100; count++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.fail('Expected state did not settle');
}
function fixture(handler) {
  const calls = []; const session = new MemorySession();
  const api = createApiClient({ baseUrl: 'https://synthetic.invalid', session, fetch: async (input, options) => {
    const path = new URL(String(input)).pathname; const method = options.method;
    const call = { path, method, key: new Headers(options.headers).get('Idempotency-Key'), body: options.body };
    calls.push(call);
    const replacement = await handler?.(call);
    if (replacement) return replacement;
    if (path === '/v1/me') return json({ id: ids.contact });
    if (path === '/v1/contacts') return json({ contacts: [row()], limit: 100, hasMore: false });
    if (path.endsWith('/snapshot')) return json(point());
    if (path === `/v1/incidents/${ids.incident}`) return json(incident());
    if (path.endsWith('/acknowledgements')) return json({ id: ids.incident, status: 'active', recorded: 'acknowledged' });
    if (path.endsWith('/actions')) return json({ id: ids.incident, status: 'active', recorded: 'action' });
    if (path.endsWith('/revoke')) return json({ id: ids.grant, tripId: ids.trip, revoked: true });
    return json({ code: 'not_found' }, 404);
  } });
  const gateway = createSessionGateway({ api, session, mode: 'demo', acquire: async () => ({
    issuer: 'synthetic', subject: 'synthetic', accessToken: 'synthetic-token', expiresAt: Date.now() + 60000,
  }) });
  const host = { api, session, gateway, incidentReference: () => ids.incident, grantReference: () => ids.grant };
  return { host, calls, cleanup: () => gateway.dispose() };
}

test('Q52 401 clears data and reaches a closed recoverable view rather than permanent verification', async()=>{
 let unauthorized=false;const f=fixture(c=>unauthorized&&c.path.endsWith('/snapshot')?json({code:'unauthorized'},401):undefined);
 const view=createContactView(f.host,'contact',ids.trip);
 try{view.start();await f.host.gateway.begin();await until(()=>view.getSnapshot().journey.incident.data!==null);
 unauthorized=true;await view.loadLocation();await new Promise(r=>setTimeout(r,30));
 const actual={gateway:f.host.gateway.getSnapshot().state,status:view.getSnapshot().status,session:view.getSnapshot().journey.session,location:view.getSnapshot().journey.location.data};console.log(JSON.stringify(actual));
 assert.equal(actual.gateway,'signed-out');assert.equal(actual.session,null);assert.equal(actual.location,null);assert.equal(actual.status,'closed');
 }finally{view.stop();f.cleanup();}
});
