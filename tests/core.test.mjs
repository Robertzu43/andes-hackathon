import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { generateKeyPair, SignJWT } from 'jose';
import { fixture } from './helpers/runtime.mjs';

// Removing signature validation or trusting a body owner would make these requests succeed.
test('signed identity enforces issuer, audience, expiry, signature and driver/truck ownership', async t => {
  const f = await fixture(t);
  assert.equal((await f.app.inject({ method: 'GET', url: '/v1/me' })).statusCode, 401);
  for (const claims of [{ iss: 'https://wrong.test' }, { aud: 'wrong' }, { exp: 1 }]) {
    assert.equal((await f.req('GET', '/v1/me', undefined, await f.token('attacker', claims))).status, 401);
  }
  const foreignKey = await generateKeyPair('RS256');
  const forged = await new SignJWT({}).setProtectedHeader({ alg: 'RS256' }).setIssuer('https://synthetic.test').setAudience('andes-test').setSubject('driver').setExpirationTime('1h').sign(foreignKey.privateKey);
  assert.equal((await f.req('GET', '/v1/me', undefined, forged)).status, 401);
  const trip = await f.trip();
  assert.equal((await f.req('GET', `/v1/trips/${trip}`, undefined, f.stranger)).status, 403);
  assert.equal((await f.req('POST', `/v1/trips/${trip}/sos`, {}, f.stranger)).status, 403);
  const ownedTruck = await f.truck();
  assert.equal((await f.draft({ truckId: ownedTruck }, f.stranger)).status, 403);
  assert.equal((await f.req('POST', '/v1/trucks', { label: 'A', ownerId: f.me.id })).status, 400);
});

// Allowing driver self-acceptance or unverified destination binding would leak maps/messages.
test('contacts accept their own explicit scopes with a trusted verified phone before selection', async t => {
  const f = await fixture(t); const grant = await f.grant(false);
  assert.equal((await f.req('POST', `/v1/contacts/${grant}/accept`, { map: true, incident: true })).status, 403);
  const unverified = await f.token('contact', { phone_number_verified: false });
  assert.equal((await f.req('POST', `/v1/contacts/${grant}/accept`, { map: true, incident: true }, unverified)).status, 409);
  const wrongPhone = await f.token('contact', { phone_number: '+15555550111' });
  assert.equal((await f.req('POST', `/v1/contacts/${grant}/accept`, { map: true, incident: true }, wrongPhone)).status, 409);
  const d = await f.draft();
  assert.equal((await f.req('POST', `/v1/trip-drafts/${d.body.id}/confirm`, { confirmed: true, contactGrantIds: [grant] })).status, 409);
  assert.equal((await f.req('POST', `/v1/contacts/${grant}/accept`, { map: true, incident: true }, f.contact)).status, 200);
  const trip = await f.trip([grant]);
  assert.equal((await f.req('GET', `/v1/trips/${trip}/snapshot`, undefined, f.contact)).status, 200);
});

// Activating raw text, ignoring missing fields or losing request identity would create unintended trips.
test('draft review and confirmation are explicit, complete and idempotent', async t => {
  const f = await fixture(t);
  const audio = await f.req('POST', '/v1/trip-drafts', { audio: 'unselected-provider' }); assert.equal(audio.status, 422);
  assert.equal(audio.body.code, 'unsupported_audio');
  const missing = await f.req('POST', '/v1/trip-drafts', { text: 'go somewhere', fields: {} }); assert.equal(missing.status, 200);
  assert.ok(missing.body.missingFields.includes('truckId'));
  assert.equal((await f.req('POST', `/v1/trip-drafts/${missing.body.id}/confirm`, { confirmed: true, contactGrantIds: [] })).status, 409);
  const d = await f.draft(); const path = `/v1/trip-drafts/${d.body.id}/confirm`; const key = randomUUID();
  assert.equal((await f.req('POST', path, { confirmed: false, contactGrantIds: [] })).status, 400);
  const first = await f.req('POST', path, { confirmed: true, contactGrantIds: [] }, f.driver, key);
  assert.equal(first.status, 200);
  assert.deepEqual(await f.req('POST', path, { contactGrantIds: [], confirmed: true }, f.driver, key), first);
  assert.equal((await f.req('POST', path, { confirmed: true, contactGrantIds: [randomUUID()] }, f.driver, key)).status, 409);
  assert.equal((await f.ctx.pool.query('SELECT count(*) FROM trips')).rows[0].count, '1');
});

// A late batch must not overwrite fresh observations, and revoke must deny subsequent reads.
test('location separates capture/receipt/read freshness, bounds history and honors revocation', async t => {
  const f = await fixture(t); const grant = await f.grant(); const trip = await f.trip([grant]); const path = `/v1/trips/${trip}/locations`;
  const sample = (capturedAt, latitude = -23) => ({ capturedAt, latitude, longitude: -46, accuracy: 12 });
  assert.equal((await f.req('POST', path, { observations: [sample('2026-10-17T12:00:00Z')] })).status, 200);
  assert.equal((await f.req('POST', path, { observations: [sample('2026-10-17T11:59:00Z', -24)] })).status, 200);
  let snapshot = (await f.req('GET', `/v1/trips/${trip}/snapshot`, undefined, f.contact)).body;
  assert.equal(snapshot.location.latitude, -23); assert.equal(snapshot.freshness, 'fresh');
  assert.equal(snapshot.location.receivedAt, '2026-10-17T12:00:00.000Z');
  f.advance(121000); snapshot = (await f.req('GET', `/v1/trips/${trip}/snapshot`, undefined, f.contact)).body;
  assert.equal(snapshot.freshness, 'stale'); assert.equal(snapshot.ageMs, 121000);
  assert.equal((await f.req('POST', path, { observations: Array(101).fill(sample('2026-10-17T12:00:00Z')) })).status, 400);
  assert.equal((await f.req('POST', path, { observations: [sample('2026-10-17T13:00:00Z')] })).status, 400);
  for (let batch = 0; batch < 6; batch++) {
    assert.equal((await f.req('POST', path, { observations: Array.from({ length: 100 }, (_, i) => sample(new Date(Date.parse('2026-10-17T11:40:00Z') + (batch * 100 + i) * 1000).toISOString())) })).status, 200);
  }
  assert.equal((await f.ctx.pool.query('SELECT count(*) FROM locations WHERE trip_id=$1', [trip])).rows[0].count, '500');
  assert.equal((await f.req('POST', `/v1/trips/${trip}/contacts/${grant}/revoke`, {}, f.contact)).status, 200);
  assert.equal((await f.req('GET', `/v1/trips/${trip}/snapshot`, undefined, f.contact)).status, 403);
});

// Removing the SOS transaction or active unique episode permits partial/duplicate alerts.
test('SOS rolls back all state on SQL failure and simultaneous taps create one incident and independent jobs', async t => {
  const f = await fixture(t); const grant = await f.grant(); const trip = await f.trip([grant]);
  await f.ctx.pool.query("CREATE FUNCTION fail_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic outbox failure'; END $$");
  await f.ctx.pool.query('CREATE TRIGGER synthetic_failure BEFORE INSERT ON outbox FOR EACH ROW EXECUTE FUNCTION fail_outbox()');
  assert.equal((await f.req('POST', `/v1/trips/${trip}/sos`, {})).status, 500);
  assert.equal((await f.ctx.pool.query('SELECT count(*) FROM incidents')).rows[0].count, '0');
  assert.equal((await f.ctx.pool.query('SELECT count(*) FROM jobs')).rows[0].count, '0');
  await f.ctx.pool.query('DROP TRIGGER synthetic_failure ON outbox');
  const requests = await Promise.all(Array.from({ length: 6 }, () => f.req('POST', `/v1/trips/${trip}/sos`, {})));
  assert.ok(requests.every(r => r.status === 200)); assert.equal(new Set(requests.map(r => r.body.id)).size, 1);
  const jobs = (await f.ctx.pool.query('SELECT channel,status FROM jobs ORDER BY channel')).rows;
  assert.deepEqual(jobs, [{ channel: 'group', status: 'unavailable' }, { channel: 'sms', status: 'pending' }, { channel: 'voice', status: 'pending' }, { channel: 'whatsapp', status: 'pending' }]);
  assert.equal((await f.ctx.pool.query('SELECT count(*) FROM outbox')).rows[0].count, '3');
});

// Arrival, OK and contact acknowledgement must never silently resolve a security emergency.
test('trip and incident closure are independent; contact receipt/action are attributed and revoke cancels work', async t => {
  const f = await fixture(t); const grant = await f.grant(); const trip = await f.trip([grant]);
  const incident = (await f.req('POST', `/v1/trips/${trip}/sos`, {})).body.id;
  for (const status of ['pending', 'claimed', 'authorized']) await f.ctx.pool.query("INSERT INTO jobs(id,trip_id,grant_id,recipient_id,channel,class,status,created_at,due_at) VALUES($1,$2,$3,$4,'sms','ordinary',$5,$6,$6)", [randomUUID(), trip, grant, f.contactIdentity.id, status, f.ctx.clock()]);
  assert.equal((await f.req('POST', `/v1/incidents/${incident}/acknowledgements`, {}, f.contact)).status, 200);
  assert.equal((await f.req('POST', `/v1/incidents/${incident}/actions`, { action: 'called trusted support' }, f.contact)).status, 200);
  assert.equal((await f.req('POST', `/v1/incidents/${incident}/resolve`, {}, f.contact)).status, 403);
  assert.equal((await f.req('POST', `/v1/trips/${trip}/commands`, { type: 'checkin_ok' })).status, 200);
  assert.equal((await f.req('POST', `/v1/trips/${trip}/commands`, { type: 'arrived' })).status, 200);
  const row = (await f.ctx.pool.query('SELECT status FROM incidents WHERE id=$1', [incident])).rows[0]; assert.equal(row.status, 'active');
  assert.equal((await f.ctx.pool.query("SELECT count(*) FROM jobs WHERE status='pending'")).rows[0].count, '3');
  assert.equal((await f.ctx.pool.query("SELECT count(*) FROM jobs WHERE class='ordinary' AND status='cancelled'")).rows[0].count, '2');
  assert.equal((await f.ctx.pool.query("SELECT count(*) FROM jobs WHERE class='ordinary' AND status='authorized'")).rows[0].count, '1');
  assert.equal((await f.req('GET', `/v1/trips/${trip}/snapshot`, undefined, f.contact)).status, 403);
  assert.equal((await f.req('POST', `/v1/trips/${trip}/locations`, { observations: [{ capturedAt: '2026-10-17T12:00:00Z', latitude: 0, longitude: 0, accuracy: 5 }] })).status, 409);
  assert.equal((await f.req('POST', `/v1/trips/${trip}/contacts/${grant}/revoke`, {})).status, 200);
  assert.equal((await f.ctx.pool.query("SELECT count(*) FROM jobs WHERE class='emergency' AND status='cancelled'")).rows[0].count, '3');
  assert.equal((await f.req('POST', `/v1/incidents/${incident}/resolve`, {})).status, 200);
  const next = await f.req('POST', `/v1/trips/${trip}/sos`, {}); assert.equal(next.status, 200); assert.notEqual(next.body.id, incident);
});

// Omitting fail-closed defaults, scope checks or boundary validation would create unqualified jobs/read access.
test('unqualified channels stay unavailable and accepted incident scope never grants map access', async t => {
  const f = await fixture(t, { channelSupport: [] });
  const invitation = await f.req('POST', '/v1/contacts', { contactId: f.contactIdentity.id, phone: f.phoneFor('contact'), map: false, incident: true });
  assert.equal((await f.req('POST', `/v1/contacts/${invitation.body.id}/accept`, { map: true, incident: true }, f.contact)).status, 400);
  assert.equal((await f.req('POST', `/v1/contacts/${invitation.body.id}/accept`, { map: false, incident: true }, f.contact)).status, 200);
  const trip = await f.trip([invitation.body.id]);
  assert.equal((await f.req('GET', `/v1/trips/${trip}/snapshot`, undefined, f.contact)).status, 403);
  const key = randomUUID(); const first = await f.req('POST', `/v1/trips/${trip}/sos`, {}, f.driver, key);
  assert.deepEqual(await f.req('POST', `/v1/trips/${trip}/sos`, {}, f.driver, key), first);
  assert.equal((await f.ctx.pool.query("SELECT count(*) FROM jobs WHERE status='unavailable'")).rows[0].count, '4');
  assert.equal((await f.ctx.pool.query('SELECT count(*) FROM outbox')).rows[0].count, '0');
  const response = await f.app.inject({ method: 'POST', url: `/v1/trips/${trip}/commands`, headers: { authorization: `Bearer ${f.driver}` }, payload: { type: 'arrived' } });
  assert.equal(response.statusCode, 400);
  assert.equal((await f.req('GET', `/v1/trips/${trip}`)).body.status, 'active');
});

// Dropping repeat-safe migrations or the SQL callback rollback would leave partial state.
test('migration is repeat-safe and transaction failures release clients without committing', async t => {
  const f = await fixture(t); const { migrate, withTripTransaction } = await import('../dist/db.js');
  await migrate(f.ctx.pool); const trip = await f.trip();
  await assert.rejects(withTripTransaction(f.ctx, trip, async client => { await client.query("UPDATE trips SET map_active=false WHERE id=$1", [trip]); throw new Error('synthetic SQL-only failure'); }), /synthetic SQL-only failure/);
  assert.equal((await f.req('GET', `/v1/trips/${trip}`)).body.map_active, true);
  assert.equal((await f.app.inject({ method: 'GET', url: '/health' })).statusCode, 200);
  const { createApp } = await import('../dist/api/app.js');
  assert.throws(() => createApp({ ctx: f.ctx, auth: {} }), /Trusted OIDC/);
  assert.throws(() => createApp({ ctx: f.ctx, auth: { issuer: 'x', audience: 'x', jwksUrl: 'http://unsafe.test/jwks' } }), /HTTPS/);
});

// schema_migrations keys the filename stem. Numeric prefixes must be unique and strictly increasing so a later runner cannot skip one of two files that share a number.
test('migration numbers are unique and strictly increasing, and each file applies once', async t => {
  const f = await fixture(t); const { migrate } = await import('../dist/db.js');
  const { readdirSync } = await import('node:fs');
  const files = readdirSync(new URL('../db/migrations/', import.meta.url)).filter(name => /^\d{3}-[a-z-]+\.sql$/.test(name)).sort().map(name => name.slice(0, -4));
  const numbers = files.map(name => Number(name.slice(0, 3)));
  assert.equal(new Set(numbers).size, numbers.length, `migration numbers must be unique: ${files.join(' ')}`);
  for (let i = 1; i < numbers.length; i++) assert.ok(numbers[i] > numbers[i - 1], `${files[i - 1]} then ${files[i]}`);
  const applied = async () => (await f.ctx.pool.query('SELECT version FROM schema_migrations ORDER BY version')).rows.map(row => row.version);
  assert.deepEqual(await applied(), files);
  await migrate(f.ctx.pool);
  assert.deepEqual(await applied(), files, 'a second run applies nothing');
  const columns = (await f.ctx.pool.query(`SELECT table_name||'.'||column_name AS c FROM information_schema.columns WHERE table_schema=current_schema()
    AND (table_name,column_name) IN (('jobs','retry_count'),('identities','synthetic'),('jobs','trigger'),('identities','last_seen_at')) ORDER BY 1`)).rows.map(row => row.c);
  assert.deepEqual(columns, ['identities.last_seen_at', 'identities.synthetic', 'jobs.retry_count', 'jobs.trigger']);
  assert.equal((await f.ctx.pool.query("SELECT count(*)::int n FROM pg_constraint WHERE conname='dispatch_attempts_job_version_key' AND connamespace=current_schema()::regnamespace")).rows[0].n, 1);
  // 006-insights-provenance was renamed to 010. Its SQL is not idempotent, so a database that already recorded the old stem must not run it again.
  const current = '010-insights-provenance', legacy = '006-insights-provenance';
  assert.ok(files.includes(current) && !files.includes(legacy));
  await f.ctx.pool.query('UPDATE schema_migrations SET version=$1 WHERE version=$2', [legacy, current]);
  await migrate(f.ctx.pool);
  assert.deepEqual(await applied(), files, 'the old stem is recognized and the SQL is not applied again');
  await f.ctx.pool.query('UPDATE schema_migrations SET version=$1, hash=$2 WHERE version=$3', [legacy, 'not-the-file-hash', current]);
  await assert.rejects(migrate(f.ctx.pool), /Applied migration changed/);
});

// Resolving an SOS must not close an otherwise active trip or silently disable its map.
test('driver incident resolution preserves active trip and authorized attempts', async t => {
  const f = await fixture(t); const grant = await f.grant(); const trip = await f.trip([grant]);
  const incident = (await f.req('POST', `/v1/trips/${trip}/sos`, {})).body.id;
  await f.ctx.pool.query("UPDATE jobs SET status='authorized' WHERE incident_id=$1 AND channel='sms'", [incident]);
  assert.equal((await f.req('POST', `/v1/incidents/${incident}/resolve`, {})).status, 200);
  assert.equal((await f.req('GET', `/v1/trips/${trip}`)).body.status, 'active');
  assert.equal((await f.req('GET', `/v1/trips/${trip}/snapshot`, undefined, f.contact)).status, 200);
  assert.equal((await f.ctx.pool.query("SELECT status FROM jobs WHERE incident_id=$1 AND channel='sms'", [incident])).rows[0].status, 'authorized');
  assert.equal((await f.ctx.pool.query("SELECT count(*) FROM jobs WHERE incident_id=$1 AND status='cancelled'", [incident])).rows[0].count, '2');
});

// Revoking standing consent must block concurrent/future confirmation as well as every existing trip.
test('standing contact revoke serializes with confirmation and blocks every current/future trip grant', async t => {
  const f = await fixture(t); const grant = await f.grant(); const active = await f.trip([grant]); const draft = await f.draft();
  const race = await Promise.all([
    f.req('POST', `/v1/trip-drafts/${draft.body.id}/confirm`, { confirmed: true, contactGrantIds: [grant] }),
    f.req('POST', `/v1/contacts/${grant}/revoke`, {}, f.contact)
  ]);
  assert.equal(race[1].status, 200);
  assert.ok([200, 409].includes(race[0].status));
  assert.equal((await f.req('GET', `/v1/trips/${active}/snapshot`, undefined, f.contact)).status, 403);
  if (race[0].status === 200) assert.equal((await f.req('GET', `/v1/trips/${draft.body.id}/snapshot`, undefined, f.contact)).status, 403);
  const next = await f.draft();
  assert.equal((await f.req('POST', `/v1/trip-drafts/${next.body.id}/confirm`, { confirmed: true, contactGrantIds: [grant] })).status, 409);
  await f.req('POST', `/v1/trips/${active}/sos`, {});
  assert.equal((await f.ctx.pool.query("SELECT count(*) FROM jobs WHERE recipient_id=$1", [f.contactIdentity.id])).rows[0].count, '0');
});

// A standing grant's row lock must permit the implicit FK KEY SHARE taken while SOS holds its trip.
test('SOS and standing revoke complete when grant lock overlaps the SOS foreign-key insert', async t => {
  const f = await fixture(t); const { waitForBlockedQueries } = await import('./helpers/db-barriers.mjs');
  const grant = await f.grant(); const trip = await f.trip([grant]);
  const barrierKey = Math.floor(Math.random() * 1000000000);
  await f.ctx.pool.query(`CREATE FUNCTION hold_incident() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(${barrierKey}); RETURN NEW; END $$`);
  await f.ctx.pool.query('CREATE TRIGGER incident_barrier BEFORE INSERT ON incidents FOR EACH ROW EXECUTE FUNCTION hold_incident()');
  const barrier = await f.ctx.pool.connect();
  let sos; let revoke;
  try {
    await barrier.query('SELECT pg_advisory_lock($1)', [barrierKey]);
    sos = f.req('POST', `/v1/trips/${trip}/sos`, {});
    await waitForBlockedQueries(f.ctx.pool, 'INSERT INTO incidents%', 1);
    revoke = f.req('POST', `/v1/contacts/${grant}/revoke`, {}, f.contact);
    await waitForBlockedQueries(f.ctx.pool, 'SELECT t.id FROM trips t JOIN trip_grants%', 1);
  } finally {
    await barrier.query('SELECT pg_advisory_unlock($1)', [barrierKey]); barrier.release();
  }
  const outcomes = await Promise.all([sos, revoke]);
  assert.deepEqual(outcomes.map(result => result.status), [200, 200]);
  assert.equal((await f.ctx.pool.query("SELECT count(*) FROM jobs WHERE recipient_id=$1 AND status='cancelled'", [f.contactIdentity.id])).rows[0].count, '3');
  assert.equal((await f.req('GET', `/v1/trips/${trip}/snapshot`, undefined, f.contact)).status, 403);
});

// Sorting raw UUID spellings can take A→B in one request and B→A in another.
test('mixed-case grant UUID confirmations take one canonical lock order and reject case-alias duplicates', async t => {
  const f = await fixture(t); const { waitForBlockedQueries } = await import('./helpers/db-barriers.mjs');
  const grantA = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'; const grantB = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
  const initialA = await f.grant(); await f.ctx.pool.query('UPDATE contact_grants SET id=$1 WHERE id=$2', [grantA, initialA]);
  const contact2 = await f.token('contact-2'); const identity2 = (await f.req('GET', '/v1/me', undefined, contact2)).body.id;
  const invitedB = await f.req('POST', '/v1/contacts', { contactId: identity2, phone: f.phoneFor('contact-2'), map: true, incident: true });
  assert.equal((await f.req('POST', `/v1/contacts/${invitedB.body.id}/accept`, { map: true, incident: true }, contact2)).status, 200);
  await f.ctx.pool.query('UPDATE contact_grants SET id=$1 WHERE id=$2', [grantB, invitedB.body.id]);
  const draft1 = await f.draft(); const draft2 = await f.draft();
  const blocker = await f.ctx.pool.connect(); let mixed; let lower;
  try {
    await blocker.query('BEGIN'); await blocker.query('SELECT id FROM contact_grants WHERE id=$1 FOR UPDATE', [grantB]);
    mixed = f.req('POST', `/v1/trip-drafts/${draft1.body.id}/confirm`, { confirmed: true, contactGrantIds: [grantA, grantB.toUpperCase()] });
    await waitForBlockedQueries(f.ctx.pool, 'SELECT * FROM contact_grants WHERE id=$1 AND driver_id=$2%', 1);
    lower = f.req('POST', `/v1/trip-drafts/${draft2.body.id}/confirm`, { confirmed: true, contactGrantIds: [grantA, grantB] });
    await waitForBlockedQueries(f.ctx.pool, 'SELECT * FROM contact_grants WHERE id=$1 AND driver_id=$2%', 2);
  } finally { await blocker.query('ROLLBACK'); blocker.release(); }
  const outcomes = await Promise.all([mixed, lower]);
  assert.deepEqual(outcomes.map(result => result.status), [200, 200]);
  const duplicate = await f.draft();
  assert.equal((await f.req('POST', `/v1/trip-drafts/${duplicate.body.id}/confirm`, { confirmed: true, contactGrantIds: [grantA, grantA.toUpperCase()] })).status, 400);
});
