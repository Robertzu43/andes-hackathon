import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from '../tests/helpers/runtime.mjs';
import {deferred} from '../tests/helpers/dispatch.mjs';
import {createApiClient, MemorySession, ApiError} from '../web/src/lib/api/index.ts';

function sessionFor(subject, accessToken) {
  const session = new MemorySession();
  session.setCredentials({issuer: 'https://synthetic.test', subject, accessToken, expiresAt: Date.now() + 60000});
  return session;
}

test('real committed HTTP write with lost response stays unknown; only explicit same-key replay reads the original result', {timeout: 15000}, async t => {
  const f = await fixture(t);
  const baseUrl = await f.app.listen({host: '127.0.0.1', port: 0});
  const session = sessionFor('driver', f.driver);
  let calls = 0;
  const lossy = createApiClient({baseUrl, session, async fetch(url, init) {
    calls++;
    const response = await fetch(url, init);
    assert.equal(response.status, 200);
    await response.arrayBuffer();
    // Native HTTP completed and SQL committed; withhold its result from client.
    throw new Error('SYNTHETIC response lost after commit');
  }});
  const body = {label: 'SYNTHETIC explicit intent'};
  const intent = {idempotencyKey: randomUUID()};
  await assert.rejects(lossy.createTruck(body, intent), error =>
    error instanceof ApiError && error.kind === 'network' && error.outcome === 'unknown');
  assert.equal(calls, 1, 'an ambiguous write must not trigger an automatic replay');
  const stored = (await f.ctx.pool.query('SELECT id,label FROM trucks')).rows;
  assert.equal(stored.length, 1);
  assert.equal(stored[0].label, body.label);
  const normal = createApiClient({baseUrl, session});
  assert.deepEqual(await normal.createTruck(body, intent), {id: stored[0].id});
  assert.equal((await f.ctx.pool.query('SELECT count(*)::int AS n FROM trucks')).rows[0].n, 1);
  await assert.rejects(normal.createTruck({label: 'SYNTHETIC changed intent'}, intent), error =>
    error instanceof ApiError && error.kind === 'conflict' && error.status === 409 && error.outcome === 'rejected');
});

test('a delayed real private-trip response cannot cross a session switch even when transport ignores abort', {timeout: 15000}, async t => {
  const f = await fixture(t);
  const trip = await f.trip();
  const baseUrl = await f.app.listen({host: '127.0.0.1', port: 0});
  const session = sessionFor('driver', f.driver);
  const entered = deferred(), release = deferred();
  const delayed = createApiClient({baseUrl, session, async fetch(url, init) {
    // Deliberately ignore the old session's abort, but use real native HTTP/JWT.
    const response = await fetch(url, {...init, signal: undefined});
    assert.equal(response.status, 200);
    const privateRow = await response.clone().json();
    assert.equal(privateRow.driver_id, f.me.id);
    entered.resolve();
    await release.promise;
    return response;
  }});
  const pending = delayed.getTrip(trip);
  const rejected = assert.rejects(pending, error =>
    error instanceof ApiError && error.kind === 'session_changed' && error.outcome === 'not_applicable');
  try {
    await entered.promise;
    session.setCredentials({issuer: 'https://synthetic.test', subject: 'stranger', accessToken: f.stranger, expiresAt: Date.now() + 60000});
  } finally { release.resolve(); }
  await rejected;
  const normal = createApiClient({baseUrl, session});
  await assert.rejects(normal.getTrip(trip), error =>
    error instanceof ApiError && error.kind === 'forbidden' && error.status === 403);
  assert.equal(session.snapshot().subject, 'stranger', 'ownership denial must not clear a valid replacement session');
});
