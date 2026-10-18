import assert from 'node:assert/strict';
import test from 'node:test';
import { MemorySession, createApiClient, createSessionGateway, decodeDriverResponse, decodeLocationSnapshot } from '../../src/lib/api/index.ts';

const id = '11111111-1111-4111-8111-111111111111';
const stamp = '2026-10-17T12:00:00.000Z';
const credentials = () => ({ issuer: 'https://identity.synthetic.invalid', subject: 'synthetic-owner',
  accessToken: 'synthetic-token', expiresAt: Date.now() + 60_000 });
function fixture(fetch, session = new MemorySession()) {
  session.setCredentials(credentials());
  return { session, api: createApiClient({ baseUrl: 'https://synthetic.invalid', session, fetch }) };
}

test('catalog 404 identifies a missing endpoint instead of an empty or absent resource', async t => {
  const f = fixture(async () => Response.json({ code: 'not_found' }, { status: 404 }));
  for (const method of ['getProfile', 'getBootstrap', 'listTrucks', 'listContacts', 'listTrips']) {
    await t.test(method, () => assert.rejects(f.api[method](), error => error.status === 404
      && error.kind === 'unsupported' && error.code === 'endpoint_unavailable' && error.outcome === 'not_applicable'));
  }
});

test('public feature decoders preserve valid source facts and reject contradictory wire facts', () => {
  const snapshot = { tripId: id, readAt: stamp, location: null, freshness: 'unavailable', ageMs: null };
  assert.deepEqual(decodeDriverResponse({ operation: 'readSnapshot' }, snapshot), snapshot);
  assert.deepEqual(decodeLocationSnapshot(snapshot), snapshot);
  assert.throws(() => decodeDriverResponse({ operation: 'readSnapshot' }, { ...snapshot, freshness: 'fresh' }),
    error => error.kind === 'invalid_response' && error.outcome === 'not_applicable');
  assert.throws(() => decodeDriverResponse({ operation: 'sos' }, { id }),
    error => error.kind === 'invalid_response' && error.outcome === 'unknown');
});

test('invalid read resources reject asynchronously with read outcome and no dispatch', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return Response.json({ id }); });
  let pending;
  assert.doesNotThrow(() => { pending = f.api.getTrip('../invalid'); });
  await assert.rejects(pending, error => error.kind === 'invalid_input'
    && error.operation === 'getTrip' && error.outcome === 'not_applicable');
  f.session.clear();
  await assert.rejects(f.api.getIdentity(), error => error.outcome === 'not_applicable');
  assert.equal(calls, 0);
});

test('definite server refusals survive caller cancellation while their body is being read', async t => {
  for (const status of [401, 409, 429]) await t.test(String(status), async () => {
    const controller = new AbortController();
    const f = fixture(async () => {
      const response = Response.json({ code: 'idempotency_conflict' }, { status });
      response.json = async () => { controller.abort(); return { code: 'idempotency_conflict' }; };
      return response;
    });
    await assert.rejects(f.api.reportSos(id, { idempotencyKey: 'original-sos-intent', signal: controller.signal }),
      error => error.status === status && error.outcome === 'rejected');
    assert.equal(f.session.snapshot().status, status === 401 ? 'anonymous' : 'authenticated');
    f.session.clear();
  });
});

test('contradictory freshness, source age and future snapshot timestamps fail closed', async t => {
  const location = { capturedAt: '2026-10-17T11:00:00.000Z', receivedAt: '2026-10-17T11:00:01.000Z',
    latitude: -12.1, longitude: -77.1, accuracy: 50 };
  const base = { tripId: id, readAt: stamp, location, ageMs: 3_600_000, freshness: 'stale' };
  const variants = [
    { ...base, freshness: 'fresh' },
    { ...base, ageMs: 0, freshness: 'fresh', location: { ...location, capturedAt: '2026-10-17T12:00:01.000Z' } },
    { ...base, ageMs: 300_000 },
    { ...base, location: { ...location, receivedAt: '2026-10-17T12:00:01.000Z' } },
  ];
  for (const [index, body] of variants.entries()) await t.test(String(index), async () => {
    const f = fixture(async () => Response.json(body));
    await assert.rejects(f.api.getSnapshot(id), error => error.kind === 'invalid_response');
  });
  const f = fixture(async () => Response.json(base));
  assert.deepEqual(await f.api.getSnapshot(id), base);
});

test('initial identity-verification 401 is an error and an explicit begin can recover', async () => {
  let deny = true;
  const session = new MemorySession();
  const api = createApiClient({ baseUrl: 'https://synthetic.invalid', session, fetch: async () => deny
    ? Response.json({ code: 'unauthorized' }, { status: 401 }) : Response.json({ id }) });
  const gateway = createSessionGateway({ api, session, mode: 'demo', acquire: async () => credentials() });
  try {
    await gateway.begin();
    assert.equal(gateway.getSnapshot().state, 'error');
    assert.equal(session.snapshot().status, 'anonymous');
    deny = false; await gateway.begin();
    assert.equal(gateway.getSnapshot().state, 'authenticated');
  } finally { gateway.dispose(); }
});

test('gateway verifies an already-installed session before publishing authenticated', async () => {
  let finish, reads = 0;
  const f = fixture(async () => { reads++; return new Promise(resolve => { finish = resolve; }); });
  const gateway = createSessionGateway({ ...f, mode: 'external' });
  try {
    assert.equal(gateway.getSnapshot().state, 'connecting');
    await new Promise(setImmediate);
    assert.equal(reads, 1); finish(Response.json({ id }));
    await new Promise(setImmediate);
    assert.equal(gateway.getSnapshot().state, 'authenticated');
  } finally { finish?.(Response.json({ id })); gateway.dispose(); }
});

test('a late gateway subscriber observes elapsed expiry even before browser timers resume', async () => {
  let now = 1000;
  const session = new MemorySession(() => now);
  const api = createApiClient({ baseUrl: 'https://synthetic.invalid', session, fetch: async () => Response.json({ id }) });
  const gateway = createSessionGateway({ session, api, mode: 'external', acquire: async () => ({
    ...credentials(), expiresAt: 2000,
  }) });
  let unsubscribe = () => {};
  try {
    await gateway.begin(); assert.equal(gateway.getSnapshot().state, 'authenticated');
    now = 2001;
    let notices = 0;
    unsubscribe = gateway.subscribe(() => { notices++; });
    assert.equal(gateway.getSnapshot().state, 'expired');
    assert.equal(notices, 1);
  } finally { unsubscribe(); gateway.dispose(); }
});

test('arrival inputs normalize before the server can commit and echo a differently formatted instant', async t => {
  for (const value of ['2026-10-18T10:00:00+0000', '2026-10-18t10:00:00z', '2026-10-18T15:00:00+05']) {
    await t.test(value, async () => {
      const sent = [];
      const fields = { truckId: id, origin: 'Synthetic origin', destination: 'Synthetic destination',
        country: 'BR', locale: 'pt-BR', timeZone: 'America/Sao_Paulo', expectedArrivalAt: value };
      const f = fixture(async (url, init) => {
        const body = JSON.parse(init.body); sent.push(body);
        return Response.json(url.pathname.endsWith('/confirm') ? { id, status: 'active', fields: body.fields }
          : { id, rawText: 'Synthetic draft', fields: body.fields, missingFields: [], status: 'draft' });
      });
      const key = { idempotencyKey: 'original-arrival-intent' };
      const draft = await f.api.createDraft({ text: 'Synthetic draft', fields }, key);
      const confirmed = await f.api.confirmTrip(id, { confirmed: true, contactGrantIds: [], fields }, key);
      for (const body of sent) assert.equal(body.fields.expectedArrivalAt, '2026-10-18T10:00:00.000Z');
      assert.equal(draft.fields.expectedArrivalAt, '2026-10-18T10:00:00.000Z');
      assert.equal(confirmed.fields.expectedArrivalAt, '2026-10-18T10:00:00.000Z');
      assert.equal(fields.expectedArrivalAt, value); // Do not mutate the caller's captured intent.
    });
  }
  let calls = 0;
  const f = fixture(async () => { calls++; return Response.json({}); });
  await assert.rejects(f.api.createDraft({ text: 'Synthetic draft', fields: { expectedArrivalAt: '2026-10-18T10:00' } },
    { idempotencyKey: 'invalid-arrival-intent' }), error => error.kind === 'invalid_input' && error.outcome === 'not_sent');
  assert.equal(calls, 0);
});

test('impossible calendar dates and hour 24 are rejected instead of rolling forward', async t => {
  let calls = 0;
  const f = fixture(async () => { calls++; return Response.json({}); });
  for (const value of ['2027-02-29T10:00:00-05:00', '2026-02-30T10:00:00Z', '2026-04-31T10:00:00Z',
    '2026-10-18T24:00:00Z', '2026-13-01T10:00:00Z', '2026-10-00T10:00:00Z']) {
    await t.test(value, async () => {
      await assert.rejects(f.api.createDraft({ text: 'Synthetic draft', fields: { expectedArrivalAt: value } },
        { idempotencyKey: 'impossible-arrival-intent' }), error => error.kind === 'invalid_input' && error.outcome === 'not_sent');
      assert.throws(() => decodeDriverResponse({ operation: 'readSnapshot' },
        { tripId: id, readAt: value, location: null, freshness: 'unavailable', ageMs: null }),
      error => error.kind === 'invalid_response');
    });
  }
  assert.equal(calls, 0);
  const sent = [];
  const ok = fixture(async (url, init) => { const body = JSON.parse(init.body); sent.push(body);
    return Response.json({ id, rawText: 'Synthetic draft', fields: body.fields, missingFields: [], status: 'draft' }); });
  await ok.api.createDraft({ text: 'Synthetic draft', fields: { expectedArrivalAt: '2028-02-29T10:00:00-05:00' } },
    { idempotencyKey: 'leap-day-intent' });
  assert.equal(sent[0].fields.expectedArrivalAt, '2028-02-29T15:00:00.000Z'); // A real leap day still converts.
});
