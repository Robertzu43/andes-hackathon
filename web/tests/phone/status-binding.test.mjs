// Status is a real GET. A command may report automaticEscalation true when the sweeper can run.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createDriverTransport, decodeDriverResponse } from '../../src/lib/api/driver.ts';

const id = '11111111-1111-4111-8111-111111111111';
const status = {
  trip: { status: 'active', paused: false, expectedArrivalAt: null },
  check: null,
  incident: null,
  deliveries: [],
};

test('readStatus uses the real trip status decoder and transport', async () => {
  const seen = [];
  const api = { async getTripStatus(tripId, options) { seen.push({ tripId, options }); return status; } };
  const transport = createDriverTransport(api);
  const signal = new AbortController().signal;
  assert.deepEqual(await transport({ operation: 'readStatus', params: { id } }, { signal }), { kind: 'ok', data: status });
  assert.equal(seen[0].tripId, id);
  assert.equal(seen[0].options.signal, signal);
  assert.deepEqual(decodeDriverResponse({ operation: 'readStatus' }, status), status);
});

test('a check-in command may say the sweeper can still escalate', () => {
  const decoded = decodeDriverResponse({ operation: 'command' }, { id, command: 'checkin_ok', automaticEscalation: true });
  assert.equal(decoded.automaticEscalation, true);
  assert.equal(decoded.command, 'checkin_ok');
});

// Prototype entries must never bypass SDK wire decoding.
for (const operation of ['constructor', 'toString', 'valueOf', 'unsupportedOperation']) {
  test(`${operation} is unsupported by the decoder and never dispatches HTTP`, async () => {
    assert.throws(() => decodeDriverResponse({ operation }, { undecoded: true }),
      error => error.kind === 'unsupported' && error.code === 'unsupported_operation'
        && error.operation === operation && error.outcome === 'not_applicable');
    const transport = createDriverTransport(new Proxy({}, {
      get() { assert.fail('unsupported operation reached the SDK'); },
    }));
    assert.deepEqual(await transport({ operation, params: { id } }, { signal: new AbortController().signal }),
      { kind: 'not_sent', code: 'unsupported_operation' });
  });
}
test('an unknown driver operation still throws unsupported', () => {
  assert.throws(() => decodeDriverResponse({ operation: 'notAnOperation' }, { id }), error =>
    error.kind === 'unsupported' && error.code === 'unsupported_operation'
    && error.operation === 'notAnOperation' && error.outcome === 'not_applicable');
});
