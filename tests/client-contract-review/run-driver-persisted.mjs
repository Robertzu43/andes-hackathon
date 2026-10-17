// Reuse lane46's owned-cluster lifecycle for the frozen driver's declared SQL tests.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

let owned;
try {
  const runtimeRoot = process.env.ANDES_REVIEW_RUNTIME_ROOT;
  const driverRoot = process.env.ANDES_REVIEW_DRIVER_ROOT;
  assert.ok(runtimeRoot && driverRoot && process.env.APP_INTEGRATION_PG_PORT);
  assert.equal(process.env.APP_INTEGRATION_ADMIN_URL, undefined);
  const { disposableDatabase, command, testEnvironment } = await import(pathToFileURL(resolve(runtimeRoot, 'scripts/app-integration/runtime.mjs')).href);
  owned = await disposableDatabase();
  await command(process.execPath, ['--test', 'web/tests/driver/persisted.integration.mjs'], {
    cwd: driverRoot,
    env: testEnvironment({ ANDES_DRIVER_RUNTIME_ROOT: runtimeRoot, TEST_DATABASE_URL: owned.url }),
  });
} catch {
  console.error('Frozen driver persisted checks failed; database/credential details withheld.');
  process.exitCode = 1;
} finally {
  try { await owned?.cleanup(); }
  catch { console.error('Owned driver-test database cleanup failed.'); process.exitCode = 1; }
}
