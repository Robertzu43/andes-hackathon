// Reviewer-facing driver seam only; it does not define an application API.
import assert from 'node:assert/strict';
import { ERRORS, IDS, OPERATIONS, ORIGIN, clone, snapshot } from './fixtures.mjs';
import { deferred, jsonResponse, memoryStore, scriptedTransport } from './scripted-transport.mjs';

export const SESSION_A = Object.freeze({ userId: IDS.driver, token: 'SYNTHETIC-TOKEN-A' });
export const SESSION_B = Object.freeze({ userId: IDS.otherDriver, token: 'SYNTHETIC-TOKEN-B' });
const key = 'reviewer-write-key-1';
const operation = name => clone(OPERATIONS.find(item => item.name === name));
const errorOf = promise => promise.then(
  () => assert.fail('candidate unexpectedly succeeded'), error => error,
);
const input = op => ({ method: op.method, path: op.path,
  ...(op.body === undefined ? {} : { body: clone(op.body) }),
  ...(op.method === 'POST' ? { idempotencyKey: key } : {}) });

async function started(transport) {
  for (let turn = 0; turn < 50 && transport.calls.length === 0; turn++) await new Promise(setImmediate);
  assert.equal(transport.calls.length, 1, 'candidate did not start the held request');
}

async function using(factory, steps, run) {
  const transport = scriptedTransport(steps);
  const store = memoryStore();
  const driver = await factory({ baseUrl: ORIGIN, fetchImpl: transport.fetch, store });
  try {
    await driver.setSession(clone(SESSION_A));
    await run(driver, transport, store);
  } finally { await driver.dispose?.(); }
}

export const apiProbes = [
  ...OPERATIONS.map(op => ({
    id: `route:${op.name}`,
    run: factory => using(factory, [op], async (driver, transport) => {
      assert.deepEqual(await driver.call(input(op)), op.response, 'candidate changed a server fact');
      const [call] = transport.calls;
      assert.equal(call.headers.authorization, `Bearer ${SESSION_A.token}`);
      if (op.method === 'POST') assert.equal(call.headers['idempotency-key'], key);
      transport.assertDrained();
    }),
  })),
  ...ERRORS.map(fault => ({
    id: `http:${fault.status}`,
    run: factory => using(factory, [{ ...operation('createTruck'), ...fault, response: { code: fault.code } }],
      async (driver, transport) => {
        const error = await errorOf(driver.call(input(operation('createTruck'))));
        assert.equal(error.kind, 'http');
        assert.equal(error.status, fault.status);
        assert.equal(error.code, fault.code);
        assert.equal(transport.calls.length, 1, 'HTTP error caused an automatic write replay');
      }),
  })),
  {
    id: 'write:lost-response-explicit-same-key-replay',
    run: factory => using(factory, [
      { ...operation('createTruck'), outcome: 'network-error' }, operation('createTruck'),
    ], async (driver, transport) => {
      const request = input(operation('createTruck'));
      const error = await errorOf(driver.call(request));
      assert.equal(error.kind, 'network');
      assert.equal(error.ambiguous, true, 'a lost POST response cannot prove non-commit');
      assert.equal(transport.calls.length, 1, 'candidate blindly replayed an ambiguous write');
      assert.deepEqual(await driver.call(clone(request)), operation('createTruck').response);
      assert.equal(transport.calls.length, 2);
      assert.equal(transport.calls[0].headers['idempotency-key'], transport.calls[1].headers['idempotency-key']);
      assert.deepEqual(JSON.parse(transport.calls[0].bodyText), JSON.parse(transport.calls[1].bodyText));
    }),
  },
  {
    id: 'write:malformed-success-is-ambiguous',
    run: factory => using(factory, [{ ...operation('createTruck'), rawBody: '{not-json' }],
      async (driver, transport) => {
        const error = await errorOf(driver.call(input(operation('createTruck'))));
        assert.equal(error.kind, 'protocol');
        assert.equal(error.ambiguous, true);
        assert.equal(transport.calls.length, 1);
      }),
  },
  {
    id: 'write:abort-after-start-is-not-proof-of-cancellation',
    run: factory => using(factory, [{ ...operation('createTruck'), wait: deferred() }],
      async (driver, transport) => {
        const controller = new AbortController();
        const pending = errorOf(driver.call({ ...input(operation('createTruck')), signal: controller.signal }));
        await started(transport);
        controller.abort();
        const error = await pending;
        assert.equal(error.kind, 'aborted');
        assert.equal(error.ambiguous, true);
        assert.equal(transport.calls.length, 1);
      }),
  },
  {
    id: 'read:revoked-snapshot-cannot-reuse-cached-location',
    run: factory => using(factory, [operation('snapshot'), {
      ...operation('snapshot'), status: 403, response: { code: 'forbidden' },
    }], async (driver, transport) => {
      const request = input(operation('snapshot'));
      assert.deepEqual(await driver.call(request), snapshot());
      const error = await errorOf(driver.call(request));
      assert.equal(error.status, 403);
      assert.equal(error.code, 'forbidden');
      transport.assertDrained();
    }),
  },
  {
    id: 'session:signout-clears-sensitive-store-and-prevents-new-request',
    run: factory => using(factory, [operation('snapshot')], async (driver, transport, store) => {
      await driver.call(input(operation('snapshot')));
      await driver.clearSession();
      const error = await errorOf(driver.call(input(operation('identity'))));
      assert.equal(error.kind, 'session', 'signed-out calls need a local session error');
      assert.equal(transport.calls.length, 1);
      const retained = JSON.stringify(await store.entries());
      for (const sensitive of [SESSION_A.token, SESSION_A.userId, IDS.trip]) {
        assert.ok(!retained.includes(sensitive), 'sensitive prior-session data survived signout');
      }
    }),
  },
  {
    id: 'session:late-response-cannot-cross-to-new-user',
    run: async factory => {
      const wait = deferred();
      await using(factory, [
        { ...operation('identity'), wait, ignoreAbort: true },
        { ...operation('identity'), response: { id: IDS.otherDriver } },
      ], async (driver, transport, store) => {
        const old = errorOf(driver.call(input(operation('identity'))));
        await started(transport);
        await driver.clearSession();
        await driver.setSession(clone(SESSION_B));
        wait.resolve(jsonResponse({ id: IDS.driver }));
        assert.equal((await old).kind, 'session', 'retired session response was delivered');
        assert.deepEqual(await driver.call(input(operation('identity'))), { id: IDS.otherDriver });
        assert.equal(transport.calls[1].headers.authorization, `Bearer ${SESSION_B.token}`);
        const retained = JSON.stringify(await store.entries());
        assert.ok(!retained.includes(SESSION_A.token));
        assert.ok(!retained.includes(SESSION_A.userId));
      });
    },
  },
];

export async function runApiProbes(factory, { only, timeoutMs = 2000 } = {}) {
  if (typeof factory !== 'function') throw new TypeError('A reviewer-bound createApiDriver is required');
  const selected = only ? apiProbes.filter(probe => only.includes(probe.id)) : apiProbes;
  if (!selected.length) throw new RangeError('No matching reviewer probes');
  const results = [];
  for (const probe of selected) {
    let timer;
    try {
      await Promise.race([
        probe.run(factory),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Reviewer probe timed out')), timeoutMs); }),
      ]);
      results.push({ id: probe.id, passed: true });
    } catch (error) {
      // Do not print candidate exception text: it may contain a token, URL or raw response.
      results.push({ id: probe.id, passed: false, failure: error instanceof assert.AssertionError ? 'assertion' : 'exception-or-timeout' });
    } finally { clearTimeout(timer); }
  }
  return results;
}
