import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/runtime.mjs';

export async function contactFor(f, subject, role) {
  const jwt = await f.token(subject);
  const id = (await f.req('GET', '/v1/me', undefined, jwt)).body.id;
  const invitation = await f.req('POST', '/v1/contacts', {contactId: id, phone: '+5511999990000', map: true, incident: true, ...(role ? {role} : {})});
  assert.equal(invitation.status, 200);
  assert.equal((await f.req('POST', `/v1/contacts/${invitation.body.id}/accept`, {map: true, incident: true}, jwt)).status, 200);
  return {jwt, id, grant: invitation.body.id};
}

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

export const jobsOf = async (f, incident) => (await f.ctx.pool.query(`SELECT COALESCE(cg.role,'group') AS role,j.channel,j.status,j.unavailable_reason
  FROM jobs j LEFT JOIN contact_grants cg ON cg.id=j.grant_id WHERE j.incident_id=$1 ORDER BY role,j.channel`, [incident])).rows;
const pending = (role, channel) => ({role, channel, status: 'pending', unavailable_reason: null});
export const expectedFanOut = [pending('colleague', 'sms'), pending('colleague', 'whatsapp'), pending('family', 'sms'), pending('family', 'voice'), pending('family', 'whatsapp'),
  {role: 'group', channel: 'group', status: 'unavailable', unavailable_reason: 'group_support_unverified'}];

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

test('SOS while a check is asking closes it with the SOS incident; SOS upgrades a missed-check incident without new sends', async t => {
  const f = await fixture(t); const family = await contactFor(f, 'family'); const trip = await f.trip([family.grant]);
  await f.ctx.pool.query("INSERT INTO security_checks VALUES(gen_random_uuid(),$1,'silence','asking',$2,$2,$2,NULL,NULL)", [trip, f.ctx.clock()]);
  const sos = (await f.req('POST', `/v1/trips/${trip}/sos`, {})).body.id;
  assert.deepEqual((await f.ctx.pool.query('SELECT status,incident_id FROM security_checks')).rows, [{status: 'escalated', incident_id: sos}]);

  const g = await fixture(t); const other = await contactFor(g, 'family'); const second = await g.trip([other.grant]);
  await g.ctx.pool.query("INSERT INTO incidents(id,trip_id,driver_id,created_at,trigger,check_reason) VALUES(gen_random_uuid(),$1,$2,$3,'missed_check','silence')", [second, g.me.id, g.ctx.clock()]);
  const upgraded = (await g.req('POST', `/v1/trips/${second}/sos`, {})).body.id;
  assert.deepEqual((await g.ctx.pool.query('SELECT id,trigger FROM incidents')).rows, [{id: upgraded, trigger: 'sos'}]);
  assert.equal((await g.ctx.pool.query('SELECT count(*)::int n FROM jobs')).rows[0].n, 0);
});

const support = ['sms', 'whatsapp', 'voice'].map(channel => ({channel, country: 'BR', locale: 'pt-BR'}));
export const cfg = {silenceMs: 120000, askGraceMs: 60000, arrivalGraceMs: 120000, sweepMs: 5000};
export async function sweep(f, config = cfg) { const {checkOnce} = await import('../dist/checks/sweep.js'); await checkOnce(f.ctx, support, config); }
export const checksOf = async (f, trip) => (await f.ctx.pool.query('SELECT reason,status,incident_id FROM security_checks WHERE trip_id=$1 ORDER BY created_at,status', [trip])).rows;
const asking = reason => ({reason, status: 'asking', incident_id: null});

test('check timings are all-or-nothing and positive', async () => {
  const {checkConfig} = await import('../dist/checks/sweep.js');
  assert.equal(checkConfig({}), null);
  assert.throws(() => checkConfig({SILENCE_MS: '120000'}), /Complete check timing/);
  assert.throws(() => checkConfig({SILENCE_MS: '0', ASK_GRACE_MS: '1', ARRIVAL_GRACE_MS: '1', CHECK_SWEEP_MS: '1'}), /Complete check timing/);
  assert.deepEqual(checkConfig({SILENCE_MS: '120000', ASK_GRACE_MS: '60000', ARRIVAL_GRACE_MS: '120000', CHECK_SWEEP_MS: '5000'}), cfg);
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
