import assert from 'node:assert/strict';
import test from 'node:test';
import { MemorySession, createApiClient, createSessionGateway } from '../../src/lib/api/index.ts';

const id = '11111111-1111-4111-8111-111111111111';
const credentials = () => ({ issuer: 'https://identity.example.invalid', subject: 'synthetic-A',
  accessToken: 'PRIVATE_SYNTHETIC_TOKEN', expiresAt: Date.now() + 60_000 });
function setup(fetch, acquire) {
  const session = new MemorySession();
  const api = createApiClient({ baseUrl: 'https://api.example.invalid', session, fetch });
  const gateway = createSessionGateway({ session, api, mode: 'demo', acquire });
  return { session, api, gateway };
}

test('unconfigured gateway is inert and publishes stable immutable token-free snapshots', () => {
  let calls = 0;
  const { gateway } = setup(async () => { calls += 1; return Response.json({ id }); });
  try {
    assert.deepEqual(gateway.getSnapshot(), { state: 'unconfigured', mode: 'demo' });
    assert.equal(gateway.getSnapshot(), gateway.getSnapshot());
    assert.ok(Object.isFrozen(gateway.getSnapshot()));
    assert.equal(gateway.begin, undefined); assert.equal(gateway.end, undefined);
    assert.equal(calls, 0);
  } finally { gateway.dispose(); }
});

test('acquisition alone cannot authenticate: actual identity verification must finish', async () => {
  let finish;
  const { gateway } = setup(async (url, init) => {
    assert.equal(url.pathname, '/v1/me'); assert.equal(init.headers.Authorization, 'Bearer PRIVATE_SYNTHETIC_TOKEN');
    return new Promise(resolve => { finish = resolve; });
  }, async () => credentials());
  try {
    const pending = gateway.begin();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(gateway.getSnapshot().state, 'connecting');
    finish(Response.json({ id }));
    await pending;
    assert.deepEqual(gateway.getSnapshot(), { state: 'authenticated', mode: 'demo' });
    assert.equal(JSON.stringify(gateway.getSnapshot()).includes('PRIVATE_'), false);
  } finally { gateway.dispose(); }
});

test('repeated begin shares one explicit acquisition and does not auto-refresh', async () => {
  let acquisitions = 0; let reads = 0;
  const { gateway } = setup(async () => { reads += 1; return Response.json({ id }); }, async () => { acquisitions += 1; return credentials(); });
  try {
    const first = gateway.begin(); const second = gateway.begin();
    assert.equal(first, second); await first;
    assert.equal(acquisitions, 1); assert.equal(reads, 1);
  } finally { gateway.dispose(); }
});

test('end during acquisition cannot install delayed credentials or publish authenticated', async () => {
  let finish;
  const { session, gateway } = setup(async () => Response.json({ id }), async () => new Promise(resolve => { finish = resolve; }));
  try {
    const pending = gateway.begin(); await new Promise(resolve => setImmediate(resolve));
    gateway.end(); finish(credentials()); await pending;
    assert.equal(gateway.getSnapshot().state, 'signed-out');
    assert.equal(session.snapshot().status, 'anonymous');
  } finally { gateway.dispose(); }
});

test('backend refusal and an old identity response never become authenticated', async () => {
  const refused = setup(async () => Response.json({ code: 'unauthorized' }, { status: 401 }), async () => credentials());
  try { await refused.gateway.begin(); assert.notEqual(refused.gateway.getSnapshot().state, 'authenticated'); }
  finally { refused.gateway.dispose(); }
  let finish;
  const old = setup(async () => new Promise(resolve => { finish = resolve; }), async () => credentials());
  try {
    const pending = old.gateway.begin(); await new Promise(resolve => setImmediate(resolve));
    old.session.clear(); finish(Response.json({ id })); await pending;
    assert.equal(old.gateway.getSnapshot().state, 'signed-out');
  } finally { old.gateway.dispose(); }
});

test('private synchronous provider errors yield only a stable error state and allow explicit retry', async () => {
  let count = 0;
  const { gateway } = setup(async () => Response.json({ id }), () => {
    count += 1;
    if (count === 1) throw new Error('PRIVATE_PROVIDER_SECRET');
    return Promise.resolve(credentials());
  });
  try {
    await gateway.begin();
    assert.equal(gateway.getSnapshot().state, 'error');
    assert.equal(JSON.stringify(gateway.getSnapshot()).includes('PRIVATE_'), false);
    await gateway.begin(); assert.equal(gateway.getSnapshot().state, 'authenticated');
    assert.equal(count, 2);
  } finally { gateway.dispose(); }
});

test('subscription signals are token-free, snapshots stay referentially stable between changes', async () => {
  const { gateway } = setup(async () => Response.json({ id }), async () => credentials());
  const snapshots = [];
  const unsubscribe = gateway.subscribe((...args) => { assert.equal(args.length, 0); snapshots.push(gateway.getSnapshot()); });
  try {
    const initial = gateway.getSnapshot(); await gateway.begin();
    assert.notEqual(gateway.getSnapshot(), initial);
    assert.equal(gateway.getSnapshot(), gateway.getSnapshot());
    assert.deepEqual(snapshots.map(s => s.state), ['connecting', 'authenticated']);
    unsubscribe(); gateway.end(); assert.equal(snapshots.length, 2);
  } finally { gateway.dispose(); }
});

test('session expiry changes the gateway without acquiring or verifying again', async () => {
  let acquisitions = 0;
  const { gateway } = setup(async () => Response.json({ id }), async () => {
    acquisitions += 1; return { ...credentials(), expiresAt: Date.now() + 25 };
  });
  try {
    await gateway.begin(); assert.equal(gateway.getSnapshot().state, 'authenticated');
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(gateway.getSnapshot().state, 'expired'); assert.equal(acquisitions, 1);
  } finally { gateway.dispose(); }
});

test('synchronous subscriber cancellation cannot strand a future explicit sign-in', async () => {
  let cancelOnce = true; let acquisitions = 0;
  const { gateway } = setup(async () => Response.json({ id }), async () => { acquisitions += 1; return credentials(); });
  const unsubscribe = gateway.subscribe(() => {
    if (cancelOnce && gateway.getSnapshot().state === 'connecting') { cancelOnce = false; gateway.end(); }
  });
  try {
    await gateway.begin(); assert.equal(gateway.getSnapshot().state, 'signed-out');
    await gateway.begin(); assert.equal(gateway.getSnapshot().state, 'authenticated');
    assert.equal(acquisitions, 1);
  } finally { unsubscribe(); gateway.dispose(); }
});

test('a reentrant begin from a subscriber shares the same verification promise', async () => {
  const { gateway } = setup(async () => Response.json({ id }), async () => credentials());
  let nested;
  const unsubscribe = gateway.subscribe(() => { if (gateway.getSnapshot().state === 'connecting') nested = gateway.begin(); });
  try {
    const outer = gateway.begin();
    assert.equal(outer, nested);
    await outer; assert.equal(gateway.getSnapshot().state, 'authenticated');
  } finally { unsubscribe(); gateway.dispose(); }
});
