import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir, readdir, readFile, rm} from 'node:fs/promises';
import {isAbsolute, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {command, disposableDatabase, onInterrupt, testEnvironment} from './runtime.mjs';
import {writeCapture} from './receipts.mjs';
import {verifiedBackendSource} from './source-pin.mjs';

function producerRevision() {
  const head = spawnSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'});
  const status = spawnSync('git', ['status', '--porcelain'], {encoding: 'utf8'});
  assert.ok(head.status === 0 && status.status === 0, 'Receipt export needs a Git checkout');
  return head.stdout.trim() + (status.stdout.trim() ? '+dirty' : '');
}

process.chdir(fileURLToPath(new URL('../../', import.meta.url)));
assert.ok(Number(process.versions.node.split('.')[0]) >= 24 && Number(process.versions.node.split('.')[0]) < 27, 'Use Node 24–26');
assert.equal(process.argv.length, 2, 'No flags accepted; see docs/testing/local-app.md');
onInterrupt();
let runtime, evidenceDirectory, backendSha, raw, passed = false;
try {
  evidenceDirectory = process.env.APP_INTEGRATION_EVIDENCE_DIR;
  backendSha = evidenceDirectory ? verifiedBackendSource() : undefined;
  if (evidenceDirectory) {
    assert.ok(isAbsolute(evidenceDirectory), 'Evidence directory must be absolute');
    assert.ok(!existsSync(evidenceDirectory), 'Evidence directory must be new'); // Created only after success.
  }
  runtime = await disposableDatabase();
  console.log(`SYNTHETIC integration: Node ${process.version}; PostgreSQL ${runtime.postgresVersion}; owned disposable database; stub transport only`);
  const env = testEnvironment({TEST_DATABASE_URL: runtime.url,
    APP_INTEGRATION_DATABASE_URL: runtime.url, APP_INTEGRATION_RUN_DIR: runtime.directory,
    // The interrupt test starts its own owned cluster with the same server binaries.
    ...(process.env.APP_INTEGRATION_PG_BIN ? {APP_INTEGRATION_PG_BIN: process.env.APP_INTEGRATION_PG_BIN} : {}),
    ...(evidenceDirectory ? {APP_INTEGRATION_CAPTURE: join(runtime.directory, 'http-records.json'), APP_INTEGRATION_BACKEND_SHA: backendSha} : {})});
  await command('npm', ['run', 'typecheck'], {env});
  await command('npm', ['run', 'build'], {env});
  const paths = [];
  for (const folder of ['tests', 'tests/app-integration']) {
    for (const name of (await readdir(folder)).sort()) if (name.endsWith('.test.mjs')) paths.push(`${folder}/${name}`);
  }
  await command(process.execPath, ['--test', ...paths], {env});
  // Keep the capture private until validation AND resource cleanup have passed.
  if (evidenceDirectory) {
    assert.equal(verifiedBackendSource(), backendSha, 'Backend source changed during the run');
    raw = JSON.parse(await readFile(env.APP_INTEGRATION_CAPTURE, 'utf8'));
  }
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
if (passed && !process.exitCode) {
  let createdEvidence = false;
  try {
    if (evidenceDirectory) {
      assert.equal(verifiedBackendSource(), backendSha, 'Backend source changed before publication');
      await mkdir(evidenceDirectory, {mode: 0o700});
      createdEvidence = true;
      assert.ok(!process.exitCode, 'Interrupted before receipt publication');
      await writeCapture(evidenceDirectory, {...raw, suiteResult: 'pass', producerRevision: producerRevision()});
      assert.ok(!process.exitCode, 'Interrupted during receipt publication');
      console.log('Receipt written after passing validation and cleanup; check it with evidence/app-acceptance/check.mjs');
    }
    console.log('SYNTHETIC integration checks passed; no real notification delivery or product-evidence acceptance');
  } catch {
    // Roll back only this run's newly created receipt; preserve raw diagnostics.
    if (createdEvidence) await rm(join(evidenceDirectory, 'acceptance-receipt.json'), {force: true});
    console.error('Receipt publication failed; no acceptance claim is made');
    process.exitCode ||= 1;
  }
}
