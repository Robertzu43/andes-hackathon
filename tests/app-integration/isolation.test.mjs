import test from 'node:test';
import assert from 'node:assert/strict';
import {localAdminUrl, runDatabaseUrl, testEnvironment} from '../../scripts/app-integration/runtime.mjs';

test('integration runtime rejects remote databases and borrowed schemas', () => {
  for (const url of ['postgresql://example.com/db', 'postgresql://localhost.evil.invalid/db',
    'https://localhost/db', 'postgresql://localhost/db?options=-csearch_path=public']) {
    assert.throws(() => localAdminUrl(url));
  }
  for (const url of ['postgresql://localhost/production', 'postgresql://localhost/andes_q46_bad',
    'postgresql://remote.invalid/andes_q46_0123456789abcdef',
    'postgresql://localhost/andes_q46_0123456789abcdef?host=/tmp/shared/socket']) {
    assert.throws(() => runDatabaseUrl(url));
  }
  assert.equal(runDatabaseUrl('postgresql://localhost/andes_q46_0123456789abcdef').pathname, '/andes_q46_0123456789abcdef');
  assert.equal(runDatabaseUrl('postgresql://localhost:56446/andes_q46_0123456789abcdef?host=/tmp/andes-q46-owned/socket').port, '56446');
});

test('test child environment excludes inherited live credentials and production configuration', () => {
  const env = testEnvironment();
  assert.equal(env.ZAVU_LIVE_SEND, 'false');
  for (const name of ['DATABASE_URL', 'AWS_ACCESS_KEY_ID', 'AWS_PROFILE', 'ZAVU_API_KEY', 'OIDC_JWKS_URL']) {
    assert.equal(Object.hasOwn(env, name), false);
  }
});
