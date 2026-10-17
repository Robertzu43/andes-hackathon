import assert from 'node:assert/strict';
import {mkdir, readdir} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {command, disposableDatabase, testEnvironment} from './runtime.mjs';
import {verifiedBackendSource} from './source-pin.mjs';

process.chdir(fileURLToPath(new URL('../../', import.meta.url)));
assert.ok(Number(process.versions.node.split('.')[0]) >= 24 && Number(process.versions.node.split('.')[0]) < 27, 'Use Node 24–26');
assert.equal(process.argv.length, 2, 'No flags accepted; see docs/testing/local-app.md');
let runtime;
try {
  const evidenceDirectory = process.env.APP_INTEGRATION_EVIDENCE_DIR;
  const backendSha = evidenceDirectory ? verifiedBackendSource() : undefined;
  if (evidenceDirectory) {
    assert.ok(isAbsolute(evidenceDirectory), 'Evidence directory must be absolute');
    await mkdir(evidenceDirectory, {mode: 0o700}); // Exclusive: never overwrite old evidence.
  }
  runtime = await disposableDatabase();
  console.log(`SYNTHETIC integration: Node ${process.version}; PostgreSQL ${runtime.postgresVersion}; owned disposable database; stub transport only`);
  const env = testEnvironment({TEST_DATABASE_URL: runtime.url,
    APP_INTEGRATION_DATABASE_URL: runtime.url, APP_INTEGRATION_RUN_DIR: runtime.directory,
    ...(process.env.APP_INTEGRATION_CLIENT_MODULE ? {
      APP_INTEGRATION_CLIENT_MODULE: process.env.APP_INTEGRATION_CLIENT_MODULE,
      APP_INTEGRATION_CLIENT_SHA: process.env.APP_INTEGRATION_CLIENT_SHA,
    } : {}),
    ...(evidenceDirectory ? {APP_INTEGRATION_EVIDENCE_DIR: evidenceDirectory, APP_INTEGRATION_BACKEND_SHA: backendSha} : {})});
  await command('npm', ['run', 'typecheck'], {env});
  await command('npm', ['run', 'build'], {env});
  const paths = [];
  for (const folder of ['tests', 'tests/app-integration']) {
    for (const name of (await readdir(folder)).sort()) if (name.endsWith('.test.mjs')) paths.push(`${folder}/${name}`);
  }
  if (process.env.APP_INTEGRATION_CLIENT_MODULE) paths.push('tests/app-integration/client-seam.mjs');
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
