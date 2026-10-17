import test from 'node:test';
import assert from 'node:assert/strict';
import {randomInt} from 'node:crypto';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {resolve, sep} from 'node:path';
import {pathToFileURL} from 'node:url';

// Run against a built, disposable archive with TEST_DATABASE_URL set to an owned
// synthetic database. No AWS adapter or live provider is started.
assert.ok(process.env.Q48_REVIEW_CANDIDATE, 'Q48_REVIEW_CANDIDATE is required');
const candidate = pathToFileURL(resolve(process.env.Q48_REVIEW_CANDIDATE) + sep);
const {fixture} = await import(new URL('tests/helpers/runtime.mjs', candidate));
const {provider} = await import(new URL('tests/helpers/dispatch.mjs', candidate));
const {checkOnce, checkConfig} = await import(new URL('dist/checks/sweep.js', candidate));
const dispatch = await import(new URL('dist/notifications/dispatch.js', candidate));
const {control} = await import(new URL('dist/worker.js', candidate));
const cfg = {silenceMs: 120000, askGraceMs: 60000, arrivalGraceMs: 120000, sweepMs: 5000};
const support = ['sms', 'whatsapp', 'voice'].map(channel => ({channel, country: 'BR', locale: 'pt-BR'}));
const sweep = (f, settings = cfg) => checkOnce(f.ctx, support, settings);
const checks = async (f, trip) => (await f.ctx.pool.query('SELECT * FROM security_checks WHERE trip_id=$1 ORDER BY created_at,id', [trip])).rows;
const incidents = async (f, trip) => (await f.ctx.pool.query('SELECT * FROM incidents WHERE trip_id=$1 ORDER BY created_at,id', [trip])).rows;
const post = (f, trip, type, key) => f.req('POST', `/v1/trips/${trip}/commands`, {type}, f.driver, key);

async function blocked(f, pattern) {
  const end = Date.now() + 2500;
  while (Date.now() < end) {
    const result = await f.ctx.pool.query(`SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname=current_database() AND pid<>pg_backend_pid() AND query LIKE $1 AND wait_event_type='Lock'`, [pattern]);
    if (result.rows[0].n) return;
    await new Promise(done => setTimeout(done, 10));
  }
  assert.fail(`No blocked query for ${pattern}`);
}

async function holdMutation(f, table, operation) {
  const key = randomInt(1, 1000000000);
  const connection = await f.ctx.pool.connect();
  await connection.query('SELECT pg_advisory_lock($1)', [key]);
  await f.ctx.pool.query(`CREATE FUNCTION q48_barrier() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN PERFORM pg_advisory_xact_lock(${key}); RETURN NEW; END $$`);
  await f.ctx.pool.query(`CREATE TRIGGER q48_barrier BEFORE ${operation} ON ${table}
    FOR EACH ROW EXECUTE FUNCTION q48_barrier()`);
  let released = false;
  return async () => {
    if (!released) {
      released = true;
      await connection.query('SELECT pg_advisory_unlock($1)', [key]);
      connection.release();
    }
  };
}

async function contacts(f) {
  const result = [];
  for (const role of ['family', 'colleague']) {
    const jwt = await f.token('q48-' + role);
    const identity = (await f.req('GET', '/v1/me', undefined, jwt)).body.id;
    const invite = await f.req('POST', '/v1/contacts', {contactId: identity, phone: '+5511999990000', map: true, incident: true, role});
    assert.equal(invite.status, 200);
    assert.equal((await f.req('POST', `/v1/contacts/${invite.body.id}/accept`, {map: true, incident: true}, jwt)).status, 200);
    result.push(invite.body.id);
  }
  return result;
}

async function fanout(f, id) {
  const rows = (await f.ctx.pool.query(`SELECT COALESCE(cg.role,'group') AS role,j.channel,j.status
    FROM jobs j LEFT JOIN contact_grants cg ON cg.id=j.grant_id WHERE incident_id=$1 ORDER BY role,channel`, [id])).rows;
  assert.deepEqual(rows.map(row => `${row.role}:${row.channel}:${row.status}`), [
    'colleague:sms:pending', 'colleague:whatsapp:pending', 'family:sms:pending',
    'family:voice:pending', 'family:whatsapp:pending', 'group:group:unavailable'
  ]);
  assert.equal((await f.ctx.pool.query('SELECT count(*)::int n FROM outbox')).rows[0].n, 5);
}

test('every timing subset fails closed, all four are required, and production omits all four', async () => {
  const names = ['SILENCE_MS', 'ASK_GRACE_MS', 'ARRIVAL_GRACE_MS', 'CHECK_SWEEP_MS'];
  for (let mask = 0; mask < 16; mask++) {
    const env = Object.fromEntries(names.flatMap((name, index) => mask & (1 << index) ? [[name, '100']] : []));
    if (!mask) assert.equal(checkConfig(env), null);
    else if (mask !== 15) assert.throws(() => checkConfig(env), /Complete check timing/);
    else assert.deepEqual(checkConfig(env), {silenceMs: 100, askGraceMs: 100, arrivalGraceMs: 100, sweepMs: 100});
  }
  for (const invalid of ['0', '-1', '', 'NaN', 'Infinity', '1.5', '9007199254740992']) {
    assert.throws(() => checkConfig(Object.fromEntries(names.map(name => [name, name === 'ASK_GRACE_MS' ? invalid : '100']))));
  }
  const {readFile} = await import('node:fs/promises');
  const infrastructure = JSON.parse(await readFile(new URL('infra/template.json', candidate), 'utf8'));
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (!Array.isArray(value)) assert.ok(!names.includes(value.Name ?? value.name));
    for (const item of Object.values(value)) visit(item);
  }
  visit(infrastructure);
});

test('default control loop stays off while explicit SOS remains available', async t => {
  const f = await fixture(t); const trip = await f.trip(); f.advance(600000);
  const abort = new AbortController();
  const worker = control(f.ctx, {async publish() {}}, null, abort.signal);
  try { await new Promise(done => setTimeout(done, 35)); }
  finally { abort.abort(); await worker; }
  assert.equal((await checks(f, trip)).length, 0);
  assert.equal((await f.req('POST', `/v1/trips/${trip}/sos`, {})).status, 200);
});

test('concurrent opening sweeps commit one asking check', async t => {
  const f = await fixture(t); const trip = await f.trip(); f.advance(cfg.silenceMs + 1);
  await Promise.all(Array.from({length: 8}, () => sweep(f)));
  assert.equal((await checks(f, trip)).length, 1);
  assert.equal((await checks(f, trip))[0].status, 'asking');
  assert.equal((await incidents(f, trip)).length, 0);
});

test('sharing mutation replays once, rejects changed content, and resumed sharing alone is no OK', async t => {
  const f = await fixture(t); const trip = await f.trip(); f.advance(1);
  const url = `/v1/trips/${trip}/sharing`;
  const body = {state: 'stopped', reason: 'page_hidden'};
  const replies = await Promise.all(Array.from({length: 6}, () => f.req('POST', url, body, f.driver, 'q48-stop')));
  assert.ok(replies.every(value => value.status === 200));
  assert.equal((await f.ctx.pool.query("SELECT count(*)::int n FROM trip_events WHERE trip_id=$1 AND kind='sharing_stopped:page_hidden'", [trip])).rows[0].n, 1);
  assert.equal((await f.req('POST', url, {state: 'resumed', reason: 'user'}, f.driver, 'q48-stop')).status, 409);
  await sweep(f);
  assert.equal((await checks(f, trip))[0].reason, 'sharing_stopped');
  assert.equal((await f.req('POST', url, {state: 'resumed', reason: 'user'})).status, 200);
  assert.equal((await checks(f, trip))[0].status, 'asking');
  assert.equal((await post(f, trip, 'checkin_ok')).status, 200);
  assert.equal((await checks(f, trip))[0].status, 'ok');
});

for (const first of ['pause', 'sweep']) {
  test(`check opening versus pause: ${first} commits first`, {timeout: 15000}, async t => {
    const f = await fixture(t); const trip = await f.trip(); f.advance(cfg.silenceMs + 1);
    const release = await holdMutation(f, first === 'pause' ? 'trips' : 'security_checks', first === 'pause' ? 'UPDATE' : 'INSERT');
    let a, b;
    try {
      a = first === 'pause' ? post(f, trip, 'pause') : sweep(f);
      await blocked(f, first === 'pause' ? 'UPDATE trips SET paused%' : 'INSERT INTO security_checks%');
      b = first === 'pause' ? sweep(f) : post(f, trip, 'pause');
      await blocked(f, 'SELECT * FROM trips WHERE id=$1 FOR UPDATE%');
    } finally { await release(); }
    await Promise.all([a, b]);
    const rows = await checks(f, trip);
    assert.equal(rows.length, first === 'pause' ? 0 : 1);
    assert.ok(rows.every(row => row.status === 'cancelled'));
    f.advance(600000); await sweep(f);
    assert.equal((await incidents(f, trip)).length, 0);
  });
}

for (const command of ['arrived', 'cancel', 'pause', 'checkin_ok']) for (const first of ['command', 'sweep']) {
  test(`expired check versus ${command}: ${first} commits first`, {timeout: 15000}, async t => {
    const f = await fixture(t); const trip = await f.trip(); f.advance(cfg.silenceMs + 1); await sweep(f); f.advance(cfg.askGraceMs);
    const release = await holdMutation(f, first === 'command' ? (command === 'checkin_ok' ? 'security_checks' : 'trips') : 'incidents', first === 'command' ? 'UPDATE' : 'INSERT');
    let a, b;
    try {
      a = first === 'command' ? post(f, trip, command) : sweep(f);
      await blocked(f, first === 'command' ? command === 'checkin_ok' ? 'UPDATE security_checks%' : command === 'pause' ? 'UPDATE trips SET paused%' : 'UPDATE trips SET status%' : 'INSERT INTO incidents%');
      b = first === 'command' ? sweep(f) : post(f, trip, command);
      await blocked(f, 'SELECT * FROM trips WHERE id=$1 FOR UPDATE%');
    } finally { await release(); }
    await Promise.all([a, b]);
    assert.equal((await incidents(f, trip)).length, first === 'command' ? 0 : 1);
    assert.equal((await checks(f, trip))[0].status, first === 'sweep' ? 'escalated' : command === 'checkin_ok' ? 'ok' : 'cancelled');
  });
}

for (const first of ['sos', 'sweep']) {
  test(`SOS versus escalation: ${first} commits first, one fanout and one send`, {timeout: 15000}, async t => {
    const f = await fixture(t); const trip = await f.trip(await contacts(f));
    f.advance(cfg.silenceMs + 1); await sweep(f); f.advance(cfg.askGraceMs);
    const release = await holdMutation(f, 'incidents', 'INSERT');
    let a, b;
    try {
      a = first === 'sos' ? f.req('POST', `/v1/trips/${trip}/sos`, {}, f.driver, 'q48-sos') : sweep(f);
      await blocked(f, 'INSERT INTO incidents%');
      b = first === 'sos' ? sweep(f) : f.req('POST', `/v1/trips/${trip}/sos`, {}, f.driver, 'q48-sos');
      await blocked(f, 'SELECT * FROM trips WHERE id=$1 FOR UPDATE%');
    } finally { await release(); }
    await Promise.all([a, b]);
    const rows = await incidents(f, trip); assert.equal(rows.length, 1); assert.equal(rows[0].trigger, 'sos');
    assert.equal((await checks(f, trip))[0].incident_id, rows[0].id);
    await fanout(f, rows[0].id);
    const replay = await f.req('POST', `/v1/trips/${trip}/sos`, {}, f.driver, 'q48-sos');
    assert.equal(replay.body.id, rows[0].id);
    const job = (await f.ctx.pool.query("SELECT id AS \"jobId\",version,class FROM jobs WHERE incident_id=$1 AND channel='sms' ORDER BY id LIMIT 1", [rows[0].id])).rows[0];
    let sends = 0;
    const p = provider({async send(payload) { sends++; assert.match(payload.text, /ALERTA:.*pidió ayuda/); return {state: 'unknown'}; }});
    await dispatch.runJob(f.ctx, job, p, 'q48-first');
    await dispatch.runJob(f.ctx, job, p, 'q48-duplicate');
    assert.equal(sends, 1);
  });
}

test('late OK does not resolve an incident; explicit resolve gives one grace window before re-alert', async t => {
  const f = await fixture(t); const draft = await f.draft({expectedArrivalAt: f.ctx.clock().toISOString()});
  const trip = (await f.req('POST', `/v1/trip-drafts/${draft.body.id}/confirm`, {confirmed: true, contactGrantIds: []})).body.id;
  const settings = {...cfg, silenceMs: 86400000};
  f.advance(cfg.arrivalGraceMs + 1); await sweep(f, settings); f.advance(cfg.askGraceMs); await sweep(f, settings);
  const original = (await incidents(f, trip))[0];
  assert.equal((await post(f, trip, 'checkin_ok')).status, 200);
  assert.equal((await incidents(f, trip))[0].status, 'active');
  await sweep(f, settings); assert.equal((await checks(f, trip)).length, 1);
  assert.equal((await f.req('POST', `/v1/incidents/${original.id}/resolve`, {})).status, 200);
  await sweep(f, settings); assert.equal((await checks(f, trip)).length, 1);
  f.advance(cfg.arrivalGraceMs); await sweep(f, settings); assert.equal((await checks(f, trip)).length, 1);
  f.advance(1); await sweep(f, settings); assert.equal((await checks(f, trip)).length, 2);
  assert.equal((await incidents(f, trip)).length, 1);
});

test('pause/resume suspends checks, retains unknown location and never suspends SOS', async t => {
  const f = await fixture(t); const trip = await f.trip();
  assert.equal((await post(f, trip, 'pause')).status, 200); f.advance(600000); await sweep(f);
  const status = (await f.req('GET', `/v1/trips/${trip}/status`)).body;
  assert.equal(status.trip.paused, true); assert.equal(status.location.freshness, 'unavailable'); assert.equal(status.check, null);
  const incident = (await f.req('POST', `/v1/trips/${trip}/sos`, {})).body.id; assert.ok(incident);
  await f.req('POST', `/v1/incidents/${incident}/resolve`, {});
  assert.equal((await post(f, trip, 'resume')).status, 200); await sweep(f); assert.equal((await checks(f, trip)).length, 0);
  f.advance(cfg.silenceMs); await sweep(f); assert.equal((await checks(f, trip)).length, 0);
  f.advance(1); await sweep(f); assert.equal((await checks(f, trip)).length, 1);
});

test('closed trip stops sharing and map disclosure while explicit SOS remains available', async t => {
  const f=await fixture(t); const grant=await f.grant(); const trip=await f.trip([grant]);
  await f.req('POST',`/v1/trips/${trip}/locations`,{observations:[{capturedAt:f.ctx.clock().toISOString(),latitude:-12,longitude:-77,accuracy:9}]});
  assert.equal((await post(f,trip,'arrived')).status,200);
  assert.equal((await f.req('POST',`/v1/trips/${trip}/sharing`,{state:'stopped',reason:'user'})).status,409);
  assert.equal((await f.req('GET',`/v1/trips/${trip}/snapshot`,undefined,f.contact)).status,403);
  const incident=(await f.req('POST',`/v1/trips/${trip}/sos`,{})).body.id;
  const job=(await f.ctx.pool.query("SELECT id AS \"jobId\",version,class FROM jobs WHERE incident_id=$1 AND channel='sms'",[incident])).rows[0];
  let sent;
  await dispatch.runJob(f.ctx,job,provider({async send(payload){sent=payload.text;return{state:'unknown'};}}),'q48-closed');
  assert.match(sent,/pidió ayuda/); assert.match(sent,/ubicación no disponible/); assert.doesNotMatch(sent,/maps\.google\.com/);
});

test('SOS upgrades pending wording but neither rewrites nor resends a committed missed-check attempt', async t => {
  const f=await fixture(t); const trip=await f.trip(await contacts(f));
  f.advance(cfg.silenceMs+1); await sweep(f); f.advance(cfg.askGraceMs); await sweep(f);
  const incident=(await incidents(f,trip))[0].id;
  const jobs=(await f.ctx.pool.query("SELECT id AS \"jobId\",version,class,channel FROM jobs WHERE incident_id=$1 AND channel IN ('sms','voice') ORDER BY channel",[incident])).rows;
  const sms=jobs.find(job=>job.channel==='sms'); const voice=jobs.find(job=>job.channel==='voice');
  let sends=0;
  await dispatch.runJob(f.ctx,sms,provider({async send(payload){sends++;assert.match(payload.text,/no confirmó su estado/);return{state:'accepted',messageId:'q48-committed-sms',status:'queued'};}}),'q48-before-sos');
  const result=await f.req('POST',`/v1/trips/${trip}/sos`,{}); assert.equal(result.body.id,incident);
  await dispatch.runJob(f.ctx,sms,provider({async send(){sends++;throw Error('must not resend');}}),'q48-after-sos');
  assert.equal(sends,1);
  const old=(await f.ctx.pool.query('SELECT payload FROM dispatch_attempts WHERE job_id=$1',[sms.jobId])).rows[0];
  assert.match(old.payload.text,/no confirmó su estado/);
  await dispatch.runJob(f.ctx,voice,provider({async send(payload){assert.match(payload.text,/ALERTA:.*pidió ayuda/);return{state:'unknown'};}}),'q48-pending-voice');
  assert.equal((await f.ctx.pool.query('SELECT count(*)::int n FROM jobs WHERE incident_id=$1',[incident])).rows[0].n,6);
});

for (const elapsed of [0, 1001, cfg.askGraceMs + 1]) {
  test(`opening after a trip-lock wait retains the full ask grace: ${elapsed}ms wait`, {timeout: 15000}, async t => {
    const f = await fixture(t); const trip = await f.trip(); f.advance(cfg.silenceMs + 1);
    const lock = await f.ctx.pool.connect(); let opening;
    try {
      await lock.query('BEGIN'); await lock.query('SELECT id FROM trips WHERE id=$1 FOR UPDATE', [trip]);
      opening = sweep(f); await blocked(f, 'SELECT * FROM trips WHERE id=$1 FOR UPDATE%'); f.advance(elapsed);
    } finally { await lock.query('ROLLBACK'); lock.release(); }
    await opening;
    const row = (await checks(f, trip))[0]; const remaining = row.ask_until.getTime() - f.ctx.clock().getTime();
    await sweep(f);
    t.diagnostic(JSON.stringify({elapsed,now:f.ctx.clock(),createdAt:row.created_at,askUntil:row.ask_until,remainingGraceMs:remaining,incidentCount:(await incidents(f, trip)).length}));
    assert.equal(remaining, cfg.askGraceMs, 'the response window must start when the check can actually open, after locks');
  });
}

test('native loopback HTTP exposes asking and unknown location without a fabricated safe state', async t => {
  const f = await fixture(t); const trip = await f.trip();
  const url = await f.app.listen({host: '127.0.0.1', port: 0}); f.advance(cfg.silenceMs + 1); await sweep(f);
  const response = await fetch(`${url}/v1/trips/${trip}/status`, {headers:{authorization:`Bearer ${f.driver}`}});
  assert.equal(response.status, 200); const status = await response.json();
  assert.equal(status.check.status, 'asking'); assert.equal(status.location.freshness, 'unavailable'); assert.equal(status.incident, null);
  assert.ok(!('safe' in status));
});

test('policy observation: late receipt of stale GPS resets silence; replaying that capture does not', async t => {
  const f=await fixture(t); const trip=await f.trip(); const start=f.ctx.clock().getTime();
  const upload=capturedAt=>f.req('POST',`/v1/trips/${trip}/locations`,{observations:[{capturedAt:new Date(capturedAt).toISOString(),latitude:-12,longitude:-77,accuracy:20}]});
  assert.equal((await upload(start)).status,200); f.advance(600000);
  assert.equal((await upload(start+1000)).status,200); const receipt=f.ctx.clock(); await sweep(f);
  const status=(await f.req('GET',`/v1/trips/${trip}/status`)).body;
  assert.equal(status.location.freshness,'stale'); assert.equal(status.location.ageMs,599000); assert.equal(status.check,null);
  t.diagnostic(JSON.stringify({policy:'GPS receipt vetoes silence although capture is stale; no driver OK',captureAgeMs:status.location.ageMs,receivedAt:receipt,check:status.check}));
  f.advance(cfg.silenceMs+1); assert.equal((await upload(start+1000)).status,200);
  assert.deepEqual((await f.ctx.pool.query('SELECT received_at FROM latest_locations WHERE trip_id=$1',[trip])).rows[0].received_at,receipt);
  await sweep(f); assert.equal((await checks(f,trip))[0].reason,'silence');
});

test('GPS does not veto independent arrival-overdue evaluation', async t => {
  const f=await fixture(t); const start=f.ctx.clock().getTime();
  const draft=await f.draft({expectedArrivalAt:new Date(start+30000).toISOString()});
  const trip=(await f.req('POST',`/v1/trip-drafts/${draft.body.id}/confirm`,{confirmed:true,contactGrantIds:[]})).body.id;
  f.advance(30000+cfg.arrivalGraceMs+1);
  assert.equal((await f.req('POST',`/v1/trips/${trip}/locations`,{observations:[{capturedAt:new Date(start+1000).toISOString(),latitude:-12,longitude:-77,accuracy:20}]})).status,200);
  await sweep(f,{...cfg,silenceMs:86400000});
  assert.equal((await checks(f,trip))[0].reason,'arrival_overdue');
});

test('policy observation: pause suppresses every automatic check indefinitely, with SOS still independent', async t => {
  const f=await fixture(t); const draft=await f.draft({expectedArrivalAt:f.ctx.clock().toISOString()});
  const trip=(await f.req('POST',`/v1/trip-drafts/${draft.body.id}/confirm`,{confirmed:true,contactGrantIds:[]})).body.id;
  assert.equal((await post(f,trip,'pause')).status,200); f.advance(7*86400000); await sweep(f);
  assert.equal((await checks(f,trip)).length,0); assert.equal((await incidents(f,trip)).length,0);
  const row=(await f.ctx.pool.query('SELECT paused,checkins_active FROM trips WHERE id=$1',[trip])).rows[0];
  assert.deepEqual(row,{paused:true,checkins_active:false});
  t.diagnostic(JSON.stringify({policy:'No bounded pause expiry or independent overdue while paused',elapsedMs:7*86400000,...row}));
  assert.equal((await f.req('POST',`/v1/trips/${trip}/sos`,{})).status,200);
});

test('SIGKILL during escalation rolls back; a fresh process restarts and repeated sweep does not duplicate', {timeout:20000}, async t => {
  const f = await fixture(t); const trip = await f.trip(await contacts(f));
  f.advance(cfg.silenceMs + 1); await sweep(f); f.advance(cfg.askGraceMs);
  const release = await holdMutation(f, 'incidents', 'INSERT');
  const spawn = () => fork(new URL('./helpers/check-sweep-worker.mjs', import.meta.url), [], {
    env:{...process.env,Q48_REVIEW_DATABASE:f.ctx.pool.options.connectionString,Q48_REVIEW_CLOCK:f.ctx.clock().toISOString()},
    stdio:['ignore','ignore','pipe','ipc']
  });
  let child = spawn();
  t.after(() => { if (child && child.exitCode === null) child.kill('SIGKILL'); });
  try {
    assert.equal((await once(child,'message'))[0].phase,'ready'); child.send('sweep');
    await blocked(f,'INSERT INTO incidents%'); const exited=once(child,'exit'); child.kill('SIGKILL'); await exited;
  } finally { await release(); }
  assert.equal((await incidents(f,trip)).length,0); assert.equal((await checks(f,trip))[0].status,'asking');
  child=spawn(); assert.equal((await once(child,'message'))[0].phase,'ready');
  child.send('sweep'); assert.equal((await once(child,'message'))[0].phase,'committed');
  child.send('sweep'); assert.equal((await once(child,'message'))[0].phase,'committed');
  const rows=await incidents(f,trip); assert.equal(rows.length,1); await fanout(f,rows[0].id);
  const exited=once(child,'exit'); child.send('close'); await exited;
});
