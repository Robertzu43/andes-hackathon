import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {command, disposableDatabase, onInterrupt, testEnvironment} from './runtime.mjs';

process.chdir(fileURLToPath(new URL('../../', import.meta.url)));
assert.ok(Number(process.versions.node.split('.')[0]) >= 24 && Number(process.versions.node.split('.')[0]) < 27, 'Use Node 24–26');
assert.equal(process.argv.length, 2, 'No flags accepted; see docs/testing/local-app.md');
onInterrupt();
let runtime, passed = false;
try {
  runtime = await disposableDatabase();
  console.log(`SYNTHETIC integration: Node ${process.version}; PostgreSQL ${runtime.postgresVersion}; owned disposable database; stub transport only`);
  const env = testEnvironment({TEST_DATABASE_URL: runtime.url,
    APP_INTEGRATION_DATABASE_URL: runtime.url, APP_INTEGRATION_RUN_DIR: runtime.directory,
    // The interrupt test starts its own owned cluster with the same server binaries.
    ...(process.env.APP_INTEGRATION_PG_BIN ? {APP_INTEGRATION_PG_BIN: process.env.APP_INTEGRATION_PG_BIN} : {})});
  await command('npm', ['run', 'build'], {env}); // tsc with noEmitOnError: also the typecheck
  await command(process.execPath, ['--test', 'tests/*.test.mjs', 'tests/app-integration/*.test.mjs'], {env});
  passed = true;
} catch (error) {
  // Child tests print assertion evidence. Never print connection strings/environment.
  console.error('Local integration failed; check test output and documented prerequisites (connection details redacted)');
  if (error.message.startsWith('Integration database setup failed (')) console.error(error.message);
  process.exitCode ??= 1; // An interrupt already set 130/143.
} finally {
  try { await runtime?.cleanup(); }
  catch { console.error('Owned integration cleanup failed; inspect only this run’s resources'); process.exitCode = 1; }
}

// A failed cleanup is a failed overall run, even when every assertion passed.
if (passed && !process.exitCode) console.log('SYNTHETIC integration checks passed; no real notification delivery or product-evidence acceptance');
