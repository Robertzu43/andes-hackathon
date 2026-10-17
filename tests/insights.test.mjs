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

const report = (f, kind, latitude, longitude, occurredAt, jwt = f.driver) => f.req('POST', '/v1/reports', { kind, latitude, longitude, occurredAt }, jwt);
async function hotspots(f, query = '') { const r = await f.app.inject({ method: 'GET', url: `/v1/insights/hotspots${query}` }); return { status: r.statusCode, body: r.json() }; }

// Accepting future/stale or anonymous reports would let anyone fabricate hotspots.
test('reports reject future, stale, unknown-kind or unauthenticated submissions', async t => {
  const f = await fixture(t);
  assert.equal((await report(f, 'robo', 0, 0, '2026-10-17T12:01:00Z')).status, 400);
  assert.equal((await report(f, 'robo', 0, 0, '2025-10-16T11:59:00Z')).status, 400);
  assert.equal((await report(f, 'secuestro', 0, 0, '2026-10-17T11:00:00Z')).status, 400);
  assert.equal((await f.app.inject({ method: 'POST', url: '/v1/reports', payload: { kind: 'robo', latitude: 0, longitude: 0, occurredAt: '2026-10-17T11:00:00Z' } })).statusCode, 401);
  assert.equal((await report(f, 'robo', 0, 0, '2026-10-17T11:00:00Z')).status, 200);
});

// Returning small cells or identifiers would expose individual drivers to anyone with the public link.
test('hotspots are public aggregates: suppressed below the minimum, synthetic counted, no identifiers', async t => {
  const f = await fixture(t); const night = '2026-10-16T04:30:00Z'; // 23:30 in Lima
  const posted = [];
  for (let i = 0; i < 3; i++) posted.push((await report(f, 'robo', -12.525, -76.725, night)).body.id);
  for (let i = 0; i < 2; i++) posted.push((await report(f, 'intento_robo', -13.075, -76.375, night)).body.id);
  await f.ctx.pool.query(`INSERT INTO reports VALUES(gen_random_uuid(),$1,'intento_robo',-12.52,-76.72,$2,$2,true)`, [f.me.id, night]);
  const response = await hotspots(f);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.cells, [{ lat: -12.525, lon: -76.725, band: 'noche', robo: 3, intentoRobo: 1, total: 4, synthetic: 1 }]);
  assert.equal(response.body.includesSynthetic, true); assert.equal(response.body.minCount, 3); assert.equal(response.body.days, 90);
  const text = JSON.stringify(response.body);
  for (const secret of [...posted, f.me.id, night]) assert.ok(!text.includes(secret), `leaked ${secret}`);
  assert.equal((await hotspots(f, '?days=0')).status, 400);
  assert.equal((await hotspots(f, '?days=abc')).status, 400);
  assert.deepEqual((await hotspots(f, '?days=1')).body.cells, []);
});

// An off-by-one hour would move events into the wrong band and change the advice drivers get.
test('time bands split at 22:00 and 06:00 local time', async t => {
  const f = await fixture(t);
  const cases = [['2026-10-16T02:59:00Z', -12.325, -76.775], ['2026-10-16T03:00:00Z', -12.325, -76.775], ['2026-10-16T10:59:00Z', -13.075, -76.375], ['2026-10-16T11:00:00Z', -13.075, -76.375]];
  for (const [when, lat, lon] of cases) for (let i = 0; i < 3; i++) assert.equal((await report(f, 'robo', lat, lon, when)).status, 200);
  const cells = (await hotspots(f)).body.cells.map(c => `${c.lat},${c.lon},${c.band},${c.total}`).sort();
  assert.deepEqual(cells, ['-12.325,-76.775,dia,3', '-12.325,-76.775,noche,3', '-13.075,-76.375,dia,3', '-13.075,-76.375,noche,3']);
});
