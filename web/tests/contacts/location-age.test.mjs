import test from 'node:test';
import assert from 'node:assert/strict';
import { locationAge } from '../../src/features/contacts/journey.ts';
import { ids } from './fixtures.mjs';

// Same source/counterexample instants as Q59's immutable16d51a1 reproducer.
const T = Date.parse('2026-10-17T12:00:00.000Z');
const snapshot = () => ({ tripId: ids.trip, readAt: new Date(T).toISOString(), ageMs: 120000, freshness: 'fresh',
  location: { capturedAt: new Date(T - 120000).toISOString(), receivedAt: new Date(T).toISOString(),
    latitude: 0, longitude: 0, accuracy: 10 } });

test('source age is explicitly as of the server read, with no current-time estimate', () => {
  const fact = snapshot(); const before = structuredClone(fact);
  assert.deepEqual(locationAge(fact), { ageMs: 120000, asOf: 'server-read', serverFreshnessAtRead: 'fresh',
    readAt: fact.readAt, live: false, currentAuthorization: 'requires-server-check' });
  assert.deepEqual(fact, before);
});

for (const [name, clientWallTime] of [
  ['aligned clock after 120 seconds', T + 120000],
  ['client clock 60 seconds behind', T + 60000],
  ['client clock 60 seconds ahead', T + 180000],
  ['backward step still after server read', T + 30000],
  ['rollback before server read', T - 90000],
]) test(`${name} cannot alter the raw as-of-read age`, () => {
  // Legacy JavaScript may still supply an extra argument. It grants no clock anchor.
  const result = locationAge(snapshot(), clientWallTime);
  assert.equal(result.ageMs, 120000);
  assert.equal(result.asOf, 'server-read');
  assert.equal(result.readAt, new Date(T).toISOString());
  assert.equal(result.serverFreshnessAtRead, 'fresh');
  assert.equal(result.live, false);
  assert.equal(result.currentAuthorization, 'requires-server-check');
});

test('backend-accepted 300ms future capture preserves the server-clamped zero age', () => {
  const fact = snapshot(); fact.ageMs = 0; fact.location.capturedAt = new Date(T + 300).toISOString();
  const result = locationAge(fact);
  assert.equal(result.ageMs, 0); assert.equal(result.asOf, 'server-read');
  assert.equal(result.serverFreshnessAtRead, 'fresh'); assert.equal(result.live, false);
});

test('unavailable source age remains null, not a fabricated elapsed age', () => {
  const fact = { ...snapshot(), location: null, ageMs: null, freshness: 'unavailable' };
  const result = locationAge(fact);
  assert.equal(result.ageMs, null); assert.equal(result.serverFreshnessAtRead, 'unavailable');
  assert.equal(result.asOf, 'server-read'); assert.equal(result.currentAuthorization, 'requires-server-check');
});
