// Follow-on PR62 source-age review. Expected current failure behavior, not a fix.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

if (!process.argv[2]) throw new Error('Supply an immutable PR62 archive path');
const { locationAge } = await import(pathToFileURL(resolve(process.argv[2], 'web/src/features/contacts/journey.ts')));
const T = Date.parse('2026-10-17T12:00:00.000Z');
const snapshot = { tripId: 'synthetic-trip', readAt: new Date(T).toISOString(), ageMs: 120000, freshness: 'fresh',
  location: { capturedAt: new Date(T - 120000).toISOString(), receivedAt: new Date(T).toISOString(),
    latitude: 0, longitude: 0, accuracy: 10 } };
const aligned = locationAge(snapshot, T + 120000);
assert.equal(aligned.ageMs, 240000);
const behind = locationAge(snapshot, T + 120000 - 60000);
assert.equal(behind.ageMs, 180000); // 60 seconds younger solely due to client/server wall offset.
const ahead = locationAge(snapshot, T + 120000 + 60000);
assert.equal(ahead.ageMs, 300000);
const sameClientClockAfterBackwardStep = locationAge(snapshot, T + 120000 - 90000);
assert.equal(sameClientClockAfterBackwardStep.ageMs, 150000);
const acceptedFutureCapture = structuredClone(snapshot);
acceptedFutureCapture.ageMs = 0;
acceptedFutureCapture.location.capturedAt = new Date(T + 300).toISOString();
assert.equal(locationAge(acceptedFutureCapture, T).ageMs, null);
for (const out of [aligned, behind, ahead, sameClientClockAfterBackwardStep]) {
  assert.equal(out.serverFreshnessAtRead, 'fresh'); assert.equal(out.live, false);
  assert.equal(out.currentAuthorization, 'requires-server-check');
}
console.log(JSON.stringify({ runtime: process.version, candidate: '21cd50ac15c22a2a3cc71bf105336e8ebc77c285',
  result: 'P2 source-age mismatch reproduced; original owner/reviewer confirmation required',
  source: 'web/src/features/contacts/journey.ts:74-81', aligned, behind, ahead, sameClientClockAfterBackwardStep,
  accepted300msFutureCapture: locationAge(acceptedFutureCapture, T),
  boundary: 'No live/safe claim observed; these are source arithmetic probes, not UI or backend integration proof' }, null, 2));
