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
const nextHour = f => f.advance(3600000); // public cells are recomputed once per hour
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
  for (let i = 0; i < 4; i++) assert.equal((await report(f, 'robo', 0, 0, '2026-10-17T11:00:00Z')).status, 200);
  assert.equal((await report(f, 'robo', 0, 0, '2026-10-17T11:00:00Z')).status, 429); // five reports per identity per day
});

// The budget belongs to the identity, not the request: fresh idempotency keys sent at once must not slip past it.
test('the daily report budget holds under concurrent submissions', async t => {
  const f = await fixture(t); const { waitForBlockedQueries } = await import('./helpers/db-barriers.mjs');
  const holder = await f.ctx.callbackPool.connect(); let racing; // holds inserts back until every racer has checked the budget
  try {
    await holder.query('BEGIN'); await holder.query('LOCK TABLE reports IN EXCLUSIVE MODE');
    racing = Promise.all(Array.from({ length: 8 }, () => report(f, 'robo', 0, 0, '2026-10-17T11:00:00Z')));
    await waitForBlockedQueries(f.ctx.telemetryPool, '%reports%', 6); // the whole command pool is inside the race
  } finally { await holder.query('ROLLBACK'); holder.release(); }
  assert.deepEqual((await racing).map(r => r.status).sort(), [200, 200, 200, 200, 200, 429, 429, 429]);
  assert.equal((await f.ctx.pool.query('SELECT count(*)::int AS n FROM reports')).rows[0].n, 5);
});

// Returning small cells, identifiers or arbitrary windows would expose individual drivers to anyone with the public link.
test('hotspots are public aggregates over one fixed window: suppressed, synthetic counted, no identifiers', async t => {
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
  for (const query of ['?days=7', '?days=1', '?_=1']) assert.equal((await hotspots(f, query)).body.days, 90, query); // no other window to subtract
});

// One account inventing a hotspot, or seeded rows lifting a single real report over the threshold, would mislead police or expose a driver.
test('suppression counts distinct contributors and seeded rows never expose a real event', async t => {
  const f = await fixture(t); const night = '2026-10-16T04:30:00Z';
  for (let i = 0; i < 3; i++) assert.equal((await report(f, 'robo', -12.325, -76.775, night)).status, 200);
  assert.deepEqual((await hotspots(f)).body.cells, []);
  for (let i = 0; i < 3; i++) await seeded(f, 'robo', -12.525, -76.725, night);
  assert.equal((await report(f, 'intento_robo', -12.525, -76.725, night, f.stranger)).status, 200);
  nextHour(f);
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
  assert.equal((await hotspots(f)).body.cells.length, 1); // relabels surface only at the next hour, together with everything else
  nextHour(f); assert.deepEqual((await hotspots(f)).body.cells, []);
  assert.equal((await label(2, 'falsa_alarma')).status, 200);
  nextHour(f); assert.deepEqual((await hotspots(f)).body.cells, []);
  assert.equal((await f.req('POST', `/v1/incidents/${ids[2]}/resolve`, {}, owners[2])).status, 200);
  assert.equal((await label(2, 'intento_robo')).status, 200);
  nextHour(f);
  assert.deepEqual((await hotspots(f)).body.cells.map(c => [c.robo, c.intentoRobo, c.total]), [[2, 1, 3]]);
});

// Advice from the wrong band, too far away, below the minimum or from unflagged demo data would warn drivers without basis.
test('advice needs distinct contributors in the current band, flags demo data and needs a signed driver', async t => {
  const f = await fixture(t); const day = '2026-10-10T17:00:00Z'; // 12:00 in Lima: same band as the fixture clock
  const advice = query => f.req('GET', `/v1/insights/advice${query}`);
  const text = (counts) => `Reportes en esta zona de día (últimos 90 días): ${counts}. Si puedes, detente en un lugar concurrido y seguro.`;
  for (const jwt of [f.driver, f.stranger]) await report(f, 'robo', -12.525, -76.725, day, jwt);
  for (const jwt of [f.driver, f.stranger, f.contact]) await report(f, 'robo', -12.525, -76.725, '2026-10-11T04:00:00Z', jwt); // 23:00 in Lima
  assert.deepEqual((await advice('?lat=-12.47&lon=-76.68')).body, { level: 'none' });
  await report(f, 'intento_robo', -12.525, -76.725, day, f.contact);
  nextHour(f);
  assert.deepEqual((await advice('?lat=-12.47&lon=-76.68')).body, { level: 'caution', count: 3, robo: 2, intentoRobo: 1, includesSynthetic: false, band: 'dia', text: text('2 de robo y 1 de intento de robo') });
  assert.match((await advice('?lat=-12.47&lon=-76.68&locale=pt-BR')).body.text, /^Relatos nesta região durante o dia \(últimos 90 dias\): 2 de roubo e 1 de tentativa de roubo\./);
  assert.deepEqual((await advice('?lat=-12.37&lon=-76.68')).body, { level: 'none' });
  for (let i = 0; i < 3; i++) await seeded(f, 'robo', -13.075, -76.375, day);
  nextHour(f);
  assert.deepEqual((await advice('?lat=-13.075&lon=-76.375')).body, { level: 'caution', count: 3, robo: 3, intentoRobo: 0, includesSynthetic: true, band: 'dia', text: `${text('3 de robo')} Incluye datos de demostración.` });
  assert.match((await advice('?lat=-13.075&lon=-76.375&locale=pt-BR')).body.text, /Inclui dados de demonstração\.$/);
  assert.equal((await advice('?lat=-12.046373100000001&lon=-77.042754')).status, 200);
  assert.equal((await advice('?lat=95&lon=0')).status, 400);
  assert.equal((await advice('?lat=abc&lon=0')).status, 400);
  assert.equal((await f.app.inject({ method: 'GET', url: '/v1/insights/advice?lat=0&lon=0' })).statusCode, 401);
});

// An attempt is not a robbery: calling three attempts "3 reportes de robo" overstates the danger of a zone.
test('attempts are never counted or worded as robberies in hotspots or advice', async t => {
  const f = await fixture(t); const day = '2026-10-10T17:00:00Z'; // 12:00 in Lima
  for (const jwt of [f.driver, f.stranger, f.contact]) await report(f, 'intento_robo', -12.525, -76.725, day, jwt);
  for (const jwt of [f.driver, f.stranger, f.contact]) await report(f, jwt === f.driver ? 'robo' : 'intento_robo', -13.075, -76.725, day, jwt);
  assert.deepEqual((await hotspots(f)).body.cells.map(c => `${c.lat}:${c.robo}/${c.intentoRobo}/${c.total}`).sort(), ['-12.525:0/3/3', '-13.075:1/2/3']);
  const advice = async (lat, locale) => (await f.req('GET', `/v1/insights/advice?lat=${lat}&lon=-76.725&locale=${locale}`)).body;
  const es = ' Si puedes, detente en un lugar concurrido y seguro.', pt = ' Se puder, pare em um local movimentado e seguro.';
  assert.deepEqual(await advice(-12.525, 'es'), { level: 'caution', count: 3, robo: 0, intentoRobo: 3, includesSynthetic: false, band: 'dia', text: `Reportes en esta zona de día (últimos 90 días): 3 de intento de robo.${es}` });
  assert.equal((await advice(-12.525, 'pt-BR')).text, `Relatos nesta região durante o dia (últimos 90 dias): 3 de tentativa de roubo.${pt}`);
  assert.equal((await advice(-13.075, 'es')).text, `Reportes en esta zona de día (últimos 90 días): 1 de robo y 2 de intento de robo.${es}`);
  assert.equal((await advice(-13.075, 'pt-BR')).text, `Relatos nesta região durante o dia (últimos 90 dias): 1 de roubo e 2 de tentativa de roubo.${pt}`);
  assert.match((await f.app.inject({ method: 'GET', url: '/mapa' })).body, /<h1 id="title">Robos e intentos de robo en carretera<\/h1>/);
});

// Judges open the map from a private window: it must load without login, as HTML, wired to the public aggregate.
test('public map page is served without auth and reads only the public hotspots endpoint', async t => {
  const f = await fixture(t); const page = await f.app.inject({ method: 'GET', url: '/mapa' });
  assert.equal(page.statusCode, 200); assert.match(page.headers['content-type'], /^text\/html/);
  assert.match(page.body, /\/v1\/insights\/hotspots/); assert.match(page.body, /Incluye datos de demostración/);
  assert.doesNotMatch(page.body, /\/v1\/(trips|incidents|reports|insights\/advice)/);
});

// Advice must never reveal more than the public map: no hidden single report, no exact time.
test('advice only sums published cells, so it cannot locate or time a hidden report', async t => {
  const f = await fixture(t); const day = '2026-10-10T17:00:00Z'; // 12:00 in Lima
  const advice = async (lat, lon) => (await f.req('GET', `/v1/insights/advice?lat=${lat}&lon=${lon}`)).body;
  for (const jwt of [f.driver, f.stranger, f.contact]) await report(f, 'robo', -12.525, -76.725, day, jwt);
  await report(f, 'robo', -12.525, -76.625, day, f.stranger); // a lone report two cells east stays hidden
  assert.equal((await advice(-12.525, -76.725)).count, 3);
  assert.equal((await advice(-12.525, -76.675)).count, 3);
  assert.deepEqual(await advice(-12.525, -76.625), { level: 'none' });
  f.advance(30 * 60000); // 12:30Z: reports from this hour stay invisible until it ends, as on the map
  for (const jwt of [f.driver, f.stranger, f.contact]) await report(f, 'robo', -13.075, -76.375, '2026-10-17T12:10:00Z', jwt);
  assert.deepEqual(await advice(-13.075, -76.375), { level: 'none' });
  f.advance(31 * 60000);
  assert.equal((await advice(-13.075, -76.375)).count, 3);
  for (const locale of ['es-PE', 'es-419', 'pt-br']) assert.equal((await f.req('GET', `/v1/insights/advice?lat=-13.075&lon=-76.375&locale=${locale}`)).status, 200, locale);
  assert.match((await f.req('GET', '/v1/insights/advice?lat=-13.075&lon=-76.375&locale=es-PE')).body.text, /: 3 de robo\./);
  assert.match((await f.req('GET', '/v1/insights/advice?lat=-13.075&lon=-76.375&locale=pt-br')).body.text, /: 3 de roubo\./);
});

// Demo personas are free to mint, so in demo mode every report is demo data and every view must say so.
test('demo sign-in stores reports as synthetic and flags every published cell as demo data', async t => {
  const { demoIssuer } = await import('../dist/demo.js'); const demo = await demoIssuer({});
  const f = await fixture(t, { auth: demo.auth, demo }); const night = '2026-10-16T04:30:00Z';
  const driver = (await f.app.inject({ method: 'POST', url: '/v1/demo/session', payload: {} })).json().driver.token;
  for (let i = 0; i < 3; i++) assert.equal((await report(f, 'robo', -12.325, -76.775, night, driver)).status, 200);
  assert.equal((await f.ctx.pool.query('SELECT count(*)::int AS n FROM reports WHERE synthetic')).rows[0].n, 3);
  const map = (await hotspots(f)).body;
  assert.equal(map.includesSynthetic, true); assert.deepEqual(map.cells.map(c => [c.total, c.synthetic]), [[3, 3]]);
});

// Demo personas are free to mint: what they created must stay demo data after a restart without demo sign-in, and real
// data must stay real after a restart with it. Provenance belongs to the data, not to the mode the server runs in now.
test('a restart in the other mode never relabels demo or real incidents', async t => {
  const { createApp } = await import('../dist/api/app.js'); const { createContext } = await import('../dist/db.js');
  const { demoIssuer } = await import('../dist/demo.js'); const demo = await demoIssuer({});
  async function restarted(f, options) {
    const app = createApp({ ctx: createContext(f.ctx.pool.options.connectionString, f.ctx.clock), ...options }); t.after(() => app.close());
    const map = (await app.inject({ method: 'GET', url: '/v1/insights/hotspots' })).json();
    return [map.includesSynthetic, map.cells.map(c => [c.total, c.synthetic])];
  }
  const labelled = async (f, jwt) => assert.equal((await f.req('POST', `/v1/incidents/${await sosAt(f, -12.325, -76.775, jwt)}/label`, { label: 'robo' }, jwt)).status, 200);
  const real = await fixture(t);
  for (const jwt of [real.driver, real.stranger, real.contact]) await labelled(real, jwt);
  const played = await fixture(t, { auth: demo.auth, demo });
  for (let i = 0; i < 3; i++) await labelled(played, (await played.app.inject({ method: 'POST', url: '/v1/demo/session', payload: {} })).json().driver.token);
  const realInDemo = await restarted(real, { auth: demo.auth, demo });
  const demoInReal = await restarted(played, { auth: { issuer: 'https://synthetic.test', audience: 'andes-test', keyResolver: async () => { throw new Error('unused'); } } });
  assert.deepEqual({ realInDemo, demoInReal }, { realInDemo: [false, [[3, 0]]], demoInReal: [true, [[3, 3]]] });
});

// Insights must follow whether demo sign-in is actually on, not a separately read variable.
test('the DEMO_MODE variable alone never marks real reports as demo data', async t => {
  process.env.DEMO_MODE = 'true'; t.after(() => { delete process.env.DEMO_MODE; });
  const f = await fixture(t);
  assert.equal((await report(f, 'robo', -12.325, -76.775, '2026-10-16T04:30:00Z')).status, 200);
  assert.equal((await f.ctx.pool.query('SELECT count(*)::int AS n FROM reports WHERE synthetic')).rows[0].n, 0);
});

// The driver UI learns which incident to label, and whether it already is, from the trip status.
test('trip status shows the latest incident label, also after resolution', async t => {
  const f = await fixture(t); const trip = await f.trip();
  const sos = (await f.req('POST', `/v1/trips/${trip}/sos`, {})).body.id;
  const incident = async () => (await f.req('GET', `/v1/trips/${trip}/status`)).body.incident;
  assert.equal((await incident()).label, null);
  assert.equal((await f.req('POST', `/v1/incidents/${sos}/resolve`, {})).status, 200);
  assert.equal((await f.req('POST', `/v1/incidents/${sos}/label`, { label: 'falsa_alarma' })).status, 200);
  const shown = await incident(); assert.deepEqual([shown.id, shown.status, shown.label], [sos, 'resolved', 'falsa_alarma']);
});

// Unverified identities are cheap to create, so they must not count toward publishing a real cell.
test('only phone-verified contributors count toward publishing a cell', async t => {
  const f = await fixture(t); const night = '2026-10-16T04:30:00Z';
  for (const name of ['u1', 'u2', 'u3']) assert.equal((await report(f, 'robo', -12.325, -76.775, night, await f.token(name, { phone_number_verified: false }))).status, 200);
  assert.deepEqual((await hotspots(f)).body.cells, []);
  for (const jwt of [f.driver, f.stranger, f.contact]) assert.equal((await report(f, 'robo', -12.325, -76.775, night, jwt)).status, 200);
  nextHour(f); assert.deepEqual((await hotspots(f)).body.cells.map(c => c.total), [6]);
});

// An alert raised long after the last known position must not pin a robbery to the wrong place.
test('incidents whose copied location is over an hour old never reach hotspots', async t => {
  const f = await fixture(t);
  for (const jwt of [f.driver, f.stranger, f.contact]) {
    const draft = await f.draft({}, jwt);
    const trip = (await f.req('POST', `/v1/trip-drafts/${draft.body.id}/confirm`, { confirmed: true, contactGrantIds: [] }, jwt)).body.id;
    assert.equal((await f.req('POST', `/v1/trips/${trip}/locations`, { observations: [{ capturedAt: '2026-10-17T10:30:00Z', latitude: -12.325, longitude: -76.775, accuracy: 20 }] }, jwt)).status, 200);
    const sos = (await f.req('POST', `/v1/trips/${trip}/sos`, {}, jwt)).body.id;
    assert.equal((await f.req('POST', `/v1/incidents/${sos}/label`, { label: 'robo' }, jwt)).status, 200);
  }
  assert.deepEqual((await hotspots(f)).body.cells, []);
});

// Public traffic must not load the pool SOS uses: one aggregation per hour, shared by concurrent callers and advice.
test('public cells are computed once per hour and shared by every caller', async t => {
  const f = await fixture(t); let runs = 0; const query = f.ctx.pool.query.bind(f.ctx.pool);
  f.ctx.pool.query = (text, ...rest) => { if (typeof text === 'string' && text.includes('security_events e')) runs++; return query(text, ...rest); };
  await Promise.all(Array.from({ length: 20 }, () => hotspots(f)));
  assert.equal((await f.req('GET', '/v1/insights/advice?lat=-12.3&lon=-76.7')).status, 200);
  assert.equal(runs, 1);
  nextHour(f); await hotspots(f); assert.equal(runs, 2);
});
