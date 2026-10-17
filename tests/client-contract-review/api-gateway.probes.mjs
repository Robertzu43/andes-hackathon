// Independent provider/identity scheduling controls; only synthetic credentials.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { IDS, NOW, ORIGIN } from './fixtures.mjs';
import { deferred, jsonResponse } from './scripted-transport.mjs';

const root = process.env.ANDES_REVIEW_API_ROOT;
if (!root) throw new TypeError('An exact archived API candidate is required');
const { createApiClient, MemorySession, createSessionGateway, bindJourneySession } =
  await import(pathToFileURL(resolve(root, 'web/src/lib/api/index.ts')).href);
const credentials = subject => ({ issuer: 'https://identity.synthetic.invalid', subject,
  accessToken: `SYNTHETIC-PRIVATE-${subject}`, expiresAt: NOW + 60_000 });
const settle = () => new Promise(setImmediate);
function fixture({ acquire, release, fetch } = {}) {
  const session = new MemorySession(() => NOW); const calls = [];
  const api = createApiClient({ baseUrl: ORIGIN, session, fetch: async (url, init) => {
    calls.push(url.pathname);
    return fetch ? fetch(url, init) : jsonResponse({ id: IDS.driver });
  } });
  const gateway = createSessionGateway({ session, api, mode: 'external', acquire, release });
  return { session, api, gateway, calls };
}
const checks = [];
async function probe(id, run) {
  try { await run(); checks.push({ id, passed: true }); }
  catch { checks.push({ id, passed: false }); }
}
await probe('gateway:unconfigured-has-no-acquisition-or-authentication', async () => {
  const f = fixture();
  try {
    const state = f.gateway.getSnapshot(); assert.deepEqual(state, { state: 'unconfigured', mode: 'external' });
    assert.equal(f.gateway.getSnapshot(), state); assert.ok(Object.isFrozen(state));
    assert.equal(f.gateway.begin, undefined); assert.equal(f.gateway.end, undefined); assert.deepEqual(f.calls, []);
  } finally { f.gateway.dispose(); }
});
await probe('gateway:credentials-alone-cannot-bypass-held-server-identity', async () => {
  const identity = deferred(); const f = fixture({ acquire: async () => credentials('A'), fetch: () => identity.promise });
  try {
    const first = f.gateway.begin(); const same = f.gateway.begin(); assert.equal(first, same);
    await settle(); assert.equal(f.gateway.getSnapshot().state, 'connecting');
    assert.deepEqual(f.calls, ['/v1/me']);
    identity.resolve(jsonResponse({ id: IDS.driver })); await first;
    assert.deepEqual(f.gateway.getSnapshot(), { state: 'authenticated', mode: 'external' });
    assert.equal(JSON.stringify(f.gateway.getSnapshot()).includes('PRIVATE'), false);
  } finally { f.gateway.dispose(); }
});
for (const oldOutcome of ['success', 'failure']) await probe(`gateway:retired-provider-${oldOutcome}-cannot-replace-a-new-session`, async () => {
  const acquisitions = [deferred(), deferred()]; let count = 0;
  const f = fixture({ acquire: () => acquisitions[count++].promise });
  try {
    const old = f.gateway.begin(); await settle(); f.gateway.end();
    const current = f.gateway.begin(); await settle();
    acquisitions[1].resolve(credentials('B')); await current;
    if (oldOutcome === 'success') acquisitions[0].resolve(credentials('A'));
    else acquisitions[0].reject(new Error('SYNTHETIC-PRIVATE-OLD-PROVIDER-FAILURE'));
    await old;
    assert.equal(f.gateway.getSnapshot().state, 'authenticated');
    assert.equal(f.session.snapshot().subject, 'B'); assert.equal(f.calls.length, 1);
  } finally { f.gateway.dispose(); }
});
await probe('gateway:retired-401-cannot-clear-newly-verified-session', async () => {
  const oldIdentity = deferred(); let acquired = 0, reads = 0;
  const f = fixture({ acquire: async () => credentials(++acquired === 1 ? 'A' : 'B'),
    fetch: () => ++reads === 1 ? oldIdentity.promise : jsonResponse({ id: IDS.otherDriver }) });
  try {
    const old = f.gateway.begin(); await settle(); f.gateway.end();
    await f.gateway.begin();
    oldIdentity.resolve(jsonResponse({ code: 'unauthorized' }, 401)); await old;
    assert.equal(f.gateway.getSnapshot().state, 'authenticated');
    assert.equal(f.session.snapshot().subject, 'B'); assert.equal(reads, 2);
  } finally { f.gateway.dispose(); }
});
await probe('gateway:old-logout-failure-cannot-overwrite-a-new-authenticated-state', async () => {
  const logout = deferred(); let releases = 0;
  const f = fixture({ acquire: async () => credentials('A'), release: () => { releases++; return logout.promise; } });
  try {
    await f.gateway.begin(); f.gateway.end();
    assert.equal(f.session.snapshot().status, 'anonymous');
    await f.gateway.begin(); logout.reject(new Error('SYNTHETIC-PRIVATE-LOGOUT-FAILURE')); await settle();
    assert.equal(f.gateway.getSnapshot().state, 'authenticated'); assert.equal(releases, 1);
  } finally { f.gateway.dispose(); }
});
await probe('gateway:private-provider-failure-is-fixed-state-and-never-auto-retried', async () => {
  let acquisitions = 0;
  const f = fixture({ acquire: async () => { acquisitions++; throw new Error('SYNTHETIC-PRIVATE-PROVIDER-FAILURE'); } });
  try {
    await f.gateway.begin(); await settle();
    assert.deepEqual(f.gateway.getSnapshot(), { state: 'error', mode: 'external' });
    assert.equal(f.session.snapshot().status, 'anonymous'); assert.equal(acquisitions, 1); assert.equal(f.calls.length, 0);
  } finally { f.gateway.dispose(); }
});
await probe('gateway:dispose-clears-bound-protected-view-without-external-logout', async () => {
  let releases = 0, actor;
  const f = fixture({ acquire: async () => credentials('A'), release: () => { releases++; } });
  const binding = bindJourneySession(f.session, f.api, value => { actor = value; });
  try {
    await f.gateway.begin(); await binding.activate(); assert.equal(actor, IDS.driver);
    f.gateway.dispose(); assert.equal(actor, null); assert.equal(releases, 0);
    assert.equal(f.session.snapshot().status, 'anonymous');
  } finally { binding.dispose(); f.gateway.dispose(); }
});
const passed = checks.every(check => check.passed);
console.log(JSON.stringify({ passed, checks, limitation:
  'Actual headless gateway/client code with synthetic providers and HTTP scheduling; no frozen foundation compatibility, browser login or production provider qualification.' }, null, 2));
process.exitCode = passed ? 0 : 1;
