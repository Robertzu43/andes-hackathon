import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/runtime.mjs';
import {contactFor, jobsOf, expectedFanOut, cfg, sweep, checksOf, asking, pending, groupFact} from './helpers/checks.mjs';
import {waitForBlockedQueries} from './helpers/db-barriers.mjs';

test('drafts keep an optional expected arrival; invitations take a family or colleague role', async t => {
  const f = await fixture(t);
  const family = await contactFor(f, 'family');
  const colleague = await contactFor(f, 'colleague', 'colleague');
  const roles = (await f.ctx.pool.query('SELECT id,role FROM contact_grants ORDER BY role')).rows;
  assert.deepEqual(roles, [{id: colleague.grant, role: 'colleague'}, {id: family.grant, role: 'family'}]);
  const other = await f.token('other');
  const otherId = (await f.req('GET', '/v1/me', undefined, other)).body.id;
  assert.equal((await f.req('POST', '/v1/contacts', {contactId: otherId, phone: '+5511999990000', map: true, incident: true, role: 'boss'})).status, 400);
  const draft = await f.draft({expectedArrivalAt: '2026-10-17T18:00:00Z'});
  assert.equal(draft.status, 200);
  const trip = await f.req('POST', `/v1/trip-drafts/${draft.body.id}/confirm`, {confirmed: true, contactGrantIds: [family.grant]});
  assert.equal(trip.status, 200);
  const row = (await f.ctx.pool.query('SELECT expected_arrival_at,sharing_stopped_at FROM trips WHERE id=$1', [trip.body.id])).rows[0];
  assert.deepEqual(row, {expected_arrival_at: new Date('2026-10-17T18:00:00Z'), sharing_stopped_at: null});
  assert.equal((await f.draft({expectedArrivalAt: 'tomorrow'})).status, 400);
});

test('SOS alerts family on three channels, colleagues on two and records the group as unavailable', async t => {
  const f = await fixture(t);
  const family = await contactFor(f, 'family'); const colleague = await contactFor(f, 'colleague', 'colleague');
  const trip = await f.trip([family.grant, colleague.grant]);
  const sos = await f.req('POST', `/v1/trips/${trip}/sos`, {});
  assert.equal(sos.status, 200);
  assert.deepEqual(await jobsOf(f, sos.body.id), expectedFanOut);
  assert.equal((await f.ctx.pool.query('SELECT count(*)::int n FROM outbox')).rows[0].n, 5);
  assert.deepEqual((await f.ctx.pool.query('SELECT trigger,check_reason FROM incidents')).rows, [{trigger: 'sos', check_reason: null}]);
});

test('SOS while a check is asking closes it with the SOS incident; SOS upgrades a missed-check incident with its own SOS alerts', async t => {
  const f = await fixture(t); const family = await contactFor(f, 'family'); const trip = await f.trip([family.grant]);
  await f.ctx.pool.query("INSERT INTO security_checks VALUES(gen_random_uuid(),$1,'silence','asking',$2,$2,$2,NULL,NULL)", [trip, f.ctx.clock()]);
  const sos = (await f.req('POST', `/v1/trips/${trip}/sos`, {})).body.id;
  assert.deepEqual((await f.ctx.pool.query('SELECT status,incident_id FROM security_checks')).rows, [{status: 'escalated', incident_id: sos}]);

  const g = await fixture(t); const other = await contactFor(g, 'family'); const second = await g.trip([other.grant]);
  await g.ctx.pool.query("INSERT INTO incidents(id,trip_id,driver_id,created_at,trigger,check_reason) VALUES(gen_random_uuid(),$1,$2,$3,'missed_check','silence')", [second, g.me.id, g.ctx.clock()]);
  const upgraded = (await g.req('POST', `/v1/trips/${second}/sos`, {})).body.id;
  assert.deepEqual((await g.ctx.pool.query('SELECT id,trigger,check_reason FROM incidents')).rows, [{id: upgraded, trigger: 'sos', check_reason: null}]);
  assert.deepEqual(await jobsOf(g, upgraded), [pending('family', 'sms'), pending('family', 'voice'), pending('family', 'whatsapp'), groupFact]);
});

test('check timings are all-or-nothing and positive', async () => {
  const {checkConfig} = await import('../dist/checks/sweep.js');
  assert.equal(checkConfig({}), null);
  assert.throws(() => checkConfig({SILENCE_MS: '120000'}), /Complete check timing/);
  assert.throws(() => checkConfig({SILENCE_MS: '0', ASK_GRACE_MS: '1', ARRIVAL_GRACE_MS: '1', CHECK_SWEEP_MS: '1'}), /Complete check timing/);
  assert.deepEqual(checkConfig({SILENCE_MS: '120000', ASK_GRACE_MS: '60000', ARRIVAL_GRACE_MS: '120000', CHECK_SWEEP_MS: '5000'}), cfg);
  assert.deepEqual(checkConfig({SILENCE_MS: '120000', ASK_GRACE_MS: '60000', ARRIVAL_GRACE_MS: '120000', CHECK_SWEEP_MS: '5000', DEMO_MODE: 'true'}), {...cfg, demo: true});
  assert.deepEqual(checkConfig({SILENCE_MS: '120000', ASK_GRACE_MS: '60000', ARRIVAL_GRACE_MS: '120000', CHECK_SWEEP_MS: '5000', DEMO_MODE: 'TRUE'}), cfg);
});

test('silence opens one check; OK closes it and the same reason does not reopen at once', async t => {
  const f = await fixture(t); const trip = await f.trip();
  f.advance(120000); await sweep(f); assert.deepEqual(await checksOf(f, trip), []);
  f.advance(1); await sweep(f); await sweep(f); assert.deepEqual(await checksOf(f, trip), [asking('silence')]);
  assert.equal((await f.req('POST', `/v1/trips/${trip}/commands`, {type: 'checkin_ok'})).status, 200);
  await sweep(f); assert.deepEqual(await checksOf(f, trip), [{reason: 'silence', status: 'ok', incident_id: null}]);
  f.advance(120001); await sweep(f); assert.deepEqual((await checksOf(f, trip)).map(c => c.status), ['ok', 'asking']);
});

test('a location upload, resume or incident resolution counts as a sign of life', async t => {
  const f = await fixture(t); const trip = await f.trip();
  f.advance(100000);
  await f.req('POST', `/v1/trips/${trip}/locations`, {observations: [{capturedAt: f.ctx.clock().toISOString(), latitude: -12, longitude: -77, accuracy: 9}]});
  f.advance(100000); await sweep(f); assert.deepEqual(await checksOf(f, trip), []);
  await f.req('POST', `/v1/trips/${trip}/commands`, {type: 'pause'}); f.advance(500000);
  await f.req('POST', `/v1/trips/${trip}/commands`, {type: 'resume'}); await sweep(f);
  assert.deepEqual(await checksOf(f, trip), []);
  const sos = (await f.req('POST', `/v1/trips/${trip}/sos`, {})).body.id;
  f.advance(500000); assert.equal((await f.req('POST', `/v1/incidents/${sos}/resolve`, {})).status, 200); await sweep(f);
  assert.deepEqual(await checksOf(f, trip), []);
});

test('an unanswered check escalates once to family (3 channels), colleague (2) and an unavailable group', async t => {
  const f = await fixture(t);
  const family = await contactFor(f, 'family'); const colleague = await contactFor(f, 'colleague', 'colleague');
  const trip = await f.trip([family.grant, colleague.grant]);
  f.advance(120001); await sweep(f); f.advance(59999); await sweep(f);
  assert.deepEqual(await checksOf(f, trip), [asking('silence')]);
  f.advance(1); await Promise.all([sweep(f), sweep(f)]); await sweep(f);
  const incidents = (await f.ctx.pool.query('SELECT id,driver_id,trigger,check_reason,status FROM incidents')).rows;
  assert.equal(incidents.length, 1);
  assert.deepEqual({...incidents[0], id: undefined}, {id: undefined, driver_id: f.me.id, trigger: 'missed_check', check_reason: 'silence', status: 'active'});
  assert.deepEqual(await checksOf(f, trip), [{reason: 'silence', status: 'escalated', incident_id: incidents[0].id}]);
  assert.deepEqual(await jobsOf(f, incidents[0].id), expectedFanOut);
  const {authorizeJob, claimJob} = await import('../dist/notifications/dispatch.js');
  const {provider} = await import('./helpers/dispatch.mjs');
  const job = (await f.ctx.pool.query("SELECT j.id AS \"jobId\",j.version,j.class FROM jobs j JOIN contact_grants cg ON cg.id=j.grant_id WHERE j.incident_id=$1 AND cg.role='family' AND j.channel='sms'", [incidents[0].id])).rows[0];
  const attempt = await authorizeJob(f.ctx, await claimJob(f.ctx, job, 'checks-test'), provider());
  assert.match(attempt.payload.text, /^ANDES: estado sin confirmar\. el conductor del camión SYNTHETIC truck no confirmó su estado \(sin señal desde 09:00\)\. Incidente [0-9a-f-]{36}\. Última ubicación no disponible\./);
});

test('arrival and pause cancel an open check; a paused trip gets no new check', async t => {
  const f = await fixture(t); const arriving = await f.trip(); const pausing = await f.trip();
  f.advance(120001); await sweep(f);
  await f.req('POST', `/v1/trips/${arriving}/commands`, {type: 'arrived'});
  await f.req('POST', `/v1/trips/${pausing}/commands`, {type: 'pause'});
  f.advance(600000); await sweep(f);
  assert.deepEqual(await checksOf(f, arriving), [{reason: 'silence', status: 'cancelled', incident_id: null}]);
  assert.deepEqual(await checksOf(f, pausing), [{reason: 'silence', status: 'cancelled', incident_id: null}]);
  assert.equal((await f.ctx.pool.query('SELECT count(*)::int n FROM incidents')).rows[0].n, 0);
});

test('escalation attaches to an already active incident instead of creating a second one', async t => {
  const f = await fixture(t); const trip = await f.trip();
  f.advance(120001); await sweep(f);
  const id = (await f.ctx.pool.query("INSERT INTO incidents(id,trip_id,driver_id,created_at) VALUES(gen_random_uuid(),$1,$2,$3) RETURNING id", [trip, f.me.id, f.ctx.clock()])).rows[0].id;
  f.advance(60000); await sweep(f);
  assert.deepEqual(await checksOf(f, trip), [{reason: 'silence', status: 'escalated', incident_id: id}]);
  assert.equal((await f.ctx.pool.query('SELECT count(*)::int n FROM incidents')).rows[0].n, 1);
});

test('arrival overdue opens a check after the grace period', async t => {
  const f = await fixture(t);
  const draft = await f.draft({expectedArrivalAt: '2026-10-17T12:30:00Z'});
  const trip = (await f.req('POST', `/v1/trip-drafts/${draft.body.id}/confirm`, {confirmed: true, contactGrantIds: []})).body.id;
  const quiet = {...cfg, silenceMs: 86400000};
  f.advance(32 * 60000); await sweep(f, quiet); assert.deepEqual(await checksOf(f, trip), []);
  f.advance(1); await sweep(f, quiet); assert.deepEqual(await checksOf(f, trip), [asking('arrival_overdue')]);
});

test('one failing trip does not stop the sweep for the others', async t => {
  const f = await fixture(t); const broken = await f.trip(); const healthy = await f.trip();
  await f.ctx.pool.query(`CREATE FUNCTION fail_check() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.trip_id = '${broken}' THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END $$`);
  await f.ctx.pool.query('CREATE TRIGGER fail_check BEFORE INSERT ON security_checks FOR EACH ROW EXECUTE FUNCTION fail_check()');
  f.advance(120001); await sweep(f);
  assert.deepEqual(await checksOf(f, broken), []);
  assert.deepEqual(await checksOf(f, healthy), [asking('silence')]);
});

test('sharing stopped opens a check at once; resume clears it; both are audited', async t => {
  const f = await fixture(t); const trip = await f.trip(); f.advance(1000);
  const stop = await f.req('POST', `/v1/trips/${trip}/sharing`, {state: 'stopped', reason: 'page_hidden'}, f.driver, 'stop-1');
  assert.deepEqual(stop, {status: 200, body: {id: trip, sharing: 'stopped'}});
  assert.deepEqual(await f.req('POST', `/v1/trips/${trip}/sharing`, {state: 'stopped', reason: 'page_hidden'}, f.driver, 'stop-1'), stop);
  assert.equal((await f.req('POST', `/v1/trips/${trip}/sharing`, {state: 'stopped', reason: 'bored'})).status, 400);
  assert.equal((await f.req('POST', `/v1/trips/${trip}/sharing`, {state: 'stopped', reason: 'user'}, f.stranger)).status, 403);
  await sweep(f); assert.deepEqual(await checksOf(f, trip), [asking('sharing_stopped')]);
  assert.equal((await f.req('POST', `/v1/trips/${trip}/sharing`, {state: 'resumed', reason: 'user'})).status, 200);
  assert.equal((await f.ctx.pool.query('SELECT sharing_stopped_at FROM trips WHERE id=$1', [trip])).rows[0].sharing_stopped_at, null);
  assert.deepEqual((await f.ctx.pool.query('SELECT kind FROM trip_events WHERE trip_id=$1 ORDER BY created_at,kind', [trip])).rows.map(r => r.kind), ['sharing_resumed', 'sharing_stopped:page_hidden']);
  await f.req('POST', `/v1/trips/${trip}/commands`, {type: 'arrived'});
  assert.equal((await f.req('POST', `/v1/trips/${trip}/sharing`, {state: 'stopped', reason: 'user'})).status, 409);
});

test('status drives both screens without phone numbers and follows grant scopes', async t => {
  const f = await fixture(t); const family = await contactFor(f, 'family'); const trip = await f.trip([family.grant]);
  const path = `/v1/trips/${trip}/status`;
  const quiet = await f.req('GET', path);
  assert.deepEqual(quiet, {status: 200, body: {trip: {status: 'active', paused: false, expectedArrivalAt: null}, check: null, incident: null, deliveries: [],
    location: {freshness: 'unavailable', ageMs: null, capturedAt: null, accuracy: null}}});
  await f.req('POST', `/v1/trips/${trip}/locations`, {observations: [{capturedAt: f.ctx.clock().toISOString(), latitude: -12, longitude: -77, accuracy: 30}]});
  f.advance(120001); await sweep(f);
  const askingStatus = (await f.req('GET', path, undefined, family.jwt)).body;
  assert.deepEqual(askingStatus.check, {status: 'asking', reason: 'silence', askUntil: '2026-10-17T12:03:00.001Z'});
  assert.deepEqual(askingStatus.location, {freshness: 'stale', ageMs: 120001, capturedAt: '2026-10-17T12:00:00.000Z', accuracy: 30});
  f.advance(60000); await sweep(f);
  const alerted = (await f.req('GET', path, undefined, family.jwt)).body;
  assert.equal(alerted.check, null);
  assert.deepEqual({...alerted.incident, id: typeof alerted.incident.id}, {id: 'string', trigger: 'missed_check', checkReason: 'silence', status: 'active', createdAt: '2026-10-17T12:03:00.001Z'});
  assert.deepEqual(alerted.deliveries.map(d => `${d.role}:${d.channel}:${d.status}`), ['family:sms:pending', 'family:voice:pending', 'family:whatsapp:pending', 'group:group:unavailable']);
  assert.doesNotMatch(JSON.stringify(alerted), /\+55|contact|recipient/);
  await f.ctx.pool.query('UPDATE contact_grants SET map_accepted=false');
  assert.equal((await f.req('GET', path, undefined, family.jwt)).body.location, undefined);
  assert.equal((await f.req('GET', path, undefined, f.stranger)).status, 403);
  await f.req('POST', `/v1/trips/${trip}/contacts/${family.grant}/revoke`, {}, family.jwt);
  assert.equal((await f.req('GET', path, undefined, family.jwt)).status, 403);
});

test('alert wording names the truck, keeps the incident ID and never invents location', async () => {
  const {alertSummary} = await import('../dist/notifications/wording.js');
  const now = new Date('2026-10-17T12:05:00Z');
  const base = {truck: 'ABC-123', country: 'PE', timeZone: 'America/Lima', now, signalAt: null,
    location: {latitude: -12.1, longitude: -77.03, accuracy: 18.4, captured_at: new Date('2026-10-17T12:02:00Z')}};
  const env = {EMERGENCY_NUMBERS: '{"PE":"105"}', CONTACT_APP_URL: 'https://andes.example'};
  assert.equal(alertSummary({...base, incident: {id: 'i-1', trigger: 'sos', check_reason: null}}, env),
    'ALERTA: el conductor del camión ABC-123 pidió ayuda (posible robo). Incidente i-1. Última ubicación hace 3 min (±18 m): https://maps.google.com/?q=-12.1,-77.03. Llámalo. Si no responde, llama al 105. Ver: https://andes.example/incidents/i-1');
  assert.equal(alertSummary({...base, location: null, signalAt: new Date('2026-10-17T11:58:00Z'), incident: {id: 'i-2', trigger: 'missed_check', check_reason: 'silence'}}, {}),
    'el conductor del camión ABC-123 no confirmó su estado (sin señal desde 06:58). Incidente i-2. Última ubicación no disponible. No sabemos qué pasó. Llámalo.');
  assert.match(alertSummary({...base, incident: {id: 'i-3', trigger: 'missed_check', check_reason: 'arrival_overdue'}}, env), /no llegó a la hora prevista\). Incidente i-3\..*Llámalo; si no responde, llama al 105\./);
  assert.match(alertSummary({...base, incident: {id: 'i-4', trigger: 'missed_check', check_reason: 'sharing_stopped'}}, {}), /dejó de compartir su ubicación/);
  assert.match(alertSummary({...base, location: {...base.location, captured_at: new Date('2026-10-17T10:00:00Z')}, incident: {id: 'i-5', trigger: 'sos', check_reason: null}}, {}), /hace 2 h 5 min/);
  assert.match(alertSummary({...base, truck: 'ABC\n123\t'.padEnd(80, 'x'), incident: {id: 'i-6', trigger: 'sos', check_reason: null}}, {}), /camión ABC 123 x{32} pidió/);
  const spoken = alertSummary({...base, voice: true, incident: {id: 'i-7', trigger: 'sos', check_reason: null}}, env);
  assert.doesNotMatch(spoken, /https?:/);
  assert.match(spoken, /Incidente i-7\. Última ubicación hace 3 min, precisión de 18 metros\. Llámalo\./);
});

test('the control worker runs the sweeper only when check timings are configured', async t => {
  const f = await fixture(t); const trip = await f.trip(); f.advance(120001);
  const {control} = await import('../dist/worker.js');
  const {provider} = await import('./helpers/dispatch.mjs');
  const quiet = new AbortController(); const off = control(f.ctx, {async publish() {}}, provider(), quiet.signal);
  await new Promise(resolve => setTimeout(resolve, 50)); quiet.abort(); await off;
  assert.deepEqual(await checksOf(f, trip), []);
  const abort = new AbortController(); const running = control(f.ctx, {async publish() {}}, provider(), abort.signal, {...cfg, sweepMs: 10});
  for (let i = 0; i < 100 && !(await checksOf(f, trip)).length; i++) await new Promise(resolve => setTimeout(resolve, 10));
  abort.abort(); await running;
  assert.deepEqual(await checksOf(f, trip), [asking('silence')]);
});

test('resolving an overdue alert or resuming after the expected arrival does not re-alert at once', async t => {
  const f = await fixture(t);
  const draft = await f.draft({expectedArrivalAt: '2026-10-17T12:30:00Z'});
  const trip = (await f.req('POST', `/v1/trip-drafts/${draft.body.id}/confirm`, {confirmed: true, contactGrantIds: []})).body.id;
  const quiet = {...cfg, silenceMs: 86400000};
  f.advance(32 * 60000 + 1); await sweep(f, quiet); f.advance(60000); await sweep(f, quiet);
  const incident = (await f.ctx.pool.query('SELECT id FROM incidents')).rows[0].id;
  assert.equal((await f.req('POST', `/v1/incidents/${incident}/resolve`, {})).status, 200);
  await sweep(f, quiet); assert.deepEqual((await checksOf(f, trip)).map(c => c.status), ['escalated']);
  await f.req('POST', `/v1/trips/${trip}/commands`, {type: 'pause'}); f.advance(600000);
  await f.req('POST', `/v1/trips/${trip}/commands`, {type: 'resume'}); await sweep(f, quiet);
  assert.deepEqual((await checksOf(f, trip)).map(c => c.status), ['escalated']);
  f.advance(120001); await sweep(f, quiet);
  assert.deepEqual(await checksOf(f, trip), [{reason: 'arrival_overdue', status: 'escalated', incident_id: incident}, asking('arrival_overdue')]);
});

test('a trip confirmed after its expected arrival gets the full grace period first', async t => {
  const f = await fixture(t); f.advance(3600000);
  const draft = await f.draft({expectedArrivalAt: '2026-10-17T12:30:00Z'});
  const trip = (await f.req('POST', `/v1/trip-drafts/${draft.body.id}/confirm`, {confirmed: true, contactGrantIds: []})).body.id;
  const quiet = {...cfg, silenceMs: 86400000};
  f.advance(120000); await sweep(f, quiet); assert.deepEqual(await checksOf(f, trip), []);
  f.advance(1); await sweep(f, quiet); assert.deepEqual(await checksOf(f, trip), [asking('arrival_overdue')]);
});

test('a check opened after waiting for the trip lock gets its full grace window from when it opens', async t => {
  const f = await fixture(t); const waited = await f.trip(); const control = await f.trip();
  const askUntil = async trip => (await f.ctx.pool.query("SELECT created_at,ask_until FROM security_checks WHERE trip_id=$1 AND status='asking'", [trip])).rows[0];
  f.advance(120001); await sweep(f);
  assert.deepEqual(await askUntil(control), {created_at: new Date('2026-10-17T12:02:00.001Z'), ask_until: new Date('2026-10-17T12:03:00.001Z')});
  await f.ctx.pool.query("DELETE FROM security_checks WHERE trip_id=$1", [waited]);
  const blocker = await f.ctx.pool.connect(); await blocker.query('BEGIN');
  await blocker.query('SELECT 1 FROM trips WHERE id=$1 FOR UPDATE', [waited]);
  const running = sweep(f);
  await waitForBlockedQueries(f.ctx.pool, 'SELECT * FROM trips WHERE id=$1 FOR UPDATE%', 1);
  f.advance(50000);
  await blocker.query('COMMIT'); blocker.release(); await running;
  assert.deepEqual(await askUntil(waited), {created_at: new Date('2026-10-17T12:02:50.001Z'), ask_until: new Date('2026-10-17T12:03:50.001Z')});
  f.advance(10000); await sweep(f);
  assert.deepEqual((await checksOf(f, waited)).map(c => c.status), ['asking'], 'not escalated before its own grace window ends');
});

async function escalated(f) {
  const family = await contactFor(f, 'family'); const trip = await f.trip([family.grant]);
  f.advance(120001); await sweep(f); f.advance(60000); await sweep(f);
  return {trip, incident: (await f.ctx.pool.query("SELECT id FROM incidents WHERE trigger='missed_check'")).rows[0].id};
}
const sendable = async (f, incident) => (await f.ctx.pool.query(`SELECT j.id AS "jobId",j.version,j.class,j.channel FROM jobs j JOIN outbox o ON o.job_id=j.id AND o.job_version=j.version
  WHERE j.incident_id=$1 AND j.status='pending' AND j.expires_at>$2 ORDER BY j.channel`, [incident, f.ctx.clock()])).rows;

test('SOS after the missed-check alerts expired sends a new SOS-worded alert on every channel', async t => {
  const f = await fixture(t); const {trip, incident} = await escalated(f);
  f.advance(16 * 60000);
  assert.deepEqual(await sendable(f, incident), [], 'missed-check alerts have expired');
  const sos = await f.req('POST', `/v1/trips/${trip}/sos`, {});
  assert.deepEqual(sos, {status: 200, body: {id: incident, tripId: trip, status: 'active', groupCapability: 'unavailable'}});
  assert.deepEqual((await sendable(f, incident)).map(j => j.channel), ['sms', 'voice', 'whatsapp']);
  assert.deepEqual((await f.ctx.pool.query('SELECT trigger,check_reason FROM incidents')).rows, [{trigger: 'sos', check_reason: null}]);
  // A repeated tap shares the episode: no third wave.
  assert.equal((await f.req('POST', `/v1/trips/${trip}/sos`, {})).status, 200);
  assert.equal((await sendable(f, incident)).length, 3);
  const {authorizeJob, claimJob} = await import('../dist/notifications/dispatch.js');
  const {provider} = await import('./helpers/dispatch.mjs');
  const [sms] = await sendable(f, incident);
  assert.match((await authorizeJob(f.ctx, await claimJob(f.ctx, sms, 'sos-upgrade'), provider())).payload.text, /ALERTA: el conductor del camión SYNTHETIC truck pidió ayuda/);
  const status = (await f.req('GET', `/v1/trips/${trip}/status`)).body;
  assert.deepEqual(status.incident.checkReason, null);
  assert.deepEqual(status.deliveries.map(d => `${d.role}:${d.channel}:${d.status}`), ['family:sms:authorized', 'family:voice:pending', 'family:whatsapp:pending', 'group:group:unavailable']);
});

test('SOS after missed-check alerts were accepted adds SOS alerts and keeps the accepted facts', async t => {
  const f = await fixture(t); const {trip, incident} = await escalated(f);
  const {runJob} = await import('../dist/notifications/dispatch.js');
  const {provider} = await import('./helpers/dispatch.mjs');
  const accepting = provider({async send(payload) { return {state: 'accepted', messageId: `msg_${payload.metadata.attemptId}`, status: 'queued'}; }});
  for (const job of await sendable(f, incident)) await runJob(f.ctx, job, accepting, 'missed-check');
  assert.equal((await f.req('POST', `/v1/trips/${trip}/sos`, {})).status, 200);
  assert.deepEqual((await f.ctx.pool.query(`SELECT j.trigger,j.status,count(*)::int n FROM jobs j WHERE j.incident_id=$1 AND j.channel<>'group' GROUP BY 1,2 ORDER BY 1`, [incident])).rows,
    [{trigger: 'missed_check', status: 'accepted', n: 3}, {trigger: 'sos', status: 'pending', n: 3}]);
  assert.equal((await sendable(f, incident)).length, 3);
  assert.equal((await f.ctx.pool.query('SELECT count(*)::int n FROM dispatch_attempts')).rows[0].n, 3, 'no prior attempt is resent or rewritten');
});

test('a late OK after escalation keeps the incident and its alerts; it never cancels an SOS', async t => {
  const f = await fixture(t); const {trip, incident} = await escalated(f);
  f.advance(1000);
  assert.equal((await f.req('POST', `/v1/trips/${trip}/commands`, {type: 'checkin_ok'})).status, 200);
  assert.deepEqual((await f.ctx.pool.query('SELECT status FROM incidents')).rows, [{status: 'active'}]);
  assert.equal((await sendable(f, incident)).length, 3, 'only an explicit resolve cancels alerts');
  assert.equal((await f.req('POST', `/v1/trips/${trip}/sos`, {})).status, 200);
  assert.equal((await f.req('POST', `/v1/trips/${trip}/commands`, {type: 'checkin_ok'})).status, 200);
  assert.deepEqual((await f.ctx.pool.query("SELECT trigger,status FROM incidents")).rows, [{trigger: 'sos', status: 'active'}]);
  assert.equal((await f.ctx.pool.query("SELECT count(*)::int n FROM jobs WHERE incident_id=$1 AND trigger='sos' AND status='pending'", [incident])).rows[0].n, 3);
});

test('resuming sharing closes the open sharing-stopped check, so a screen lock is not a false alarm', async t => {
  const f = await fixture(t); const family = await contactFor(f, 'family'); const trip = await f.trip([family.grant]);
  f.advance(1000); await f.req('POST', `/v1/trips/${trip}/sharing`, {state: 'stopped', reason: 'page_hidden'});
  await sweep(f); assert.deepEqual(await checksOf(f, trip), [asking('sharing_stopped')]);
  f.advance(2000);
  assert.equal((await f.req('POST', `/v1/trips/${trip}/sharing`, {state: 'resumed', reason: 'user'})).status, 200);
  await f.req('POST', `/v1/trips/${trip}/locations`, {observations: [{capturedAt: f.ctx.clock().toISOString(), latitude: -12, longitude: -77, accuracy: 9}]});
  assert.deepEqual(await checksOf(f, trip), [{reason: 'sharing_stopped', status: 'cancelled', incident_id: null}]);
  f.advance(60000); await sweep(f);
  assert.equal((await f.ctx.pool.query('SELECT count(*)::int n FROM incidents')).rows[0].n, 0);
  // An open check for another reason is not the resume's to close.
  f.advance(120001); await sweep(f); assert.deepEqual((await checksOf(f, trip)).at(-1), asking('silence'));
  await f.req('POST', `/v1/trips/${trip}/sharing`, {state: 'resumed', reason: 'user'});
  assert.deepEqual((await checksOf(f, trip)).at(-1), asking('silence'));
});

test('status shows the open check only to the driver and incident-scope contacts', async t => {
  const f = await fixture(t);
  const scoped = async (subject, scope) => {
    const jwt = await f.token(subject); const id = (await f.req('GET', '/v1/me', undefined, jwt)).body.id;
    const invitation = (await f.req('POST', '/v1/contacts', {contactId: id, phone: '+5511999990000', map: true, incident: true})).body.id;
    assert.equal((await f.req('POST', `/v1/contacts/${invitation}/accept`, scope, jwt)).status, 200);
    return {jwt, grant: invitation};
  };
  const mapOnly = await scoped('map-only', {map: true, incident: false});
  const incidentOnly = await scoped('incident-only', {map: false, incident: true});
  const trip = await f.trip([mapOnly.grant, incidentOnly.grant]);
  f.advance(120001); await sweep(f);
  const path = `/v1/trips/${trip}/status`;
  const map = (await f.req('GET', path, undefined, mapOnly.jwt)).body;
  assert.deepEqual({check: map.check, incident: map.incident, freshness: map.location.freshness}, {check: null, incident: null, freshness: 'unavailable'});
  const incident = (await f.req('GET', path, undefined, incidentOnly.jwt)).body;
  assert.deepEqual({check: incident.check?.reason, location: incident.location}, {check: 'silence', location: undefined});
  assert.equal((await f.req('GET', path)).body.check.reason, 'silence');
});

test('status reads never wait on the trip lock or use telemetry capacity', async t => {
  const f = await fixture(t); const busy = await f.trip(); const other = await f.trip();
  const blocker = await f.ctx.pool.connect(); await blocker.query('BEGIN');
  await blocker.query('SELECT 1 FROM trips WHERE id=$1 FOR UPDATE', [busy]);
  try {
    const polls = [f.req('GET', `/v1/trips/${busy}/status`), f.req('GET', `/v1/trips/${busy}/status`)];
    await new Promise(resolve => setTimeout(resolve, 200));
    const started = Date.now();
    const upload = await f.req('POST', `/v1/trips/${other}/locations`, {observations: [{capturedAt: f.ctx.clock().toISOString(), latitude: -12, longitude: -77, accuracy: 9}]});
    assert.equal(upload.status, 200, 'an unrelated trip upload must not starve behind status polls');
    assert.ok(Date.now() - started < 2000);
    assert.deepEqual((await Promise.all(polls)).map(p => p.status), [200, 200], 'status answers while the trip lock is held');
  } finally { await blocker.query('COMMIT'); blocker.release(); }
});

test('a new sharing stop after an OK opens a new check', async t => {
  const f = await fixture(t); const trip = await f.trip(); f.advance(1000);
  await f.req('POST', `/v1/trips/${trip}/sharing`, {state: 'stopped', reason: 'page_hidden'}); await sweep(f);
  f.advance(1000); assert.equal((await f.req('POST', `/v1/trips/${trip}/commands`, {type: 'checkin_ok'})).status, 200);
  f.advance(1000); await f.req('POST', `/v1/trips/${trip}/sharing`, {state: 'stopped', reason: 'permission_denied'}); await sweep(f);
  assert.deepEqual(await checksOf(f, trip), [{reason: 'sharing_stopped', status: 'ok', incident_id: null}, asking('sharing_stopped')]);
});
