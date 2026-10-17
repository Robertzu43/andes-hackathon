// Browser-only reviewer fixture: real IndexedDB; no production UI or network API.
import { openObservationStores, openObservationQueue, createLocationUploader,
  createObservationPipeline } from '/candidate/index.mjs';

const dbName = new URL(location.href).searchParams.get('db');
if (!/^q47-review-[a-z0-9-]+$/.test(dbName ?? '')) throw new Error('An owned reviewer database name is required');
const scopeA = { userId: '00000000-0000-4000-8000-000000000001', tripId: '00000000-0000-4000-8000-000000000005' };
const scopeB = { userId: '00000000-0000-4000-8000-000000000002', tripId: '00000000-0000-4000-8000-000000000006' };
const check = (value, message) => { if (!value) throw new Error(message); };
const observed = [];
const pageInstance = crypto.randomUUID();
const opened = await openObservationStores({ dbName });
check(opened.ok, 'Native IndexedDB failed to open');
const { stores } = opened;
const queue = await openObservationQueue({ ...stores, capacity: 3 });
const requests = [];
const uploaders = new Set();
function uploader({ token = async () => 'SYNTHETIC-LOCAL-TEST', offline = false } = {}) {
  const upload = createLocationUploader({ queue, baseUrl: 'https://andes.synthetic.invalid', getAccessToken: token,
    fetchImpl: async (url, init) => {
      const parsed = new URL(url);
      check(parsed.origin === 'https://andes.synthetic.invalid', 'Unexpected synthetic upload origin');
      const request = { path: parsed.pathname, key: new Headers(init.headers).get('idempotency-key'),
        body: JSON.parse(init.body) };
      requests.push(request);
      if (offline) throw new TypeError('SYNTHETIC transport offline');
      return Response.json({ id: parsed.pathname.split('/')[3], received: request.body.observations.length });
    } });
  uploaders.add(upload); return upload;
}
async function enqueue(eventId, scope, capturedAt) {
  return queue.enqueue({ scope, sample: { capturedAt, latitude: 0, longitude: 0, accuracy: 15 },
    provenance: { eventId, sessionId: 'synthetic-browser-session', requestId: eventId } });
}
async function inspect() {
  const result = { nativeIndexedDB: typeof indexedDB.open === 'function', origin: location.origin, dbName, pageInstance,
    navigationStartedAt: performance.timeOrigin,
    counts: await queue.counts(), records: await stores.records.getAll(), meta: await stores.meta.getAll(),
    requests: structuredClone(requests), observed: [...observed] };
  check(!JSON.stringify([result.records, result.meta]).includes('SYNTHETIC-LOCAL-TEST'), 'Bearer marker entered IndexedDB');
  document.querySelector('pre').textContent = JSON.stringify(result, null, 2);
  return result;
}
globalThis.__q47Queue = {
  inspect,
  async seed() {
    check((await queue.counts()).retained === 0, 'Seed requires an empty owned database');
    const capturedAt = new Date(Date.now() - 300_000).toISOString();
    check((await enqueue('synthetic-browser:A', scopeA, capturedAt)).ok, 'Seed A failed');
    check((await enqueue('synthetic-browser:B', scopeB, capturedAt)).ok, 'Seed B failed');
    observed.push('two scopes committed to native IndexedDB'); return inspect();
  },
  async verifyReload(expectedRecords, previousInstance) {
    check(typeof previousInstance === 'string' && pageInstance !== previousInstance, 'A new page instance is required for reload proof');
    const actual = await stores.records.getAll();
    check(JSON.stringify(actual) === JSON.stringify(expectedRecords), 'Reload changed persisted source/provenance records');
    check(requests.length === 0, 'Reload transmitted work automatically');
    observed.push('hard reload preserved records exactly and made no upload'); return inspect();
  },
  async flushBThenOfflineA() {
    const uploadB = uploader();
    try { await uploadB.flush({ userId: scopeB.userId }); } finally { uploadB.stop(); }
    check(requests.length === 1 && requests[0].path === `/v1/trips/${scopeB.tripId}/locations`, 'Owner B uploaded another scope');
    check((await stores.records.getAll()).every(record => record.userId === scopeA.userId), 'Other owner drain changed A data');
    const offline = uploader({ offline: true });
    try { await offline.flush({ userId: scopeA.userId }); } finally { offline.stop(); }
    const records = await stores.records.getAll();
    check(records.length === 1 && records[0].state === 'pending' && records[0].attempts === 1, 'Lost upload was not retained');
    observed.push('explicit owner B drain isolated A; one synthetic offline attempt retained A'); return inspect();
  },
  async capacity() {
    const base = Date.now() - 200_000;
    for (let i = 0; i < 3; i++) check((await enqueue(`synthetic-browser:capacity-${i}`, scopeA, new Date(base + i).toISOString())).ok,
      'Capacity enqueue failed');
    const state = await inspect();
    check(state.counts.retained === 3 && state.counts.droppedOverflow === 1, 'Capacity/drop accounting is wrong');
    check(state.records.every(record => record.provenance.eventId.startsWith('synthetic-browser:capacity-')), 'Overflow did not evict oldest pending sample');
    observed.push('native IndexedDB capacity preserved three later samples with one counted eviction'); return inspect();
  },
  async retirementRace() {
    let reached, release;
    const held = new Promise(resolve => { release = resolve; });
    const tokenRequested = new Promise(resolve => { reached = resolve; });
    const upload = uploader({ token: () => { reached(); return held; } });
    const pipeline = createObservationPipeline({ queue, uploader: upload, ownerSubject: scopeA.userId });
    const flushing = pipeline.flush(); await tokenRequested;
    await pipeline.revokeTrip(scopeA.tripId); await pipeline.stop();
    check((await stores.records.getAll()).length === 0, 'Revocation left location records in native IndexedDB');
    const before = requests.length;
    release('SYNTHETIC-LOCAL-TEST'); await flushing;
    const result = { requestsBeforeRetirementFinished: before, newRequestsAfterRetirement: requests.length - before,
      scopeRevoked: queue.isScopeRevoked(scopeA), state: await inspect() };
    // Report the candidate's actual result: a nonzero value is the original P1.
    observed.push('retirement race executed with native IndexedDB'); return result;
  },
  async retirementStoreRead(transition) {
    check(['stop', 'revoke'].includes(transition), 'Unknown retirement transition');
    let reached, release, held = false;
    const wait = new Promise(resolve => { release = resolve; });
    const reachedRead = new Promise(resolve => { reached = resolve; });
    const get = stores.records.get.bind(stores.records);
    stores.records.get = async key => {
      const record = await get(key); // Actual IndexedDB result, then scheduling pause.
      if (!held) { held = true; reached(); await wait; }
      return record;
    };
    const upload = uploader();
    const pipeline = createObservationPipeline({ queue, uploader: upload, ownerSubject: scopeA.userId });
    const flushing = pipeline.flush(); await reachedRead;
    if (transition === 'stop') await pipeline.stop();
    else await pipeline.revokeTrip(scopeA.tripId);
    const before = requests.length; release(); await flushing; upload.stop();
    return { transition, requestsBeforeRetirementFinished: before,
      newRequestsAfterRetirement: requests.length - before, scopeRevoked: queue.isScopeRevoked(scopeA), state: await inspect() };
  },
  async cleanup() {
    for (const upload of uploaders) upload.stop();
    stores.close();
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(dbName);
      request.onsuccess = resolve; request.onerror = reject; request.onblocked = () => reject(new Error('Owned database deletion blocked'));
    });
    return { deletedOwnedDatabase: dbName };
  },
};
await inspect();
document.documentElement.dataset.ready = 'true';
