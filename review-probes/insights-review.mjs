// Independent, synthetic-only review of exact PR80 b1c4cb3. No product source edits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Usage: node review-probes.mjs EXACT_BUILT_ARCHIVE NEW_OUTPUT_DIRECTORY
// The candidate is read only; fixture mutations go into owned disposable schemas.
const archive = resolve(process.argv[2] ?? new URL('./candidate/', import.meta.url).pathname);
const output = resolve(process.argv[3] ?? new URL('./probe-results/', import.meta.url).pathname);
const moduleAt = name => import(pathToFileURL(resolve(archive, name)).href);
const { fixture } = await moduleAt('tests/helpers/runtime.mjs');
const { createApp } = await moduleAt('dist/api/app.js');
const { createContext } = await moduleAt('dist/db.js');
const { demoIssuer } = await moduleAt('dist/demo.js');

const HOUR = 3600000, DAY = 86400000;
const out = pathToFileURL(output + '/');
mkdirSync(out, { recursive: true });
function fact(name, value) {
  writeFileSync(new URL(name + '.json', out), JSON.stringify({ source: 'b1c4cb38413cd4f32c801c0bea6f29bdacc0f4c8', ...value }, null, 2) + '\n');
}
const report = (f, jwt, kind = 'robo', lat = -12.325, at = '2026-10-16T17:00:00Z', key) =>
  f.req('POST', '/v1/reports', { kind, latitude: lat, longitude: -76.775, occurredAt: at }, jwt, key);
const hotspots = async f => (await f.app.inject({ method: 'GET', url: '/v1/insights/hotspots' })).json();
const advice = (f, locale = 'es') => f.req('GET', `/v1/insights/advice?lat=-12.325&lon=-76.775&locale=${locale}`);
async function quorum(f, kind = 'robo', lat, at) {
  for (const jwt of [f.driver, f.stranger, f.contact]) assert.equal((await report(f, jwt, kind, lat, at)).status, 200);
}
async function incident(f, jwt, capturedAt, lat = -12.325) {
  const d = await f.draft({}, jwt); assert.equal(d.status, 200);
  const c = await f.req('POST', `/v1/trip-drafts/${d.body.id}/confirm`, { confirmed: true, contactGrantIds: [] }, jwt);
  assert.equal(c.status, 200);
  const loc = await f.req('POST', `/v1/trips/${c.body.id}/locations`, { observations: [{ capturedAt, latitude: lat, longitude: -76.775, accuracy: 20 }] }, jwt);
  assert.equal(loc.status, 200);
  const s = await f.req('POST', `/v1/trips/${c.body.id}/sos`, {}, jwt); assert.equal(s.status, 200);
  assert.equal((await f.req('POST', `/v1/incidents/${s.body.id}/label`, { label: 'robo' }, jwt)).status, 200);
  return { id: s.body.id, trip: c.body.id, jwt };
}

test('control: sequential daily budget and idempotent retry remain valid', async t => {
  const f = await fixture(t);
  const first = await report(f, f.driver, 'robo', undefined, undefined, 'q58-original');
  for (let i = 0; i < 4; i++) assert.equal((await report(f, f.driver)).status, 200);
  const denied = await report(f, f.driver);
  const retry = await report(f, f.driver, 'robo', undefined, undefined, 'q58-original');
  const n = (await f.ctx.pool.query('SELECT count(*)::int AS n FROM reports')).rows[0].n;
  fact('sequential-budget', { first: first.status, sixth: denied.status, retry: retry.status, sameId: first.body.id === retry.body.id, rows: n });
  assert.equal(denied.status, 429); assert.equal(retry.body.id, first.body.id); assert.equal(n, 5);
});

test('daily budget is atomic across distinct simultaneous idempotency keys', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 4; i++) assert.equal((await report(f, f.driver)).status, 200);
  const connect = f.ctx.pool.connect.bind(f.ctx.pool);
  let arrived = 0, open;
  const gate = new Promise(resolve => { open = resolve; });
  const timer = setTimeout(() => open(), 2500);
  t.after(() => { clearTimeout(timer); f.ctx.pool.connect = connect; });
  // Synchronise only after PostgreSQL returned each real count. No query/result is fabricated.
  f.ctx.pool.connect = function (...args) {
    if (args.length) return connect(...args);
    return connect().then(client => {
      const query = client.query.bind(client), release = client.release.bind(client);
      client.query = async function (text, ...rest) {
        const result = await query(text, ...rest);
        if (typeof text === 'string' && text.startsWith('SELECT count(*)::int AS n FROM reports')) {
          if (++arrived === 2) { clearTimeout(timer); open(); }
          await gate;
        }
        return result;
      };
      client.release = (...rest) => { client.query = query; client.release = release; return release(...rest); };
      return client;
    });
  };
  const responses = await Promise.all([report(f, f.driver), report(f, f.driver)]);
  const n = (await f.ctx.pool.query('SELECT count(*)::int AS n FROM reports')).rows[0].n;
  fact('concurrent-budget', { before: 4, synchronizedCounts: arrived, statuses: responses.map(r => r.status), rows: n });
  assert.equal(arrived, 2, 'both real quota counts must reach the barrier');
  assert.equal(n, 5, 'two concurrent submissions must not exceed the five-report budget');
});

test('attempt-only data must not become completed-robbery wording', async t => {
  const f = await fixture(t); await quorum(f, 'intento_robo');
  const map = await hotspots(f), es = await advice(f), pt = await advice(f, 'pt-BR');
  fact('attempt-labels', { cells: map.cells, es: es.body, pt: pt.body });
  assert.equal(map.cells[0].robo, 0); assert.equal(map.cells[0].intentoRobo, 3);
  assert.equal(es.body.count, 3); assert.match(es.body.text, /intento/i);
  assert.match(pt.body.text, /tentativa/i);
});

test('control: public suppression needs three verified contributors and advice uses the same cells', async t => {
  const f = await fixture(t);
  for (const jwt of [f.driver, f.stranger, await f.token('q58-unverified', { phone_number_verified: false })]) {
    assert.equal((await report(f, jwt)).status, 200);
  }
  const before = await hotspots(f), hiddenAdvice = await advice(f);
  await report(f, f.contact); f.advance(HOUR);
  const after = await hotspots(f), shownAdvice = await advice(f);
  fact('verified-threshold', { before: before.cells, hiddenAdvice: hiddenAdvice.body, after: after.cells, shownAdvice: shownAdvice.body });
  assert.deepEqual(before.cells, []); assert.equal(hiddenAdvice.body.level, 'none');
  assert.equal(after.cells[0].total, 4); assert.equal(shownAdvice.body.count, 4);
});

test('control: fixed window uses its exact hourly upper and 90-day lower boundaries', async t => {
  const f = await fixture(t), end = f.ctx.clock().getTime(), start = end - 90 * DAY;
  const cases = [[-12.325, start], [-13.325, start + 1], [-14.325, end], [-15.325, end + 1000]];
  for (const [lat, at] of cases) await quorum(f, 'robo', lat, new Date(at).toISOString());
  const first = await hotspots(f);
  const alternative = (await f.app.inject({ method: 'GET', url: '/v1/insights/hotspots?days=1' })).json();
  fact('window-boundaries', { end: new Date(end).toISOString(), start: new Date(start).toISOString(), cells: first.cells, alternativeCells: alternative.cells, alternativeDays: alternative.days });
  assert.deepEqual(first.cells.map(c => c.lat).sort((a, b) => a - b), [-14.325, -13.325]);
  assert.equal(alternative.days, 90); assert.deepEqual(alternative.cells, first.cells);
});

test('control: one hourly aggregation is shared by concurrent public callers and advice', async t => {
  const f = await fixture(t); await quorum(f);
  const query = f.ctx.pool.query.bind(f.ctx.pool); let aggregations = 0;
  f.ctx.pool.query = (text, ...rest) => { if (typeof text === 'string' && text.includes('security_events e')) aggregations++; return query(text, ...rest); };
  await Promise.all(Array.from({ length: 20 }, () => hotspots(f))); await advice(f);
  const first = aggregations; f.advance(HOUR); await hotspots(f);
  fact('singleflight', { calls: 20, includesAdvice: true, firstHourQueries: first, nextHourQueries: aggregations });
  assert.equal(first, 1); assert.equal(aggregations, 2);
});

test('control: a failed aggregation does not poison the current-hour cache', async t => {
  const f = await fixture(t); await quorum(f);
  const query = f.ctx.pool.query.bind(f.ctx.pool); let aggregations = 0;
  f.ctx.pool.query = (text, ...rest) => {
    if (typeof text === 'string' && text.includes('security_events e') && ++aggregations === 1) return query('SELECT 1/0');
    return query(text, ...rest);
  };
  const first = await f.app.inject({ method: 'GET', url: '/v1/insights/hotspots' });
  const next = await f.app.inject({ method: 'GET', url: '/v1/insights/hotspots' });
  fact('cache-recovery', { first: first.statusCode, next: next.statusCode, aggregations, cells: next.json().cells });
  assert.equal(first.statusCode, 500); assert.equal(next.statusCode, 200); assert.equal(aggregations, 2);
});

test('control: incident freshness cutoff, relabel publication and resolved status label', async t => {
  const f = await fixture(t), ids = [];
  for (const jwt of [f.driver, f.stranger, f.contact]) {
    ids.push(await incident(f, jwt, '2026-10-17T11:00:00Z'));
    await incident(f, jwt, '2026-10-17T10:59:59.999Z', -13.325);
  }
  const before = await hotspots(f);
  const chosen = ids[2];
  assert.equal((await f.req('POST', `/v1/incidents/${chosen.id}/label`, { label: 'sin_senal' }, chosen.jwt)).status, 200);
  const cached = await hotspots(f); f.advance(HOUR); const after = await hotspots(f);
  await f.req('POST', `/v1/incidents/${chosen.id}/resolve`, {}, chosen.jwt);
  const status = await f.req('GET', `/v1/trips/${chosen.trip}/status`, undefined, chosen.jwt);
  fact('incident-labels', { before: before.cells, cached: cached.cells, after: after.cells, label: status.body.incident?.label, incidentStatus: status.body.incident?.status });
  assert.deepEqual(before.cells.map(c => c.lat), [-12.325]); assert.deepEqual(cached.cells, before.cells);
  assert.deepEqual(after.cells, []); assert.equal(status.body.incident.label, 'sin_senal'); assert.equal(status.body.incident.status, 'resolved');
});

test('control: IANA and UTC startup zones accept while numeric offsets fail', () => {
  const url = pathToFileURL(resolve(archive, 'dist/insights/routes.js')).href;
  const statuses = {};
  for (const zone of ['UTC', 'America/Lima', '-05:00', 'Unknown/Nowhere']) {
    const p = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(url)})`], { env: { ...process.env, INSIGHTS_TIME_ZONE: zone }, encoding: 'utf8' });
    statuses[zone] = p.status;
  }
  fact('zone-validation', { statuses });
  assert.equal(statuses.UTC, 0); assert.equal(statuses['America/Lima'], 0); assert.notEqual(statuses['-05:00'], 0); assert.notEqual(statuses['Unknown/Nowhere'], 0);
});

test('demo incident provenance survives a process reopened without the demo issuer', async t => {
  const demo = await demoIssuer({}), f = await fixture(t, { auth: demo.auth, demo });
  for (let i = 0; i < 3; i++) {
    const session = (await f.app.inject({ method: 'POST', url: '/v1/demo/session', payload: {} })).json();
    await incident(f, session.driver.token, '2026-10-17T11:59:00Z');
  }
  const inDemo = await hotspots(f);
  const rows = (await f.ctx.pool.query('SELECT synthetic,count(*)::int AS n FROM security_events GROUP BY synthetic')).rows;
  const ctx = createContext(f.ctx.pool.options.connectionString, f.ctx.clock);
  const reopened = createApp({ ctx, auth: { issuer: 'https://q58-unreachable.invalid', audience: 'q58-only', keyResolver: async () => { throw new Error('unused'); } } });
  try {
    await reopened.ready();
    const after = (await reopened.inject({ method: 'GET', url: '/v1/insights/hotspots' })).json();
    fact('demo-provenance', { inDemo, storedFlags: rows, reopenedWithoutDemo: after });
    assert.equal(inDemo.includesSynthetic, true);
    assert.ok(after.cells.length === 0 || after.includesSynthetic === true, 'demo-origin incidents must not turn into real public data');
  } finally { await reopened.close(); }
});
