// Prove CI-service mode against our own server, preserving the input database.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {command, disposableDatabase, testEnvironment} from './runtime.mjs';

process.chdir(fileURLToPath(new URL('../../', import.meta.url)));
assert.equal(process.env.APP_INTEGRATION_ADMIN_URL, undefined, 'This control owns its server; do not supply another service');
let outer, control;
try {
  outer = await disposableDatabase();
  control = new pg.Pool({connectionString: outer.url, max: 1});
  await control.query('CREATE TABLE input_database_control (value text NOT NULL)');
  await control.query("INSERT INTO input_database_control VALUES ('synthetic-do-not-reset')");
  const before = (await control.query('SELECT datname FROM pg_database ORDER BY datname')).rows;
  await command(process.execPath, ['scripts/app-integration/run.mjs'], {
    env: testEnvironment({APP_INTEGRATION_ADMIN_URL: outer.url}),
  });
  assert.deepEqual((await control.query('SELECT value FROM input_database_control')).rows,
    [{value: 'synthetic-do-not-reset'}]);
  assert.deepEqual((await control.query('SELECT datname FROM pg_database ORDER BY datname')).rows, before,
    'Nested run must remove only its own database');
  console.log('CI seam passed: suite green; input database/control preserved; nested database cleaned');
} catch {
  console.error('CI seam control failed (connection details redacted)');
  process.exitCode = 1;
} finally {
  try { await control?.end(); } finally { await outer?.cleanup(); }
}
