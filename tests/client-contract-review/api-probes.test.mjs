// These small fabricated drivers prove oracle sensitivity; they are not application clients.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDS } from './fixtures.mjs';
import { runApiProbes } from './api-probes.mjs';

function controlFactory(defect = null) {
  return async ({ baseUrl, fetchImpl, store }) => {
    let session = null, generation = 0, cache = null;
    return {
      async setSession(value) {
        session = value; generation++;
        if (defect === 'persist-token') await store.put('bad-token', value.token);
      },
      async clearSession() {
        session = null; generation++;
        if (defect !== 'persist-token') await store.clear();
      },
      async call(request) {
        if (!session) throw { kind: 'session' };
        if (defect === 'cached-snapshot' && cache && request.path.endsWith('/snapshot')) return cache;
        const startedGeneration = generation;
        const post = request.method === 'POST';
        let response;
        try {
          response = await fetchImpl(baseUrl + request.path, {
            method: request.method, signal: request.signal,
            headers: { authorization: `Bearer ${session.token}`, 'content-type': 'application/json',
              ...(post ? { 'idempotency-key': request.idempotencyKey } : {}) },
            ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
          });
        } catch (error) {
          if (defect === 'blind-retry' && post) {
            return (await fetchImpl(baseUrl + request.path, {
              method: 'POST', headers: { 'idempotency-key': request.idempotencyKey }, body: JSON.stringify(request.body),
            })).json();
          }
          throw { kind: error.name === 'AbortError' ? 'aborted' : 'network', ambiguous: post };
        }
        if (startedGeneration !== generation && defect !== 'stale-session') throw { kind: 'session' };
        let body;
        try { body = await response.json(); }
        catch { throw { kind: 'protocol', ambiguous: defect === 'false-noncommit' ? false : post }; }
        if (!response.ok) throw { kind: 'http', status: defect === 'collapse-status' ? 400 : response.status, code: body.code };
        if (defect === 'restamp-source' && body.location) body.location.capturedAt = body.readAt;
        cache = body;
        return body;
      },
    };
  };
}

test('all API oracle cases accept a conforming synthetic control, not an author candidate', async () => {
  const results = await runApiProbes(controlFactory());
  assert.equal(results.length, 29);
  assert.ok(results.every(result => result.passed), JSON.stringify(results.filter(result => !result.passed)));
});

for (const [defect, id] of [
  ['blind-retry', 'write:lost-response-explicit-same-key-replay'],
  ['false-noncommit', 'write:malformed-success-is-ambiguous'],
  ['collapse-status', 'http:403'],
  ['restamp-source', 'route:snapshot'],
  ['cached-snapshot', 'read:revoked-snapshot-cannot-reuse-cached-location'],
  ['persist-token', 'session:signout-clears-sensitive-store-and-prevents-new-request'],
  ['stale-session', 'session:late-response-cannot-cross-to-new-user'],
]) {
  test(`oracle rejects the ${defect} fault control`, async () => {
    const [result] = await runApiProbes(controlFactory(defect), { only: [id] });
    assert.equal(result.passed, false, `mutated driver escaped ${id}`);
  });
}

test('fixtures represent distinct actors rather than granting identity with a body field', () => {
  assert.notEqual(IDS.driver, IDS.otherDriver);
});
