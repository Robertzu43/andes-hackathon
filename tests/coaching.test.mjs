import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/runtime.mjs';
import { atomicMemoryFixture } from './helpers/atomic-memory-fixture.mjs';
import { coachingMemoryConfig, createCoachingMemory, loadCoachingMemory } from '../dist/coaching/memory.js';

async function withMemory(t, options = {}) {
  const memory = await atomicMemoryFixture(); t.after(memory.close);
  const config = coachingMemoryConfig({ ATOMICMEMORY_API_URL: memory.url, ATOMICMEMORY_API_KEY: memory.apiKey, ...options });
  return { memory, f: await fixture(t, { coachingMemory: createCoachingMemory(config) }) };
}
const save = (f, text, jwt) => f.req('POST', '/v1/coaching/note', { text, consent: true }, jwt);

test('post-trip notes are off by default and say so instead of pretending to save', async t => {
  const f = await fixture(t);
  assert.deepEqual((await f.req('GET', '/v1/coaching/note')).body, { available: false });
  assert.deepEqual(await save(f, 'Descansar en Nazca'), { status: 409, body: { code: 'memory_not_configured' } });
  assert.equal((await f.req('POST', '/v1/coaching/note/delete', {})).status, 409);
});

test('a driver saves a note after a trip, recalls it, corrects it and deletes it under their own server identity', async t => {
  const { memory, f } = await withMemory(t);
  assert.deepEqual((await f.req('GET', '/v1/coaching/note')).body, { available: true, note: null });
  assert.deepEqual(await save(f, '  Descansar en Nazca antes de las 22 h  '), { status: 200, body: { saved: true, note: { text: 'Descansar en Nazca antes de las 22 h' } } });
  const ingest = memory.requests.find(r => r.path === '/v1/memories/ingest/quick');
  assert.equal(ingest.body.user_id, `tandem-driver:${f.me.id}`);
  assert.equal(ingest.body.content_class, 'summary'); assert.equal(ingest.body.skip_extraction, true);
  assert.deepEqual(ingest.body.metadata, { externalId: 'tandem-post-trip-note' });
  assert.deepEqual((await f.req('GET', '/v1/coaching/note')).body, { available: true, note: { text: 'Descansar en Nazca antes de las 22 h' } });
  // A correction replaces the one record rather than adding a second note.
  assert.equal((await save(f, 'Descansar en Ica, no en Nazca')).status, 200);
  assert.equal(memory.records.size, 1);
  assert.deepEqual((await f.req('GET', '/v1/coaching/note')).body.note, { text: 'Descansar en Ica, no en Nazca' });
  assert.deepEqual((await f.req('POST', '/v1/coaching/note/delete', {})).body, { deleted: true });
  assert.deepEqual((await f.req('GET', '/v1/coaching/note')).body, { available: true, note: null });
  assert.deepEqual((await f.req('POST', '/v1/coaching/note/delete', {})).body, { deleted: false });
});

test('one identity never reads or deletes another identity\'s note, and the subject cannot be chosen by the client', async t => {
  const { memory, f } = await withMemory(t);
  await save(f, 'Nota del conductor');
  assert.deepEqual((await f.req('GET', '/v1/coaching/note', undefined, f.contact)).body, { available: true, note: null });
  assert.deepEqual((await f.req('POST', '/v1/coaching/note/delete', {}, f.contact)).body, { deleted: false });
  assert.equal((await f.req('POST', '/v1/coaching/note', { text: 'x', consent: true, user_id: `tandem-driver:${f.contactIdentity.id}` })).status, 400);
  assert.deepEqual((await f.req('GET', '/v1/coaching/note')).body.note, { text: 'Nota del conductor' });
  assert.equal(memory.records.size, 1);
  assert.equal((await f.app.inject({ method: 'GET', url: '/v1/coaching/note' })).statusCode, 401);
});

test('saving needs explicit consent and a short non-blank note; refusals never reach the provider', async t => {
  const { memory, f } = await withMemory(t);
  for (const body of [{ text: 'Sin permiso' }, { text: 'Sin permiso', consent: false }, { text: '   ', consent: true }, { text: 'x'.repeat(281), consent: true }]) {
    assert.equal((await f.req('POST', '/v1/coaching/note', body)).status, 400);
  }
  assert.equal(memory.requests.length, 0);
});

test('a failing or slow provider is reported as unavailable within the bound, never as saved', async t => {
  const { memory, f } = await withMemory(t, { ATOMICMEMORY_TIMEOUT_MS: '150' });
  memory.state.failStatus = 503;
  assert.deepEqual(await save(f, 'Nota'), { status: 503, body: { code: 'memory_unavailable' } });
  assert.deepEqual(await f.req('GET', '/v1/coaching/note'), { status: 503, body: { code: 'memory_unavailable' } });
  memory.state.failStatus = null; memory.state.delayMs = 1000;
  const started = Date.now();
  assert.deepEqual(await save(f, 'Nota lenta'), { status: 503, body: { code: 'memory_unavailable' } });
  assert.ok(Date.now() - started < 900, 'the provider deadline bounds the request');
});

test('a wrong key or an unexpected provider body is unavailable, not an empty note', async t => {
  const memory = await atomicMemoryFixture({ apiKey: 'right' }); t.after(memory.close);
  const wrong = await fixture(t, { coachingMemory: createCoachingMemory(coachingMemoryConfig({ ATOMICMEMORY_API_URL: memory.url, ATOMICMEMORY_API_KEY: 'wrong' })) });
  assert.equal((await wrong.req('GET', '/v1/coaching/note')).status, 503);
  const odd = createCoachingMemory({ apiUrl: new URL(memory.url), apiKey: 'right', timeoutMs: 500 }, async () => Response.json({ memories: [] }));
  await assert.rejects(odd.read('a0000000-0000-4000-8000-000000000001'), { name: 'Error', message: 'unexpected memory record' });
});

test('trips and SOS work unchanged while the memory provider is down', async t => {
  const { memory, f } = await withMemory(t);
  memory.state.failStatus = 500;
  const trip = await f.trip([await f.grant()]);
  assert.equal((await f.req('POST', `/v1/trips/${trip}/sos`, {})).status, 200);
  assert.equal((await f.req('POST', `/v1/trips/${trip}/commands`, { type: 'arrived' })).status, 200);
  assert.equal(memory.requests.length, 0, 'no trip or alert path calls the provider');
});

test('configuration is all-or-nothing, HTTPS except loopback, with a bounded timeout', () => {
  assert.equal(coachingMemoryConfig({}), null);
  assert.throws(() => coachingMemoryConfig({ ATOMICMEMORY_API_URL: 'https://api.atomicstrata.ai' }), /together/);
  assert.throws(() => coachingMemoryConfig({ ATOMICMEMORY_API_KEY: 'k' }), /together/);
  assert.throws(() => coachingMemoryConfig({ ATOMICMEMORY_API_URL: 'http://memory.example', ATOMICMEMORY_API_KEY: 'k' }), /HTTPS/);
  assert.throws(() => coachingMemoryConfig({ ATOMICMEMORY_API_URL: 'https://api.atomicstrata.ai?key=k', ATOMICMEMORY_API_KEY: 'k' }), /plain origin/);
  for (const value of ['0', '99', '5001', '1.5', 'x']) assert.throws(() => coachingMemoryConfig({ ATOMICMEMORY_API_URL: 'https://api.atomicstrata.ai', ATOMICMEMORY_API_KEY: 'k', ATOMICMEMORY_TIMEOUT_MS: value }), /TIMEOUT/);
  assert.equal(coachingMemoryConfig({ ATOMICMEMORY_API_URL: 'http://127.0.0.1:17350', ATOMICMEMORY_API_KEY: 'k' }).timeoutMs, 2000);
});

test('at startup a partial or invalid memory configuration turns notes off with a warning instead of stopping the backend', async t => {
  for (const env of [{ ATOMICMEMORY_API_URL: 'https://api.atomicstrata.ai' }, { ATOMICMEMORY_API_KEY: 'secret-key' },
    { ATOMICMEMORY_API_URL: 'not a url', ATOMICMEMORY_API_KEY: 'secret-key' }, { ATOMICMEMORY_API_URL: 'http://memory.example', ATOMICMEMORY_API_KEY: 'secret-key' },
    { ATOMICMEMORY_API_URL: 'https://api.atomicstrata.ai', ATOMICMEMORY_API_KEY: 'secret-key', ATOMICMEMORY_TIMEOUT_MS: 'x' }]) {
    const warnings = [];
    assert.equal(loadCoachingMemory(env, reason => warnings.push(reason)), undefined);
    assert.equal(warnings.length, 1);
    assert.doesNotMatch(warnings[0], /secret-key|memory\.example|not a url/, 'the warning never echoes the key or URL');
  }
  const silent = [];
  assert.equal(loadCoachingMemory({}, reason => silent.push(reason)), undefined); assert.deepEqual(silent, []);
  const f = await fixture(t, { coachingMemory: loadCoachingMemory({ ATOMICMEMORY_API_KEY: 'k' }, () => {}) });
  assert.deepEqual((await f.req('GET', '/v1/coaching/note')).body, { available: false });
  assert.equal((await f.req('POST', `/v1/trips/${await f.trip([await f.grant()])}/sos`, {})).status, 200);
});
