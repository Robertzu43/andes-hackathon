// Explicit opt-in: actual pinned API + PostgreSQL, synthetic signed identities only.
// This is not the lane45/browser binding or a replacement for lane41 catalog routes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { createDriverJourney } from '../../src/features/driver/controller.mjs';

const root = process.env.ANDES_DRIVER_RUNTIME_ROOT;
assert.ok(root, 'Set ANDES_DRIVER_RUNTIME_ROOT to the built pinned backend archive');
assert.ok(process.env.TEST_DATABASE_URL, 'Use a lane-owned disposable PostgreSQL database');
const fromRuntime = (path) => import(pathToFileURL(`${root}/${path}`));
const { fixture } = await fromRuntime('tests/helpers/runtime.mjs');
const { createContext } = await fromRuntime('dist/db.js');
const { createApp } = await fromRuntime('dist/api/app.js');
const requireRuntime = createRequire(`${root}/package.json`);
const { generateKeyPair, SignJWT } = await import(pathToFileURL(requireRuntime.resolve('jose')));

// Test-only mapping of already implemented routes to the controller's injected port.
function apiPort(f, jwt = f.driver) {
  return async ({ operation, params, body, idempotencyKey }, { signal }) => {
    if (signal.aborted) return { kind: 'unknown', code: 'cancelled' };
    const route = {
      createTruck: ['POST', '/v1/trucks'], createDraft: ['POST', '/v1/trip-drafts'],
      confirmDraft: ['POST', `/v1/trip-drafts/${params.id}/confirm`],
      command: ['POST', `/v1/trips/${params.id}/commands`], sos: ['POST', `/v1/trips/${params.id}/sos`],
      readTrip: ['GET', `/v1/trips/${params.id}`], readSnapshot: ['GET', `/v1/trips/${params.id}/snapshot`],
      readIncident: ['GET', `/v1/incidents/${params.id}`],
    }[operation];
    assert.ok(route, 'Only sourced backend routes are available to this test port');
    const response = await f.req(route[0], route[1], body, jwt, idempotencyKey);
    return response.status === 200 ? { kind: 'ok', data: response.body } :
      { kind: 'rejected', status: response.status, code: response.body.code };
  };
}

// Real persisted rows, normalized only for this test while catalog HTTP routes are absent.
async function provideCatalog(journey, f) {
  const trucks = (await f.ctx.pool.query('SELECT id,label FROM trucks WHERE driver_id=$1 ORDER BY id', [f.me.id])).rows;
  const contacts = (await f.ctx.pool.query(`SELECT id,accepted_at,revoked_at,map_accepted,incident_accepted
    FROM contact_grants WHERE driver_id=$1 ORDER BY id`, [f.me.id])).rows.map((row) => ({
    id: row.id, status: row.revoked_at ? 'revoked' : row.accepted_at ? 'accepted' : 'pending',
    map: row.map_accepted, incident: row.incident_accepted,
  }));
  assert.equal(journey.provideSelectionEvidence({ actorId: f.me.id, source: 'authenticated-server-read',
    readAt: f.ctx.clock().toISOString(), trucks, contacts }).kind, 'local-state');
}

function controller(t, f, transport = apiPort(f)) {
  const journey = createDriverJourney({ transport, clock: () => f.ctx.clock().getTime(), keyFactory: randomUUID });
  t.after(() => journey.dispose());
  journey.setSession(f.me.id); journey.setInteractionMode('stationary');
  return journey;
}

async function readyDraft(t, f, transport) {
  const journey = controller(t, f, transport);
  await provideCatalog(journey, f);
  const truck = await journey.registerTruck('SYNTHETIC owner-operator truck'); assert.equal(truck.kind, 'ok');
  const grantId = await f.grant(); await provideCatalog(journey, f);
  assert.equal(journey.editForm({ text: 'SYNTHETIC viagem de carga', fields: { truckId: truck.data.id,
    origin: 'SYNTHETIC A', destination: 'SYNTHETIC B', country: 'BR', locale: 'pt-BR', timeZone: 'America/Sao_Paulo' } }).kind, 'local-state');
  journey.selectContacts([grantId]); assert.equal((await journey.saveDraft()).kind, 'ok');
  return { journey, grantId, tripId: journey.snapshot().draft.id };
}

test('persisted driver journey keeps explicit confirmation, last location and active SOS separate through API restart', async (t) => {
  const f = await fixture(t, { channelSupport: [] });
  const { journey, tripId, grantId } = await readyDraft(t, f);
  assert.equal((await f.ctx.pool.query('SELECT count(*) FROM trips')).rows[0].count, '0');
  const first = journey.confirmTrip({ confirmed: true }); const duplicate = journey.confirmTrip({ confirmed: true });
  assert.equal(first, duplicate); assert.equal((await first).kind, 'ok'); await duplicate;
  assert.equal((await f.ctx.pool.query('SELECT count(*) FROM trips')).rows[0].count, '1');
  await journey.openTrip(tripId);
  assert.equal(journey.snapshot().trip.data.locale, 'pt-BR');
  assert.equal(journey.snapshot().trip.data.time_zone, 'America/Sao_Paulo');
  assert.equal((await f.ctx.pool.query('SELECT grant_id FROM trip_grants WHERE trip_id=$1', [tripId])).rows[0].grant_id, grantId);

  assert.equal((await f.req('POST', `/v1/trips/${tripId}/locations`, { observations: [{
    capturedAt: '2026-10-17T12:00:00Z', latitude: -23, longitude: -46, accuracy: 12,
  }] })).status, 200);
  assert.equal((await journey.refreshLocation()).kind, 'ok');
  assert.equal(journey.snapshot().location.data.freshness, 'fresh');
  f.advance(121000); await journey.refreshLocation();
  const location = journey.snapshot().location.data;
  assert.equal(location.freshness, 'stale'); assert.equal(location.ageMs, 121000);
  assert.equal(location.location.capturedAt, '2026-10-17T12:00:00.000Z');
  assert.equal(location.location.receivedAt, '2026-10-17T12:00:00.000Z');
  assert.equal(location.readAt, '2026-10-17T12:02:01.000Z');

  assert.equal((await journey.sendCommand('checkin_ok')).kind, 'ok');
  assert.equal((await journey.sendCommand('checkin_ok')).kind, 'ok');
  assert.equal((await journey.sendCommand('rest_report')).kind, 'ok');
  const help = await journey.requestHelp(); assert.equal(help.kind, 'ok');
  // A fresh controller opened from persisted state cannot start a second journey
  // while retaining this trip's location/incident, the independent PR63 finding.
  const restored = controller(t, f); await provideCatalog(restored, f);
  await restored.openTrip(tripId); await restored.refreshLocation(); await restored.refreshIncident(help.data.id);
  assert.equal(restored.editForm({ text: 'SYNTHETIC second journey' }).code, 'form-locked');
  assert.equal((await restored.saveDraft()).code, 'journey-already-bound');
  assert.equal((await restored.confirmTrip({ confirmed: true })).code, 'journey-already-bound');
  assert.equal((await restored.requestHelp()).data.tripId, tripId);
  assert.equal(restored.snapshot().location.data.tripId, tripId);
  assert.equal((await f.ctx.pool.query('SELECT count(*) FROM trip_drafts')).rows[0].count, '1');
  assert.equal((await f.ctx.pool.query('SELECT count(*) FROM incidents')).rows[0].count, '1');
  assert.equal((await journey.sendCommand('arrived')).kind, 'ok');
  await journey.openTrip(tripId); assert.equal(journey.snapshot().trip.data.status, 'arrived');
  assert.equal(journey.snapshot().incident.data.status, 'active');
  await journey.refreshLocation(); assert.equal(journey.snapshot().location.error.status, 403);
  assert.equal(journey.snapshot().location.data, null);
  assert.equal((await f.ctx.pool.query('SELECT status FROM incidents WHERE id=$1', [help.data.id])).rows[0].status, 'active');
  const jobs = (await f.ctx.pool.query('SELECT channel,status FROM jobs ORDER BY channel')).rows;
  assert.deepEqual(jobs, [{ channel: 'group', status: 'unavailable' }, { channel: 'sms', status: 'unavailable' },
    { channel: 'voice', status: 'unavailable' }, { channel: 'whatsapp', status: 'unavailable' }]);
  assert.equal((await f.ctx.pool.query('SELECT count(*) FROM outbox')).rows[0].count, '0');
  assert.deepEqual((await f.ctx.pool.query('SELECT kind FROM trip_events ORDER BY kind')).rows.map(({ kind }) => kind),
    ['arrived', 'checkin_ok', 'checkin_ok', 'rest_report']);

  // Destroy the original API/context, then read the committed rows through a new API/context/key.
  const connection = f.ctx.pool.options.connectionString;
  await f.app.close(); journey.dispose();
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const token = await new SignJWT({}).setProtectedHeader({ alg: 'RS256' }).setIssuer('https://synthetic.test')
    .setAudience('andes-test').setSubject('driver').setIssuedAt().setExpirationTime('1h').sign(privateKey);
  const reopened = createApp({ ctx: createContext(connection), channelSupport: [], auth: {
    issuer: 'https://synthetic.test', audience: 'andes-test', keyResolver: async () => publicKey,
  } });
  try {
    await reopened.ready();
    const response = await reopened.inject({ method: 'GET', url: `/v1/trips/${tripId}`, headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.statusCode, 200); assert.equal(response.json().status, 'arrived');
    const episode = await reopened.inject({ method: 'GET', url: `/v1/incidents/${help.data.id}`, headers: { authorization: `Bearer ${token}` } });
    assert.equal(episode.statusCode, 200); assert.equal(episode.json().status, 'active');
    assert.equal(episode.json().tripId, tripId);
  } finally { await reopened.close(); }
});

test('lost committed confirm and SOS responses recover with original keys and one persisted outcome each', async (t) => {
  const f = await fixture(t, { channelSupport: [] });
  const raw = apiPort(f); const lose = new Set(['confirmDraft', 'sos']); const requests = [];
  const transport = async (request, options) => {
    requests.push(structuredClone(request)); const response = await raw(request, options);
    if (lose.delete(request.operation)) throw new Error('SYNTHETIC lost committed response');
    return response;
  };
  const { journey, tripId } = await readyDraft(t, f, transport);
  assert.equal((await journey.confirmTrip({ confirmed: true })).kind, 'unknown');
  assert.equal(journey.snapshot().activation, null);
  assert.equal((await f.ctx.pool.query('SELECT count(*) FROM trips')).rows[0].count, '1');
  assert.equal((await journey.retryUnknown('confirm', { confirmed: true })).kind, 'ok');
  const confirms = requests.filter(({ operation }) => operation === 'confirmDraft'); assert.deepEqual(confirms[0], confirms[1]);
  assert.equal((await f.ctx.pool.query('SELECT count(*) FROM trips')).rows[0].count, '1');

  assert.equal((await journey.requestHelp()).kind, 'unknown');
  assert.equal(journey.snapshot().incident.data, null);
  assert.equal((await f.ctx.pool.query('SELECT count(*) FROM incidents WHERE trip_id=$1', [tripId])).rows[0].count, '1');
  assert.equal((await journey.retryUnknown('sos', { confirmed: true })).kind, 'ok');
  const help = requests.filter(({ operation }) => operation === 'sos'); assert.deepEqual(help[0], help[1]);
  assert.equal((await f.ctx.pool.query("SELECT count(*) FROM incident_events WHERE kind='sos_report'")).rows[0].count, '1');
  assert.equal((await f.ctx.pool.query('SELECT count(*) FROM outbox')).rows[0].count, '0');
});

test('server revocation between selection and confirmation remains an error, with no invented activation', async (t) => {
  const f = await fixture(t, { channelSupport: [] }); const { journey, grantId } = await readyDraft(t, f);
  assert.equal((await f.req('POST', `/v1/contacts/${grantId}/revoke`, {}, f.contact)).status, 200);
  assert.deepEqual(await journey.confirmTrip({ confirmed: true }), { kind: 'rejected', status: 409, code: 'contact_not_accepted' });
  assert.equal(journey.snapshot().activation, null);
  assert.equal((await f.ctx.pool.query('SELECT count(*) FROM trips')).rows[0].count, '0');
  await provideCatalog(journey, f);
  assert.equal((await journey.confirmTrip({ confirmed: true })).code, 'contacts-not-accepted');
  journey.selectContacts([]); assert.equal((await journey.confirmTrip({ confirmed: true })).kind, 'ok');
  assert.equal((await f.ctx.pool.query('SELECT count(*) FROM trip_grants')).rows[0].count, '0');
});

test('signed foreign identity cannot turn a guessed trip UUID into driver access or SOS', async (t) => {
  const f = await fixture(t, { channelSupport: [] }); const { journey: owner, tripId } = await readyDraft(t, f);
  await owner.confirmTrip({ confirmed: true });
  const stranger = await f.req('GET', '/v1/me', undefined, f.stranger);
  const journey = controller(t, f, apiPort(f, f.stranger)); journey.setSession(stranger.body.id);
  journey.setInteractionMode('stationary');
  assert.deepEqual(await journey.openTrip(tripId), { kind: 'rejected', status: 403, code: 'forbidden' });
  assert.equal(journey.snapshot().tripId, null);
  assert.deepEqual(await journey.requestHelp(), { kind: 'blocked', code: 'trip-required' });
  assert.equal(journey.snapshot().trip.data, null); assert.equal(journey.snapshot().incident.data, null);
  assert.equal((await f.ctx.pool.query('SELECT count(*) FROM incidents')).rows[0].count, '0');
});


test('unknown committed confirmation reconciles by owner read and a new SOS reaches past a stale active cache', async t => {
  const f = await fixture(t, { channelSupport: [] });
  const raw = apiPort(f); let lose = true;
  const { journey, tripId } = await readyDraft(t, f, async (request, options) => {
    const reply = await raw(request, options);
    if (request.operation === 'confirmDraft' && lose) { lose = false; throw Error('SYNTHETIC lost committed receipt'); }
    return reply;
  });
  assert.equal((await journey.confirmTrip({ confirmed: true })).kind, 'unknown');
  assert.equal((await journey.openTrip(tripId)).kind, 'ok');
  journey.setInteractionMode('unknown'); const first = await journey.requestHelp(); assert.equal(first.kind, 'ok');
  journey.setSession(f.me.id); assert.equal(journey.snapshot().tripId, tripId);
  assert.equal((await f.req('POST', `/v1/incidents/${first.data.id}/resolve`, {})).status, 200);
  assert.equal(journey.snapshot().incident.data.status, 'active');
  journey.setInteractionMode('moving'); const second = await journey.requestHelp(); assert.equal(second.kind, 'ok');
  assert.notEqual(second.data.id, first.data.id);
  assert.equal((await f.ctx.pool.query('SELECT count(*) FROM incidents')).rows[0].count, '2');
  assert.equal((await f.ctx.pool.query("SELECT count(*) FROM incidents WHERE status='active'")).rows[0].count, '1');
  assert.equal((await f.ctx.pool.query('SELECT count(*) FROM outbox')).rows[0].count, '0');
});
test('unknown uncommitted confirmation rejects after idempotency lookup and permits explicit correction', async t => {
  const f = await fixture(t, { channelSupport: [] }); const raw = apiPort(f); let lose = true;
  const { journey, grantId } = await readyDraft(t, f, async (request, options) => {
    const reply = await raw(request, options);
    if (request.operation === 'confirmDraft' && lose) { lose = false; throw Error('SYNTHETIC lost rejected response'); }
    return reply;
  });
  await f.req('POST', `/v1/contacts/${grantId}/revoke`, {}, f.contact);
  assert.equal((await journey.confirmTrip({ confirmed: true })).kind, 'unknown');
  assert.deepEqual(await journey.retryUnknown('confirm', { confirmed: true }),
    { kind: 'rejected', status: 409, code: 'contact_not_accepted' });
  assert.equal((await f.ctx.pool.query('SELECT count(*) FROM trips')).rows[0].count, '0');
  assert.equal(journey.selectContacts([]).kind, 'local-state');
  assert.equal((await journey.confirmTrip({ confirmed: true })).kind, 'ok');
  assert.equal((await f.ctx.pool.query('SELECT count(*) FROM trips')).rows[0].count, '1');
});
