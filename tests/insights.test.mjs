import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/runtime.mjs';

async function sosAt(f, latitude, longitude, jwt = f.driver) {
  const draft = await f.draft({}, jwt); assert.equal(draft.status, 200);
  const confirmed = await f.req('POST', `/v1/trip-drafts/${draft.body.id}/confirm`, { confirmed: true, contactGrantIds: [] }, jwt); assert.equal(confirmed.status, 200);
  const trip = confirmed.body.id;
  assert.equal((await f.req('POST', `/v1/trips/${trip}/locations`, { observations: [{ capturedAt: '2026-10-17T11:58:00Z', latitude: 0, longitude: 0, accuracy: 99 }, { capturedAt: '2026-10-17T11:59:00Z', latitude, longitude, accuracy: 20 }] }, jwt)).status, 200);
  const sos = await f.req('POST', `/v1/trips/${trip}/sos`, {}, jwt); assert.equal(sos.status, 200);
  return sos.body.id;
}
const report = (f, kind, latitude, longitude, occurredAt, jwt = f.driver) => f.req('POST', '/v1/reports', { kind, latitude, longitude, occurredAt }, jwt);
const seeded = (f, kind, latitude, longitude, at) => f.ctx.pool.query('INSERT INTO reports VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$5,true)', [f.me.id, kind, latitude, longitude, at]);
async function hotspots(f, query = '') { const r = await f.app.inject({ method: 'GET', url: `/v1/insights/hotspots${query}` }); return { status: r.statusCode, body: r.json() }; }

// Without the snapshot an incident's place is lost once location history is pruned, so hotspots would be empty.
test('incident creation copies the latest trip location for later aggregation', async t => {
  const f = await fixture(t); const id = await sosAt(f, -12.325, -76.775);
  const row = (await f.ctx.pool.query('SELECT latitude,longitude,accuracy,located_at FROM incidents WHERE id=$1', [id])).rows[0];
  assert.deepEqual([row.latitude, row.longitude, row.accuracy, row.located_at.toISOString()], [-12.325, -76.775, 20, '2026-10-17T11:59:00.000Z']);
  const bare = await f.req('POST', `/v1/trips/${await f.trip()}/sos`, {}); assert.equal(bare.status, 200);
  assert.equal((await f.ctx.pool.query('SELECT latitude FROM incidents WHERE id=$1', [bare.body.id])).rows[0].latitude, null);
});

// Accepting future/stale/unparseable or anonymous reports would let anyone fabricate hotspots.
test('reports reject future, stale, unparseable, unknown-kind or unauthenticated submissions', async t => {
  const f = await fixture(t);
  for (const at of ['2026-10-17T12:01:00Z', '2025-10-16T11:59:00Z', '2099-12-31T23:59:60Z', '1990-01-01T23:59:60Z']) assert.equal((await report(f, 'robo', 0, 0, at)).status, 400, at);
  assert.equal((await report(f, 'secuestro', 0, 0, '2026-10-17T11:00:00Z')).status, 400);
  assert.equal((await f.app.inject({ method: 'POST', url: '/v1/reports', payload: { kind: 'robo', latitude: 0, longitude: 0, occurredAt: '2026-10-17T11:00:00Z' } })).statusCode, 401);
  assert.equal((await report(f, 'robo', 0, 0, '2026-10-17T11:00:00Z')).status, 200);
});

// Returning small cells, identifiers or arbitrary windows would expose individual drivers to anyone with the public link.
test('hotspots are public aggregates over fixed windows: suppressed, synthetic counted, no identifiers', async t => {
  const f = await fixture(t); const night = '2026-10-16T04:30:00Z'; // 23:30 in Lima
  const posted = [];
  for (const jwt of [f.driver, f.stranger, f.contact]) posted.push((await report(f, 'robo', -12.525, -76.725, night, jwt)).body.id);
  for (const jwt of [f.driver, f.stranger]) posted.push((await report(f, 'intento_robo', -13.075, -76.375, night, jwt)).body.id);
  await seeded(f, 'intento_robo', -12.52, -76.72, night);
  const response = await hotspots(f);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.cells, [{ lat: -12.525, lon: -76.725, band: 'noche', robo: 3, intentoRobo: 1, total: 4, synthetic: 1 }]);
  assert.equal(response.body.includesSynthetic, true); assert.equal(response.body.minCount, 3); assert.equal(response.body.days, 90);
  const text = JSON.stringify(response.body);
  for (const secret of [...posted, f.me.id, '2026-10-16T04:30']) assert.ok(!text.includes(secret), `leaked ${secret}`);
  for (const days of ['0', '1', '45', 'abc']) assert.equal((await hotspots(f, `?days=${days}`)).status, 400, days);
  assert.equal((await hotspots(f, '?days=7')).body.cells.length, 1);
});

// One account inventing a hotspot, or seeded rows lifting a single real report over the threshold, would mislead police or expose a driver.
test('suppression counts distinct contributors and seeded rows never expose a real event', async t => {
  const f = await fixture(t); const night = '2026-10-16T04:30:00Z';
  for (let i = 0; i < 3; i++) assert.equal((await report(f, 'robo', -12.325, -76.775, night)).status, 200);
  assert.deepEqual((await hotspots(f)).body.cells, []);
  for (let i = 0; i < 3; i++) await seeded(f, 'robo', -12.525, -76.725, night);
  assert.equal((await report(f, 'intento_robo', -12.525, -76.725, night, f.stranger)).status, 200);
  assert.deepEqual((await hotspots(f)).body.cells, [{ lat: -12.525, lon: -76.725, band: 'noche', robo: 3, intentoRobo: 0, total: 3, synthetic: 3 }]);
});

// A window ending at the current millisecond would let repeated reads pin the exact time of a report.
test('hotspot windows end on the hour', async t => {
  const f = await fixture(t); f.advance(30 * 60000); // 12:30Z
  for (const jwt of [f.driver, f.stranger, f.contact]) assert.equal((await report(f, 'robo', -12.325, -76.775, '2026-10-17T12:20:00Z', jwt)).status, 200);
  assert.deepEqual((await hotspots(f)).body.cells, []);
  f.advance(31 * 60000); // 13:01Z
  assert.equal((await hotspots(f)).body.cells.length, 1);
});

// An off-by-one hour would move events into the wrong band and change the advice drivers get.
test('time bands split at 22:00 and 06:00 local time', async t => {
  const f = await fixture(t);
  const cases = [['2026-10-16T02:59:00Z', -12.325, -76.775], ['2026-10-16T03:00:00Z', -12.325, -76.775], ['2026-10-16T10:59:00Z', -13.075, -76.375], ['2026-10-16T11:00:00Z', -13.075, -76.375]];
  for (const [when, lat, lon] of cases) for (const jwt of [f.driver, f.stranger, f.contact]) assert.equal((await report(f, 'robo', lat, lon, when, jwt)).status, 200);
  const cells = (await hotspots(f)).body.cells.map(c => `${c.lat},${c.lon},${c.band},${c.total}`).sort();
  assert.deepEqual(cells, ['-12.325,-76.775,dia,3', '-12.325,-76.775,noche,3', '-13.075,-76.375,dia,3', '-13.075,-76.375,noche,3']);
});

// Letting contacts/strangers label, or counting false alarms and dead zones, would put non-robberies on the police map.
test('only the driver labels incidents and only robbery labels enter hotspots', async t => {
  const f = await fixture(t); const owners = [f.driver, f.stranger, f.contact];
  const ids = [await sosAt(f, -12.325, -76.775, owners[0]), await sosAt(f, -12.326, -76.776, owners[1]), await sosAt(f, -12.324, -76.774, owners[2])];
  const label = (i, value, jwt = owners[i]) => f.req('POST', `/v1/incidents/${ids[i]}/label`, { label: value }, jwt);
  assert.equal((await label(0, 'robo', f.stranger)).status, 403);
  assert.equal((await label(0, 'robo', f.contact)).status, 403);
  assert.equal((await label(0, 'secuestro')).status, 400);
  assert.equal((await f.req('POST', '/v1/incidents/00000000-0000-4000-8000-000000000000/label', { label: 'robo' })).status, 404);
  for (const i of [0, 1, 2]) assert.equal((await label(i, 'robo')).status, 200);
  assert.deepEqual((await hotspots(f)).body.cells.map(c => [c.lat, c.lon, c.band, c.robo, c.total]), [[-12.325, -76.775, 'dia', 3, 3]]);
  assert.equal((await label(2, 'sin_senal')).status, 200);
  assert.deepEqual((await hotspots(f)).body.cells, []);
  assert.equal((await label(2, 'falsa_alarma')).status, 200);
  assert.deepEqual((await hotspots(f)).body.cells, []);
  assert.equal((await f.req('POST', `/v1/incidents/${ids[2]}/resolve`, {}, owners[2])).status, 200);
  assert.equal((await label(2, 'intento_robo')).status, 200);
  assert.deepEqual((await hotspots(f)).body.cells.map(c => [c.robo, c.intentoRobo, c.total]), [[2, 1, 3]]);
});

// Advice from the wrong band, too far away, below the minimum or from unflagged demo data would warn drivers without basis.
test('advice needs distinct contributors in the current band, flags demo data and needs a signed driver', async t => {
  const f = await fixture(t); const day = '2026-10-10T17:00:00Z'; // 12:00 in Lima: same band as the fixture clock
  const advice = query => f.req('GET', `/v1/insights/advice${query}`);
  const text = '3 reportes de robo en esta zona de día (últimos 90 días). Si puedes, detente en un lugar concurrido y seguro.';
  for (const jwt of [f.driver, f.stranger]) await report(f, 'robo', -12.525, -76.725, day, jwt);
  for (const jwt of [f.driver, f.stranger, f.contact]) await report(f, 'robo', -12.525, -76.725, '2026-10-11T04:00:00Z', jwt); // 23:00 in Lima
  assert.deepEqual((await advice('?lat=-12.47&lon=-76.68')).body, { level: 'none' });
  await report(f, 'intento_robo', -12.525, -76.725, day, f.contact);
  assert.deepEqual((await advice('?lat=-12.47&lon=-76.68')).body, { level: 'caution', count: 3, includesSynthetic: false, band: 'dia', text });
  assert.match((await advice('?lat=-12.47&lon=-76.68&locale=pt-BR')).body.text, /^3 relatos de roubo nesta região durante o dia/);
  assert.deepEqual((await advice('?lat=-12.37&lon=-76.68')).body, { level: 'none' });
  for (let i = 0; i < 3; i++) await seeded(f, 'robo', -13.075, -76.375, day);
  assert.deepEqual((await advice('?lat=-13.075&lon=-76.375')).body, { level: 'caution', count: 3, includesSynthetic: true, band: 'dia', text });
  assert.equal((await advice('?lat=-12.046373100000001&lon=-77.042754')).status, 200);
  assert.equal((await advice('?lat=95&lon=0')).status, 400);
  assert.equal((await advice('?lat=abc&lon=0')).status, 400);
  assert.equal((await f.app.inject({ method: 'GET', url: '/v1/insights/advice?lat=0&lon=0' })).statusCode, 401);
});

// Judges open the map from a private window: it must load without login, as HTML, wired to the public aggregate.
test('public map page is served without auth and reads only the public hotspots endpoint', async t => {
  const f = await fixture(t); const page = await f.app.inject({ method: 'GET', url: '/mapa' });
  assert.equal(page.statusCode, 200); assert.match(page.headers['content-type'], /^text\/html/);
  assert.match(page.body, /\/v1\/insights\/hotspots\?days=/); assert.match(page.body, /Incluye datos de demostración/);
  assert.doesNotMatch(page.body, /\/v1\/(trips|incidents|reports|insights\/advice)/);
});
