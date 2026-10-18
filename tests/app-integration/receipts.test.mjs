import test from 'node:test';
import assert from 'node:assert/strict';
import {adapt, BACKEND_SHA, recorder, routeFor} from '../../scripts/app-integration/receipts.mjs';

const metadata = {kind: 'synthetic-control', backendSha: BACKEND_SHA, externalSends: false,
  isolatedDatabase: true, producer: 'synthetic-unit-control', command: 'node --test'};
const trip = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
function exchange(overrides = {}) {
  return {method: 'POST', path: `/v1/trip-drafts/${trip}/confirm`, actor: 'driver',
    request: {confirmed: true, fields: {truckId: other, origin: 'private origin', destination: 'private destination'}},
    status: 200, response: {id: trip, status: 'active'}, key: 'private-key', ...overrides};
}

test('receipt capture aliases equality consistently and drops auth, phone, coordinates and raw text', () => {
  const r = recorder(metadata);
  for (let index = 0; index < 3; index++) r.record(exchange({
    request: {confirmed: true, fields: {truckId: other, origin: 'private origin'}, phone: 'private phone', text: 'private text', authorization: 'private bearer'},
    response: {id: trip, status: 'active', location: {capturedAt: '2026-10-17T12:00:00Z', receivedAt: '2026-10-17T12:01:00Z', latitude: 42, longitude: 87}, token: 'private token'},
    bindings: [['duplicate-confirm', index]], key: index < 2 ? 'private-key' : 'different-key',
  }));
  const raw = r.raw(), normalized = adapt(raw);
  const steps = normalized.cases[0].steps;
  assert.equal(normalized.kind, 'synthetic-control'); // Unit fixtures cannot be upgraded.
  assert.equal(steps[0].response.id, steps[1].response.id);
  assert.equal(steps[0].keyAlias, steps[1].keyAlias);
  assert.notEqual(steps[0].keyAlias, steps[2].keyAlias);
  assert.notEqual(steps[0].response.id, steps[0].request.fields.truckId);
  const json = JSON.stringify(raw);
  for (const privateValue of ['private', 'latitude', 'longitude', trip, other]) assert.ok(!json.includes(privateValue));
});

test('source, server receipt and read timestamps survive unchanged rather than being re-timed', () => {
  const r = recorder(metadata);
  const location = {capturedAt: '2026-10-17T12:00:00.000Z', receivedAt: '2026-10-17T12:00:10.000Z'};
  const readAt = ['2026-10-17T12:00:20.000Z', '2026-10-17T12:02:01.000Z'];
  for (let i = 0; i < 2; i++) r.record(exchange({method: 'GET', path: `/v1/trips/${trip}/snapshot`, actor: 'contact',
    response: {tripId: trip, location, readAt: readAt[i], ageMs: i === 0 ? 20000 : 121000, freshness: i === 0 ? 'fresh' : 'stale'},
    bindings: [['stale-snapshot', i]]}));
  const steps = adapt(r.raw()).cases[0].steps;
  assert.deepEqual(steps.map(s => s.response.location), [location, location]);
  assert.deepEqual(steps.map(s => s.response.readAt), readAt);
  assert.equal(steps[1].response.ageMs, 121000);
});

test('missing and partial cases remain absent, never supplied from synthetic examples', () => {
  const r = recorder(metadata);
  assert.deepEqual(adapt(r.raw()).cases, []);
  r.record(exchange({bindings: [['duplicate-confirm', 0]]}));
  assert.deepEqual(adapt(r.raw()).cases, []);
});

test('failed actual HTTP outcome remains a failed observation for the independent checker', () => {
  const r = recorder(metadata);
  r.record(exchange({method: 'GET', path: `/v1/trips/${trip}/snapshot`, actor: 'contact',
    status: 500, response: {code: 'internal_error'}, bindings: [['unavailable-snapshot', 0]]}));
  const step = adapt(r.raw()).cases[0].steps[0];
  assert.equal(step.status, 500); assert.equal(step.response.code, 'internal_error');
});

test('duplicate bindings and reordered cases are rejected rather than overwritten or sorted into a pass', () => {
  const r = recorder(metadata);
  r.record(exchange({bindings: [['duplicate-confirm', 0]]}));
  r.record(exchange({bindings: [['duplicate-confirm', 0]]}));
  assert.throws(() => adapt(r.raw()), /duplicate/);
  const reordered = recorder(metadata);
  for (const index of [1, 0, 2]) reordered.record(exchange({bindings: [['duplicate-confirm', index]]}));
  assert.throws(() => adapt(reordered.raw()), /order/);
});

test('actual route normalization rejects invented endpoints and never accepts route text as an input path', () => {
  assert.equal(routeFor(`/v1/trips/${trip}/contacts/${other}/revoke`), '/v1/trips/:id/contacts/:grantId/revoke');
  for (const path of ['/v1/login', '/v1/trips/:id/snapshot', `/v1/trips/${trip}/snapshot?token=private`]) {
    assert.throws(() => routeFor(path), /Unregistered/);
  }
});

test('unsupported evidence/source metadata cannot be silently rebound', () => {
  const raw = recorder(metadata).raw();
  for (const [key, value] of [['schema', 'future'], ['backendSha', 'wrong'], ['externalSends', true], ['kind', 'real-world-pass']]) {
    assert.throws(() => adapt({...raw, [key]: value}));
  }
});

test('integrated adapter rejects earlier backend receipts rather than silently migrating their revision', () => {
  for (const legacy of ['ebc8fb1d36f441ef012ca585201cefabf61383d6', '5591c9b55fe7f4505e36ccee96d27aa913e0debf']) {
    const old = {...recorder(metadata).raw(), backendSha: legacy};
    assert.throws(() => adapt(old), /rebound through source review/);
    assert.equal(old.backendSha, legacy);
  }
});
