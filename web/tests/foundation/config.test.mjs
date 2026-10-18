import test from 'node:test';
import assert from 'node:assert/strict';
import { webPort, localApiTarget } from '../../src/app/config.ts';

test('a temporary port is default and explicit owned ports are validated', () => {
  assert.equal(webPort(), 0);
  assert.equal(webPort('0'), 0);
  assert.equal(webPort('3049'), 3049);
  for (const value of ['-1', '443', '65536', 'abc', '3050.2']) assert.throws(() => webPort(value));
});
test('the dev proxy is disabled until an explicit loopback target is supplied', () => {
  assert.equal(localApiTarget(), undefined);
  assert.equal(localApiTarget('http://127.0.0.1:45001'), 'http://127.0.0.1:45001');
  assert.equal(localApiTarget('http://localhost:45001/'), 'http://localhost:45001');
  assert.equal(localApiTarget('http://[::1]:45001'), 'http://[::1]:45001');
});
test('no credentials, remote service, pathname or redirect hint can enter the dev proxy', () => {
  for (const value of ['https://example.com:45001', 'http://127.0.0.1:45001/v1',
    'http://secret:password@127.0.0.1:45001', 'http://127.0.0.1:45001?token=secret',
    'http://127.0.0.1:45001#fragment', 'http://127.0.0.1', 'malformed-secret-value']) {
    assert.throws(() => localApiTarget(value), error => !error.message.includes('secret') && !error.message.includes('password'));
  }
});
