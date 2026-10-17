import assert from 'node:assert/strict';
import {readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {command, disposableDatabase, testEnvironment} from './runtime.mjs';

process.chdir(fileURLToPath(new URL('../../', import.meta.url)));
assert.ok(Number(process.versions.node.split('.')[0]) >= 24 && Number(process.versions.node.split('.')[0]) < 27, 'Use Node 24–26');
assert.equal(process.argv.length, 2, 'No flags accepted; see docs/testing/local-app.md');
let runtime;
try {
  runtime = await disposableDatabase();
  console.log(`SYNTHETIC integration: Node ${process.version}; PostgreSQL ${runtime.postgresVersion}; owned disposable database; stub transport only`);
  const env = testEnvironment({TEST_DATABASE_URL: runtime.url,
    APP_INTEGRATION_DATABASE_URL: runtime.url, APP_INTEGRATION_RUN_DIR: runtime.directory});
  await command('npm', ['run', 'typecheck'], {env});
  await command('npm', ['run', 'build'], {env});
  const paths = [];
  for (const folder of ['tests', 'tests/app-integration']) {
    for (const name of (await readdir(folder)).sort()) if (name.endsWith('.test.mjs')) paths.push(`${folder}/${name}`);
  }
  await command(process.execPath, ['--test', ...paths], {env});
  console.log('SYNTHETIC integration checks passed; no real notification delivery or product-evidence acceptance');
} catch (error) {
  // Child tests print assertion evidence. Never print connection strings/environment.
  console.error('Local integration failed; check test output and documented prerequisites (connection details redacted)');
  if (error.message.startsWith('Integration database setup failed (')) console.error(error.message);
  process.exitCode = 1;
} finally {
  try { await runtime?.cleanup(); }
  catch { console.error('Owned integration cleanup failed; inspect only this run’s resources'); process.exitCode = 1; }
}
