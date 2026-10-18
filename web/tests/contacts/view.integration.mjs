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

test('unverified gateway cannot fetch or mutate a feature', async () => {
  const f = fixture(); const view = createContactView(f.host, 'driver');
  try { view.start(); await view.loadContacts(); await view.revokeStanding(ids.grant);
    assert.equal(view.getSnapshot().status, 'closed'); assert.deepEqual(f.calls, []);
  } finally { view.stop(); f.cleanup(); }
});

test('real client and verified binding load contact references without manufacturing a driver; responses stay distinct', async () => {
  const f = fixture(); const view = createContactView(f.host, 'contact', ids.trip);
  try { view.start(); await f.host.gateway.begin();
    await until(() => view.getSnapshot().journey.incident.data !== null);
    assert.equal(view.getSnapshot().journey.trip.driverId, null);
    await view.acknowledge(); await view.reportAction('SYNTHETIC: cannot assist');
    const state = view.getSnapshot().journey;
    assert.deepEqual(state.receipts.map(r => r.recorded), ['acknowledged', 'action']);
    assert.equal(state.incident.data.status, 'active');
    assert.equal(f.calls.some(c => c.path.endsWith('/resolve')), false);
    assert.equal(f.calls.filter(c => c.path === '/v1/me').length, 2);
  } finally { view.stop(); f.cleanup(); }
});

test('lost revoke and refused same-key retry conceal views and cannot reopen protected reads', async () => {
  let attempt = 0;
  const f = fixture(call => { if (call.path.endsWith('/revoke')) {
    if (++attempt === 1) throw new TypeError('SYNTHETIC lost reply');
    return json({ code: 'conflict' }, 409);
  } });
  const view = createContactView(f.host, 'contact', ids.trip);
  try { view.start(); await f.host.gateway.begin(); await until(() => view.getSnapshot().journey.incident.data !== null);
    await view.revokeTrip(); assert.equal(view.getSnapshot().journey.operation.status, 'uncertain');
    await view.retry(); assert.equal(view.getSnapshot().journey.operation.status, 'uncertain');
    assert.equal(view.getSnapshot().journey.location.data, null); assert.equal(view.getSnapshot().journey.incident.data, null);
    const before = f.calls.length; await view.loadLocation(); await view.loadIncident();
    assert.equal(f.calls.length, before);
    const writes = f.calls.filter(c => c.path.endsWith('/revoke'));
    assert.equal(writes.length, 2); assert.equal(writes[0].key, writes[1].key); assert.equal(writes[0].body, writes[1].body);
  } finally { view.stop(); f.cleanup(); }
});

test('revoke retires a slow catalog even when the HTTP fixture ignores abort', async () => {
  const pending = deferred();
  const f = fixture(call => call.path === '/v1/contacts' ? pending.promise : undefined);
  const view = createContactView(f.host, 'driver');
  try { view.start(); await f.host.gateway.begin(); await until(() => view.getSnapshot().catalog.status === 'loading');
    await view.revokeStanding(ids.grant); pending.resolve(json({ contacts: [row()], limit: 100, hasMore: false }));
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(view.getSnapshot().catalog.data, null); assert.equal(view.getSnapshot().journey.operation.status, 'recorded');
  } finally { pending.resolve(json({})); view.stop(); f.cleanup(); }
});

test('401 clears both bound views, exposes session recovery and permits explicit re-authentication', async () => {
  let unauthorized = false;
  const f = fixture(call => unauthorized && call.path.endsWith('/snapshot') ? json({ code: 'unauthorized' }, 401) : undefined);
  const contact = createContactView(f.host, 'contact', ids.trip); const driver = createContactView(f.host, 'driver');
  try { contact.start(); driver.start(); await f.host.gateway.begin();
    await until(() => contact.getSnapshot().journey.incident.data && driver.getSnapshot().catalog.data);
    unauthorized = true; await contact.loadLocation();
    assert.equal(contact.getSnapshot().journey.session, null); assert.equal(driver.getSnapshot().journey.session, null);
    assert.equal(driver.getSnapshot().catalog.data, null); assert.equal(contact.getSnapshot().journey.incident.data, null);
    assert.equal(contact.getSnapshot().journey.location.data, null);
    assert.equal(f.host.session.snapshot().status, 'anonymous');
    assert.equal(f.host.gateway.getSnapshot().state, 'signed-out');
    assert.equal(contact.getSnapshot().status, 'closed');
    assert.equal(driver.getSnapshot().status, 'closed');

    unauthorized = false; await f.host.gateway.begin();
    await until(() => contact.getSnapshot().journey.location.data && contact.getSnapshot().journey.incident.data
      && driver.getSnapshot().catalog.data);
    assert.equal(f.host.gateway.getSnapshot().state, 'authenticated');
    assert.equal(contact.getSnapshot().status, 'ready');
    assert.equal(driver.getSnapshot().status, 'ready');
    assert.equal(contact.getSnapshot().journey.session.actorId, ids.contact);
    assert.equal(driver.getSnapshot().journey.session.actorId, ids.contact);
  } finally { contact.stop(); driver.stop(); f.cleanup(); }
});

test('catalog errors stay errors rather than empty success after a stop and restart', async () => {
  const f = fixture(call => call.path === '/v1/contacts' ? json({ code: 'internal' }, 500) : undefined);
  const view = createContactView(f.host, 'driver');
  try { view.start(); await f.host.gateway.begin(); await until(() => view.getSnapshot().catalog.status === 'error');
    assert.equal(view.getSnapshot().catalog.data, null); view.stop(); view.start();
    await until(() => view.getSnapshot().catalog.status === 'error'); view.stop();
    assert.equal(view.getSnapshot().journey.session, null); assert.equal(view.getSnapshot().catalog.data, null);
  } finally { view.stop(); f.cleanup(); }
});

test('gatekeeper R4: catalog denial preserves an uncertain invitation and its unchanged retry', async () => {
  for (const status of [403, 404]) {
    let denied = false; let attempts = 0;
    const f = fixture(call => {
      if (call.path === '/v1/contacts' && call.method === 'GET' && denied) return json({ code: 'denied' }, status);
      if (call.path === '/v1/contacts' && call.method === 'POST') {
        if (++attempts === 1) throw new TypeError('SYNTHETIC: reply lost after possible commit');
        return json({ id: ids.grant, status: 'pending' });
      }
    });
    const view = createContactView(f.host, 'driver');
    try { view.start(); await f.host.gateway.begin(); await until(() => view.getSnapshot().catalog.data);
      await view.invite({ contactId: ids.other, phone: '+5511000000000', map: true, incident: false });
      assert.equal(view.getSnapshot().journey.operation.status, 'uncertain');
      denied = true; await view.loadContacts();
      assert.equal(view.getSnapshot().catalog.status, 'error');
      assert.equal(view.getSnapshot().catalog.data, null);
      assert.equal(view.getSnapshot().journey.operation.status, 'uncertain');
      await view.retry();
      assert.equal(view.getSnapshot().journey.operation.status, 'recorded');
      const writes = f.calls.filter(call => call.path === '/v1/contacts' && call.method === 'POST');
      assert.equal(writes.length, 2);
      assert.equal(writes[0].key, writes[1].key); assert.equal(writes[0].body, writes[1].body);
    } finally { view.stop(); f.cleanup(); }
  }
});
