import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/runtime.mjs';

async function sosAt(f, latitude, longitude) {
  const trip = await f.trip();
  assert.equal((await f.req('POST', `/v1/trips/${trip}/locations`, { observations: [{ capturedAt: '2026-10-17T11:58:00Z', latitude: 0, longitude: 0, accuracy: 99 }, { capturedAt: '2026-10-17T11:59:00Z', latitude, longitude, accuracy: 20 }] })).status, 200);
  const sos = await f.req('POST', `/v1/trips/${trip}/sos`, {}); assert.equal(sos.status, 200);
  return sos.body.id;
}

// Without the snapshot an incident's place is lost once location history is pruned, so hotspots would be empty.
test('incident creation copies the latest trip location for later aggregation', async t => {
  const f = await fixture(t); const id = await sosAt(f, -12.325, -76.775);
  const row = (await f.ctx.pool.query('SELECT latitude,longitude,accuracy,located_at FROM incidents WHERE id=$1', [id])).rows[0];
  assert.deepEqual([row.latitude, row.longitude, row.accuracy, row.located_at.toISOString()], [-12.325, -76.775, 20, '2026-10-17T11:59:00.000Z']);
  const bare = await f.req('POST', `/v1/trips/${await f.trip()}/sos`, {});
  assert.equal((await f.ctx.pool.query('SELECT latitude FROM incidents WHERE id=$1', [bare.body.id])).rows[0].latitude, null);
});
