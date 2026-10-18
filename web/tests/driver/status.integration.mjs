// Opt-in actual published PR74 contract, signed API/SQL. No delivery workers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createDriverJourney } from '../../src/features/driver/controller.mjs';

const root = process.env.ANDES_DRIVER_RUNTIME_ROOT;
assert.ok(root && process.env.TEST_DATABASE_URL, 'Supply a built status-capable backend archive and an owned disposable database');
const { fixture } = await import(pathToFileURL(`${root}/tests/helpers/runtime.mjs`));
const { checkOnce } = await import(pathToFileURL(`${root}/dist/checks/sweep.js`));

test('published status and expected arrival preserve actual open checks, sweeper incident and separate arrival', async t => {
  const f = await fixture(t, { channelSupport: [] });
  const requests = [];
  const journey = createDriverJourney({ keyFactory: randomUUID, clock: () => f.ctx.clock().getTime(),
    transport: async (request, { signal }) => {
      assert.equal(signal.aborted, false); requests.push(structuredClone(request));
      const routes = {
        createDraft: ['POST', '/v1/trip-drafts'],
        confirmDraft: ['POST', `/v1/trip-drafts/${request.params.id}/confirm`],
        readStatus: ['GET', `/v1/trips/${request.params.id}/status`],
        command: ['POST', `/v1/trips/${request.params.id}/commands`],
      };
      const [method, path] = routes[request.operation] ?? [];
      assert.ok(method && path, 'Only the actual published contract is mapped by this test port');
      const reply = await f.req(method, path, request.body, f.driver, request.idempotencyKey);
      return reply.status === 200 ? { kind: 'ok', data: reply.body } :
        { kind: 'rejected', status: reply.status, code: reply.body.code };
    } });
  t.after(() => journey.dispose());
  journey.setSession(f.me.id); journey.setInteractionMode('stationary');
  const truck = await f.truck();
  journey.provideSelectionEvidence({ actorId: f.me.id, source: 'authenticated-server-read',
    readAt: f.ctx.clock().toISOString(), trucks: [{ id: truck, label: 'SYNTHETIC status truck' }], contacts: [] });
  const arrival = '2026-10-18T10:30:00-05:00';
  journey.editForm({ text: 'SYNTHETIC status journey', fields: { truckId: truck,
    origin: 'SYNTHETIC A', destination: 'SYNTHETIC B', country: 'PE', locale: 'es-pe',
    timeZone: 'America/Lima', expectedArrivalAt: arrival } });
  assert.equal((await journey.saveDraft()).kind, 'ok');
  assert.equal((await journey.confirmTrip({ confirmed: true })).kind, 'ok');
  const tripId = journey.snapshot().tripId;
  const persisted = (await f.ctx.pool.query('SELECT locale,expected_arrival_at FROM trips WHERE id=$1', [tripId])).rows[0];
  assert.equal(persisted.locale, 'es-PE'); assert.equal(persisted.expected_arrival_at.toISOString(), new Date(arrival).toISOString());
  const policy = { silenceMs: 1000, askGraceMs: 1000, arrivalGraceMs: 1000, sweepMs: 1000 };
  f.advance(1001); await checkOnce(f.ctx, [], policy);
  assert.equal((await journey.refreshStatus()).kind, 'ok');
  assert.equal(journey.snapshot().status.data.check.reason, 'silence');
  assert.equal(journey.snapshot().status.data.incident, null);
  assert.equal(journey.snapshot().status.data.trip.expectedArrivalAt, new Date(arrival).toISOString());
  // The second OK must close a new asking check, rather than reuse the earlier receipt.
  await journey.sendCommand('checkin_ok');
  f.advance(1001); await checkOnce(f.ctx, [], policy);
  assert.equal((await journey.refreshStatus()).kind, 'ok'); assert.equal(journey.snapshot().status.data.check.status, 'asking');
  await journey.sendCommand('checkin_ok'); await journey.refreshStatus();
  assert.equal(journey.snapshot().status.data.check, null);
  const okRequests = requests.filter(r => r.operation === 'command');
  assert.equal(okRequests.length, 2); assert.notEqual(okRequests[0].idempotencyKey, okRequests[1].idempotencyKey);
  f.advance(1001); await checkOnce(f.ctx, [], policy);
  f.advance(1001); await checkOnce(f.ctx, [], policy);
  await journey.refreshStatus();
  const view = journey.snapshot();
  assert.equal(view.status.data.incident.trigger, 'missed_check');
  assert.equal(view.status.data.incident.status, 'active');
  assert.equal(view.incident.data.id, view.status.data.incident.id);
  assert.deepEqual(view.status.data.deliveries, [{ role: 'group', channel: 'group', status: 'unavailable', unavailableReason: 'group_support_unverified' }]);
  assert.equal(view.status.clientReceivedAtMs, f.ctx.clock().getTime());
  await journey.sendCommand('arrived'); await journey.refreshStatus();
  assert.equal(journey.snapshot().status.data.trip.status, 'arrived');
  assert.equal(journey.snapshot().status.data.incident.status, 'active');
  assert.equal(journey.snapshot().activation, null);
  assert.equal((await f.ctx.pool.query('SELECT count(*) FROM outbox')).rows[0].count, '0');
});
