import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, MemorySession, bindJourneySession, createApiClient, createContactApi } from '../../src/lib/api/index.ts';

const actor = '11111111-1111-4111-8111-111111111111';
const resource = '22222222-2222-4222-8222-222222222222';
const stamp = '2026-10-17T12:00:00.000Z';
function credentials(subject = 'synthetic-A', expiresAt = Date.now() + 60_000) {
  return { issuer: 'https://identity.example.invalid', subject, accessToken: `synthetic.${subject}`, expiresAt };
}
function setup(fetch) {
  const session = new MemorySession(); session.setCredentials(credentials());
  const api = createApiClient({ baseUrl: 'https://api.example.invalid', session, fetch });
  return { session, api };
}

test('contact facade maps actual aliases and preserves original write key, signal and action', async () => {
  const calls = [];
  const { api } = setup(async (url, init) => {
    calls.push({ path: url.pathname, key: init.headers['Idempotency-Key'], body: init.body });
    if (init.method === 'GET') return Response.json({ tripId: resource, location: null, freshness: 'unavailable', ageMs: null, readAt: stamp });
    return Response.json({ id: resource, status: 'active', recorded: 'action' });
  });
  const contact = createContactApi(api);
  assert.equal((await contact.getTripSnapshot(resource, {})).freshness, 'unavailable');
  const controller = new AbortController();
  assert.equal((await contact.reportIncidentAction(resource, { action: 'Synthetic reported action' },
    { idempotencyKey: 'original-intent', signal: controller.signal })).recorded, 'action');
  assert.deepEqual(calls, [
    { path: `/v1/trips/${resource}/snapshot`, key: undefined, body: undefined },
    { path: `/v1/incidents/${resource}/actions`, key: 'original-intent', body: JSON.stringify({ action: 'Synthetic reported action' }) },
  ]);
});

test('contact facade preserves exact ApiError ambiguity and status without retrying', async () => {
  let calls = 0;
  const { api } = setup(async () => { calls += 1; if (calls === 1) throw new Error('synthetic loss'); return Response.json({ code: 'consent_revoked' }, { status: 409 }); });
  const contact = createContactApi(api);
  await assert.rejects(contact.revokeContact(resource, { idempotencyKey: 'same-intent' }),
    error => error instanceof ApiError && error.outcome === 'unknown' && error.kind === 'network');
  assert.equal(calls, 1);
  await assert.rejects(contact.revokeContact(resource, { idempotencyKey: 'same-intent' }),
    error => error.status === 409 && error.outcome === 'rejected' && error.code === 'consent_revoked');
  assert.equal(calls, 2); // The feature must retain the first request's unknown outcome separately.
});

test('session binding activates only from the server UUID and clears immediately on signout/rotation', async () => {
  const { session, api } = setup(async () => Response.json({ id: actor }));
  let selected = 'old-cache';
  const binding = bindJourneySession(session, api, id => { selected = id; });
  assert.equal(selected, null);
  assert.deepEqual(await binding.activate(), { id: actor });
  assert.equal(selected, actor); // Never the synthetic OIDC subject.
  session.setCredentials(credentials('synthetic-B'));
  assert.equal(selected, null);
  await binding.activate();
  session.clear();
  assert.equal(selected, null);
  binding.dispose(); binding.dispose();
});

test('session binding cannot activate an old response after account change or disposal', async () => {
  for (const change of ['account', 'dispose']) {
    let finish;
    const { session, api } = setup(async () => new Promise(resolve => { finish = resolve; }));
    let selected;
    const binding = bindJourneySession(session, api, id => { selected = id; });
    const pending = binding.activate();
    if (change === 'account') session.setCredentials(credentials('synthetic-B'));
    else binding.dispose();
    finish(Response.json({ id: actor }));
    await assert.rejects(pending, error => error.kind === 'session_changed');
    assert.equal(selected, null);
    binding.dispose();
  }
});

test('401 invalidates every bound protected journey without inventing another identity', async () => {
  let deny = false;
  const { session, api } = setup(async () => deny ? Response.json({ code: 'unauthorized' }, { status: 401 }) : Response.json({ id: actor }));
  let contactActor, driverActor;
  const contact = bindJourneySession(session, api, id => { contactActor = id; });
  const driver = bindJourneySession(session, api, id => { driverActor = id; });
  await contact.activate(); await driver.activate();
  deny = true;
  await assert.rejects(api.getIdentity(), error => error.status === 401);
  assert.equal(contactActor, null); assert.equal(driverActor, null);
  assert.deepEqual(session.snapshot(), { status: 'anonymous' });
  contact.dispose(); driver.dispose();
});

test('subscribed session expires and clears a view without another request', async () => {
  const session = new MemorySession();
  session.setCredentials(credentials('synthetic-A', Date.now() + 25));
  let selected = actor;
  const unsubscribe = session.subscribe(() => { selected = null; });
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(selected, null);
  assert.deepEqual(session.snapshot(), { status: 'expired' });
  unsubscribe();
});

test('one failing view cannot prevent other views clearing; unsubscribe retires callbacks', () => {
  const session = new MemorySession();
  session.setCredentials(credentials());
  const bad = session.subscribe(() => { throw new Error('synthetic view failure'); });
  let clears = 0;
  const good = session.subscribe(() => { clears += 1; });
  session.clear();
  assert.equal(clears, 1);
  good(); session.setCredentials(credentials());
  assert.equal(clears, 1);
  bad(); session.clear();
});
