import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/runtime.mjs';

// Client reads are authenticated identity reads; no body can supply another owner.
test('client reads require a signed identity and return only the authenticated profile', async t => {
  const f = await fixture(t);
  for (const path of ['/v1/profile', '/v1/bootstrap', '/v1/trucks', '/v1/contacts', '/v1/trips']) {
    assert.equal((await f.app.inject({ method: 'GET', url: path })).statusCode, 401);
  }
  const profile = await f.req('GET', '/v1/profile');
  assert.deepEqual(profile.body, { id: f.me.id, phoneVerified: true, readAt: '2026-10-17T12:00:00.000Z' });
  const stranger = await f.req('GET', '/v1/profile', undefined, f.stranger);
  assert.equal(stranger.status, 200);
  assert.notEqual(stranger.body.id, f.me.id);
});

// readAt is the server clock after snapshot acquisition, never a client-derived value.
test('every read response carries the server as-of timestamp', async t => {
  const f = await fixture(t);
  for (const path of ['/v1/profile', '/v1/trucks', '/v1/contacts', '/v1/trips', '/v1/bootstrap']) {
    const response = await f.req('GET', path);
    assert.equal(response.status, 200);
    assert.equal(response.body.readAt, '2026-10-17T12:00:00.000Z', path);
  }
});

// Q43 FIX 5560657565: one response must be one snapshot, not five read-committed peeks.
test('readTransaction is a repeatable read-only snapshot', async t => {
  const f = await fixture(t);
  const { readTransaction } = await import('../dist/db.js');
  const isolation = await readTransaction(f.ctx.pool, async client =>
    (await client.query(`SELECT current_setting('transaction_isolation') AS level`)).rows[0].level);
  assert.equal(isolation, 'repeatable read');
  await readTransaction(f.ctx.pool, async client => {
    const before = (await client.query('SELECT count(*)::int AS n FROM trucks')).rows[0].n;
    // A concurrent committed write must not become visible mid-transaction.
    await f.ctx.pool.query(`INSERT INTO trucks VALUES (gen_random_uuid(), $1, 'concurrent')`, [f.me.id]);
    const after = (await client.query('SELECT count(*)::int AS n FROM trucks')).rows[0].n;
    assert.equal(after, before);
  });
  await assert.rejects(
    readTransaction(f.ctx.pool, client => client.query(`INSERT INTO trucks VALUES (gen_random_uuid(), $1, 'forbidden')`, [f.me.id])),
    /read-only/i);
});

// Ownership filters stop another driver's trucks appearing in the web bootstrap list.
test('truck list returns only owned trucks in stable bounded order', async t => {
  const f = await fixture(t);
  await f.req('POST', '/v1/trucks', { label: 'B truck' });
  await f.req('POST', '/v1/trucks', { label: 'A truck' });
  await f.req('POST', '/v1/trucks', { label: 'STRANGER truck' }, f.stranger);
  const response = await f.req('GET', '/v1/trucks');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.trucks.map(truck => truck.label), ['A truck', 'B truck']);
  assert.deepEqual(response.body.trucks.map(truck => Object.keys(truck).sort()), [['id', 'label'], ['id', 'label']]);
  const stranger = await f.req('GET', '/v1/trucks', undefined, f.stranger);
  assert.deepEqual(stranger.body.trucks.map(truck => truck.label), ['STRANGER truck']);
  await f.ctx.pool.query(`INSERT INTO trucks SELECT gen_random_uuid(), $1, 'bulk ' || g FROM generate_series(1, 101) g`, [f.me.id]);
  const capped = await f.req('GET', '/v1/trucks');
  assert.equal(capped.body.trucks.length, 100);
  assert.equal(capped.body.limit, 100);
  assert.equal(capped.body.hasMore, true);
});

// Standing contact state must remain truthful after acceptance and revocation.
test('standing contact list shows driver-owned pending, accepted and revoked states only', async t => {
  const f = await fixture(t);
  const pending = await f.req('POST', '/v1/contacts', { contactId: f.contactIdentity.id, phone: f.phoneFor('contact'), map: true, incident: false });
  assert.equal(pending.status, 200);
  const contact2 = await f.token('contact-2');
  const contact2Id = (await f.req('GET', '/v1/me', undefined, contact2)).body.id;
  const accepted = await f.req('POST', '/v1/contacts', { contactId: contact2Id, phone: f.phoneFor('contact-2'), map: false, incident: true });
  assert.equal(accepted.status, 200);
  assert.equal((await f.req('POST', `/v1/contacts/${accepted.body.id}/accept`, { map: false, incident: true }, contact2)).status, 200);
  assert.equal((await f.req('POST', `/v1/contacts/${accepted.body.id}/revoke`, {}, contact2)).status, 200);
  const strangerInvite = await f.req('POST', '/v1/contacts', { contactId: f.contactIdentity.id, phone: f.phoneFor('contact'), map: true, incident: true }, f.stranger);
  assert.equal(strangerInvite.status, 200);
  const response = await f.req('GET', '/v1/contacts');
  assert.equal(response.status, 200);
  assert.equal(response.body.contacts.length, 2);
  const byId = new Map(response.body.contacts.map(contact => [contact.id, contact]));
  const pendingRow = byId.get(pending.body.id);
  assert.equal(pendingRow.status, 'pending');
  assert.deepEqual(pendingRow.map, { requested: true, accepted: false });
  assert.deepEqual(pendingRow.incident, { requested: false, accepted: false });
  assert.equal(pendingRow.acceptedAt, null);
  assert.equal(pendingRow.revokedAt, null);
  assert.equal(pendingRow.revokedBy, null);
  const revokedRow = byId.get(accepted.body.id);
  assert.equal(revokedRow.status, 'revoked');
  assert.equal(revokedRow.contactId, contact2Id);
  assert.ok(!('phone' in revokedRow));
  assert.deepEqual(revokedRow.map, { requested: false, accepted: false });
  assert.deepEqual(revokedRow.incident, { requested: true, accepted: true });
  assert.ok(revokedRow.acceptedAt);
  assert.ok(revokedRow.revokedAt);
  assert.equal(revokedRow.revokedBy, 'contact');
  assert.ok(!response.body.contacts.some(contact => contact.id === strangerInvite.body.id));
});

// Active and recent lists expose the persisted trip summary without draft text or coordinates.
test('trip list returns active and recent owned trips without raw text or coordinates', async t => {
  const f = await fixture(t);
  const grant = await f.grant();
  const active = await f.trip([grant]);
  const closed = await f.trip([]);
  assert.equal((await f.req('POST', `/v1/trips/${closed}/commands`, { type: 'arrived' })).status, 200);
  const strangerDraft = await f.draft({}, f.stranger);
  assert.equal(strangerDraft.status, 200);
  const strangerTrip = await f.req('POST', `/v1/trip-drafts/${strangerDraft.body.id}/confirm`, { confirmed: true, contactGrantIds: [] }, f.stranger);
  assert.equal(strangerTrip.status, 200);
  const response = await f.req('GET', '/v1/trips');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.limits, { active: 50, recent: 20 });
  assert.deepEqual(response.body.hasMore, { active: false, recent: false });
  const activeTrip = response.body.active.find(trip => trip.id === active);
  const recentTrip = response.body.recent.find(trip => trip.id === closed);
  assert.ok(activeTrip);
  assert.ok(recentTrip);
  assert.equal(activeTrip.status, 'active');
  assert.equal(activeTrip.mapActive, true);
  assert.equal(activeTrip.checkinsActive, true);
  assert.equal(activeTrip.paused, false);
  assert.equal(activeTrip.origin, 'A');
  assert.equal(activeTrip.destination, 'B');
  assert.equal(activeTrip.country, 'BR');
  assert.equal(activeTrip.locale, 'pt-BR');
  assert.equal(activeTrip.timeZone, 'America/Sao_Paulo');
  assert.deepEqual(activeTrip.contactGrantIds, [grant]);
  assert.equal(recentTrip.status, 'arrived');
  assert.ok(recentTrip.closedAt);
  assert.ok(!response.body.active.some(trip => trip.id === strangerTrip.body.id));
  assert.ok(!response.body.recent.some(trip => trip.id === strangerTrip.body.id));
  for (const key of ['rawText', 'latitude', 'longitude', 'location', 'phone']) assert.ok(!(key in activeTrip));
});

// Bootstrap returns the same owner-scoped persisted records in one reload-safe read.
test('bootstrap bundles profile and owner lists with explicit bounds', async t => {
  const f = await fixture(t);
  const grant = await f.grant();
  const trip = await f.trip([grant]);
  const response = await f.req('GET', '/v1/bootstrap');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.profile, { id: f.me.id, phoneVerified: true });
  assert.equal(response.body.trucks.length, 1);
  assert.equal(response.body.contacts.length, 1);
  assert.equal(response.body.contacts[0].id, grant);
  assert.equal(response.body.trips.active.length, 1);
  assert.equal(response.body.trips.active[0].id, trip);
  assert.deepEqual(response.body.trips.active[0].contactGrantIds, [grant]);
  assert.deepEqual(response.body.limits, { trucks: 100, contacts: 100, activeTrips: 50, recentTrips: 20 });
  assert.deepEqual(response.body.hasMore, { trucks: false, contacts: false, activeTrips: false, recentTrips: false });
  const stranger = await f.req('GET', '/v1/bootstrap', undefined, f.stranger);
  assert.equal(stranger.status, 200);
  assert.notEqual(stranger.body.profile.id, f.me.id);
  assert.equal(stranger.body.trucks.length, 0);
  assert.equal(stranger.body.contacts.length, 0);
  assert.equal(stranger.body.trips.active.length, 0);
  assert.equal(stranger.body.trips.recent.length, 0);
});

test('catalog responses never disclose stored or token phones', async t => {
  const f = await fixture(t);
  await f.grant();
  const phones = (await f.ctx.pool.query('SELECT phone FROM identities UNION SELECT phone FROM contact_grants')).rows.map(r => r.phone);
  assert.ok(new Set(phones).size >= 2, 'fixture identities must have distinct phones');
  for (const jwt of [f.driver, f.contact, f.stranger]) {
    for (const path of ['/v1/profile', '/v1/bootstrap', '/v1/trucks', '/v1/contacts', '/v1/trips']) {
      const response = await f.req('GET', path, undefined, jwt);
      assert.equal(response.status, 200);
      const text = JSON.stringify(response.body);
      assert.ok(!text.includes('"phone":'), path);
      for (const phone of phones) assert.ok(!text.includes(phone), path);
    }
  }
});

test('profile verification belongs to this request despite a parallel identity update', async t => {
  const f = await fixture(t);
  // Simulate a second token updating the shared identity after this request authenticates.
  for (const pool of [f.ctx.pool, f.ctx.telemetryPool]) {
    const query = pool.query.bind(pool);
    pool.query = async (...args) => {
      const result = await query(...args);
      if (String(args[0]).includes('ON CONFLICT(issuer,subject)')) {
        await query('UPDATE identities SET phone=$2,phone_verified=false WHERE id=$1', [result.rows[0]?.id ?? f.me.id, '+15555550199']);
      }
      return result;
    };
  }
  for (const path of ['/v1/profile', '/v1/bootstrap']) {
    const response = await f.req('GET', path);
    assert.equal(response.status, 200);
    const profile = response.body.profile ?? response.body;
    assert.equal(profile.phoneVerified, true);
    assert.ok(!('phone' in profile));
  }
});

test('profile verification follows the current token while a stronger stored binding remains intact', async t => {
  const f = await fixture(t);
  const unverified = await f.token('driver', { phone_number_verified: false });
  for (const path of ['/v1/profile', '/v1/bootstrap']) {
    const current = await f.req('GET', path, undefined, unverified);
    assert.equal(current.status, 200);
    assert.equal((current.body.profile ?? current.body).phoneVerified, false);
    const verified = await f.req('GET', path);
    assert.equal(verified.status, 200);
    assert.equal((verified.body.profile ?? verified.body).phoneVerified, true);
  }
  assert.equal((await f.ctx.pool.query('SELECT phone_verified FROM identities WHERE id=$1', [f.me.id])).rows[0].phone_verified, true);
});

test('trip catalogs exclude per-trip and standing revoked grants', async t => {
  const f = await fixture(t);
  const grant = await f.grant();
  const trip = await f.trip([grant]);
  const otherTrip = await f.trip([grant]);
  assert.equal((await f.req('POST', `/v1/trips/${trip}/contacts/${grant}/revoke`, {})).status, 200);
  assert.equal((await f.req('GET', `/v1/trips/${trip}/snapshot`, undefined, f.contact)).status, 403);
  for (const path of ['/v1/trips', '/v1/bootstrap']) {
    const response = await f.req('GET', path);
    const trips = response.body.trips ?? response.body;
    assert.deepEqual(trips.active.find(row => row.id === trip).contactGrantIds, []);
    assert.deepEqual(trips.active.find(row => row.id === otherTrip).contactGrantIds, [grant]);
  }
  assert.equal((await f.req('GET', '/v1/contacts')).body.contacts[0].status, 'accepted');
  assert.equal((await f.req('POST', `/v1/contacts/${grant}/revoke`, {})).status, 200);
  assert.deepEqual((await f.req('GET', '/v1/trips')).body.active.find(row => row.id === otherTrip).contactGrantIds, []);
});

test('catalog authentication and queries never borrow SOS command connections', async t => {
  const f = await fixture(t);
  const connect = f.ctx.pool.connect;
  f.ctx.pool.connect = () => { throw new Error('command pool is reserved for mutations'); };
  try {
    for (const path of ['/v1/profile', '/v1/bootstrap', '/v1/trucks', '/v1/contacts', '/v1/trips']) {
      assert.equal((await f.req('GET', path)).status, 200, path);
    }
  } finally { f.ctx.pool.connect = connect; }
});

test('readAt is sampled after a queued read acquires its connection', async t => {
  const f = await fixture(t);
  for (const pool of [f.ctx.pool, f.ctx.telemetryPool]) {
    const connect = pool.connect.bind(pool);
    pool.connect = function (callback) {
      // pg.query's authentication borrow is callback-based; the transaction awaits connect().
      if (callback) return connect(callback);
      return (async () => {
        f.advance(1000);
        return connect();
      })();
    };
  }
  for (const path of ['/v1/profile', '/v1/trucks', '/v1/contacts', '/v1/trips', '/v1/bootstrap']) {
    const response = await f.req('GET', path);
    assert.equal(response.status, 200);
    assert.equal(response.body.readAt, f.ctx.clock().toISOString(), path);
  }
});

test('catalog timestamp pins the snapshot before concurrent committed writes', async t => {
  const f = await fixture(t);
  let write;
  let clockCalls = 0;
  for (const pool of [f.ctx.pool, f.ctx.telemetryPool]) {
    const connect = pool.connect.bind(pool);
    pool.connect = callback => callback ? connect(callback) : connect().then(client => {
      const query = client.query;
      const release = client.release;
      client.query = async function (...args) {
        if (write && String(args[0]).startsWith('SELECT') && !String(args[0]).includes('pg_current_snapshot')) await write;
        return query.apply(this, args);
      };
      client.release = function (...args) { client.query = query; client.release = release; return release.apply(this, args); };
      return client;
    });
  }
  f.ctx.clock = () => {
    // Current runtime samples the clock during auth too; interleave at the catalog's sample.
    if (++clockCalls > 1) write ??= f.ctx.pool.query(`INSERT INTO trucks VALUES(gen_random_uuid(), $1, 'after snapshot')`, [f.me.id]);
    return new Date('2026-10-17T12:00:00Z');
  };
  const response = await f.req('GET', '/v1/bootstrap');
  await write;
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.trucks, []);
  assert.equal((await f.req('GET', '/v1/trucks')).body.trucks[0].label, 'after snapshot');
});

test('an unavailable read pool does not prevent explicit SOS', async t => {
  const f = await fixture(t);
  const trip = await f.trip([await f.grant()]);
  const connect = f.ctx.telemetryPool.connect;
  f.ctx.telemetryPool.connect = () => { throw new Error('read pool exhausted'); };
  try {
    assert.equal((await f.req('POST', `/v1/trips/${trip}/sos`, {})).status, 200);
  } finally { f.ctx.telemetryPool.connect = connect; }
});

test('bounded trip projection agrees with owner detail and keeps unset runtime facts null', async t => {
  const f = await fixture(t);
  const trip = await f.trip();
  const detail = (await f.req('GET', `/v1/trips/${trip}`)).body;
  const summary = (await f.req('GET', '/v1/trips')).body.active[0];
  const mapping = { id: 'id', truckId: 'truck_id', origin: 'origin', destination: 'destination', country: 'country',
    locale: 'locale', timeZone: 'time_zone', status: 'status', mapActive: 'map_active', checkinsActive: 'checkins_active',
    paused: 'paused', version: 'version', createdAt: 'created_at', closedAt: 'closed_at',
    expectedArrivalAt: 'expected_arrival_at', sharingStoppedAt: 'sharing_stopped_at' };
  for (const [field, source] of Object.entries(mapping)) assert.equal(summary[field], detail[source] ?? null, field);
  assert.ok(!('driver_id' in summary));
  assert.ok(!('phone' in summary));
});

async function waitForQueue(pool, count) {
  const deadline = Date.now() + 2000;
  while (pool.waitingCount < count && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(pool.waitingCount >= count, `expected ${count} queued pool borrows, got ${pool.waitingCount}`);
}

async function within(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('independent pool request was blocked')), 1500); })]);
  } finally { clearTimeout(timer); }
}

test('real command pool exhaustion queues SOS but leaves catalog reads available', async t => {
  const f = await fixture(t);
  const trip = await f.trip([await f.grant()]);
  const held = await Promise.all(Array.from({ length: f.ctx.pool.options.max }, () => f.ctx.pool.connect()));
  let sos;
  let read;
  try {
    // Valid command control: this actual SOS must queue while every command connection is held.
    sos = f.req('POST', `/v1/trips/${trip}/sos`, {});
    await waitForQueue(f.ctx.pool, 1);
    read = f.req('GET', '/v1/bootstrap');
    const response = await within(read);
    assert.equal(response.status, 200);
    assert.equal(response.body.trips.active[0].id, trip);
    assert.equal(f.ctx.pool.waitingCount, 1, 'only the SOS is queued on command capacity');
  } finally {
    held.forEach(client => client.release());
    if (read) await read;
  }
  const response = await sos;
  assert.equal(response.status, 200, 'the queued valid SOS succeeds after capacity returns');
  assert.equal((await f.ctx.pool.query('SELECT count(*)::int AS n FROM incidents WHERE id=$1', [response.body.id])).rows[0].n, 1);
});

test('real read pool exhaustion queues bootstrap while explicit SOS persists successfully', async t => {
  const f = await fixture(t);
  const trip = await f.trip([await f.grant()]);
  const held = await Promise.all(Array.from({ length: f.ctx.telemetryPool.options.max }, () => f.ctx.telemetryPool.connect()));
  let control;
  let read;
  try {
    control = f.ctx.telemetryPool.query('SELECT 1 AS available');
    read = f.req('GET', '/v1/bootstrap');
    await waitForQueue(f.ctx.telemetryPool, 2);
    f.advance(1000);
    const sos = await within(f.req('POST', `/v1/trips/${trip}/sos`, {}));
    assert.equal(sos.status, 200);
    assert.equal((await f.ctx.pool.query('SELECT count(*)::int AS n FROM incidents WHERE id=$1', [sos.body.id])).rows[0].n, 1);
    assert.equal(f.ctx.telemetryPool.waitingCount, 2, 'both read controls remain queued while SOS completes');
  } finally {
    held.forEach(client => client.release());
    if (control) assert.equal((await control).rows[0].available, 1);
  }
  const response = await read;
  assert.equal(response.status, 200, 'bootstrap succeeds after actual read capacity returns');
  assert.equal(response.body.readAt, f.ctx.clock().toISOString(), 'queued response samples its acquired snapshot time');
});

test('actual demo sessions never disclose the configured live destination in catalogs', async t => {
  const { demoIssuer } = await import('../dist/demo.js');
  // A fictional stand-in exercises the real live-phone configuration path without sending anything.
  const livePhone = '+15555550123';
  const demo = await demoIssuer({ ZAVU_LIVE_SEND: 'true', DEMO_LIVE_PHONE: livePhone });
  const f = await fixture(t, { auth: demo.auth, demo });
  const session = await f.app.inject({ method: 'POST', url: '/v1/demo/session', payload: {} });
  assert.equal(session.statusCode, 200);
  const world = session.json();
  const stored = (await f.ctx.pool.query('SELECT phone FROM identities UNION SELECT phone FROM contact_grants')).rows.map(row => row.phone);
  assert.ok(stored.includes(livePhone), 'positive control: configured destination is actually stored');
  for (const persona of [world.driver, world.family, world.colleague]) {
    for (const path of ['/v1/profile', '/v1/bootstrap', '/v1/trucks', '/v1/contacts', '/v1/trips']) {
      const response = await f.req('GET', path, undefined, persona.token);
      assert.equal(response.status, 200, path);
      const body = JSON.stringify(response.body);
      assert.ok(!body.includes('"phone":'), path);
      for (const phone of stored) assert.ok(!body.includes(phone), path);
    }
  }
  const contacts = (await f.req('GET', '/v1/contacts', undefined, world.driver.token)).body.contacts;
  assert.deepEqual(contacts.map(row => row.role).sort(), ['colleague', 'family']);
  assert.equal((await f.ctx.pool.query('SELECT count(*)::int AS n FROM dispatch_attempts')).rows[0].n, 0);
});

test('catalog runtime roles and arrival or sharing facts follow the current mutation and status contracts', async t => {
  const f = await fixture(t);
  const grant = await f.grant();
  const expectedArrivalAt = '2026-10-17T18:00:00.000Z';
  const draft = await f.draft({ expectedArrivalAt });
  assert.equal(draft.status, 200);
  const confirmation = await f.req('POST', `/v1/trip-drafts/${draft.body.id}/confirm`, { confirmed: true, contactGrantIds: [grant] });
  assert.equal(confirmation.status, 200);
  const trip = confirmation.body.id;
  f.advance(1000);
  assert.equal((await f.req('POST', `/v1/trips/${trip}/sharing`, { state: 'stopped', reason: 'user' })).status, 200);
  for (const path of ['/v1/trips', '/v1/bootstrap']) {
    const response = await f.req('GET', path);
    assert.equal(response.status, 200);
    const row = (response.body.trips ?? response.body).active.find(row => row.id === trip);
    assert.equal(row.expectedArrivalAt, expectedArrivalAt);
    assert.equal(row.sharingStoppedAt, f.ctx.clock().toISOString());
    const detail = (await f.req('GET', `/v1/trips/${trip}`)).body;
    const status = (await f.req('GET', `/v1/trips/${trip}/status`)).body;
    assert.equal(row.expectedArrivalAt, detail.expected_arrival_at);
    assert.equal(row.sharingStoppedAt, detail.sharing_stopped_at);
    assert.equal(row.expectedArrivalAt, status.trip.expectedArrivalAt);
    assert.equal(row.status, status.trip.status);
  }
  assert.equal((await f.req('GET', '/v1/contacts')).body.contacts[0].role, 'family');
  assert.equal((await f.req('POST', `/v1/trips/${trip}/sharing`, { state: 'resumed', reason: 'user' })).status, 200);
  assert.equal((await f.req('GET', '/v1/trips')).body.active[0].sharingStoppedAt, null);
});

test('the shared SDK consumes the real phone-free catalog responses and runtime fields', async t => {
  const f = await fixture(t);
  await f.trip([await f.grant()]);
  const { MemorySession, createApiClient } = await import('../web/src/lib/api/index.ts');
  const session = new MemorySession();
  session.setCredentials({ issuer: 'https://synthetic.test', subject: 'driver', accessToken: f.driver, expiresAt: Date.now() + 3600000 });
  const api = createApiClient({ baseUrl: 'https://synthetic.test', session, fetch: async (url, options) => {
    const response = await f.app.inject({ method: options.method, url: url.pathname, headers: options.headers });
    assert.equal(response.statusCode, 200, 'valid signed backend control');
    assert.match(response.headers['content-type'], /application\/json/);
    return new Response(response.body, { status: response.statusCode, headers: response.headers });
  } });
  t.after(() => session.clear());
  for (const method of ['getProfile', 'getBootstrap', 'listTrucks', 'listContacts', 'listTrips']) {
    const response = await api[method]();
    assert.equal(response.readAt, f.ctx.clock().toISOString());
    assert.ok(!JSON.stringify(response).includes('"phone":'));
    if (method === 'getProfile') assert.deepEqual(response, { id: f.me.id, phoneVerified: true, readAt: response.readAt });
    if (method === 'listContacts') assert.equal(response.contacts[0].role, 'family');
    if (method === 'listTrips') {
      assert.equal(response.active[0].expectedArrivalAt, null);
      assert.equal(response.active[0].sharingStoppedAt, null);
    }
  }
});
