import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {existsSync, mkdtempSync, readdirSync, rmSync} from 'node:fs';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import pg from 'pg';
import {disposableDatabase, testEnvironment} from '../../scripts/app-integration/runtime.mjs';

// Start a nested run in its own process group, wait until its database exists, then interrupt it.
// The nested run only typechecks before the signal, so it never rewrites this checkout's dist/.
async function interruptRun({temp, group, signal, env}) {
  const child = spawn(process.execPath, ['scripts/app-integration/run.mjs'], {detached: true,
    stdio: ['ignore', 'pipe', 'inherit'], env: testEnvironment({TMPDIR: temp, ...env})});
  const exited = once(child, 'exit');
  let output = '', sent = false;
  child.stdout.on('data', chunk => {
    output += chunk;
    if (!sent && output.includes('SYNTHETIC integration:')) { sent = true; process.kill(group ? -child.pid : child.pid, signal); }
  });
  const timer = setTimeout(() => process.kill(-child.pid, 'SIGKILL'), 60000);
  try { await exited; } finally { clearTimeout(timer); }
  assert.ok(sent, 'The nested run must reach its database before the signal');
  return {code: child.exitCode, signal: child.signalCode};
}

async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const {port} = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

for (const signal of ['SIGINT', 'SIGTERM']) test(`${signal} on an owned-cluster run stops its PostgreSQL and removes its directory`, {timeout: 90000}, async t => {
  const discovery = process.env.APP_INTEGRATION_PG_BIN ? null : spawnSync('pg_config', ['--bindir'], {encoding: 'utf8'});
  const bin = process.env.APP_INTEGRATION_PG_BIN ?? (discovery.status === 0 ? discovery.stdout.trim() : '');
  if (!existsSync(join(bin, 'initdb'))) return t.skip('No PostgreSQL server binaries for an owned cluster');
  const port = await freePort();
  // Short prefix: the owned cluster's Unix socket path must stay under the 103-byte limit.
  const temp = mkdtempSync(join(tmpdir(), 'q46-'));
  t.after(() => {
    // Only for a failing run: stop a leaked cluster before removing its directory.
    for (const name of readdirSync(temp)) {
      spawnSync(join(bin, 'pg_ctl'), ['-D', join(temp, name, 'data'), 'stop', '-m', 'immediate'], {stdio: 'ignore'});
    }
    rmSync(temp, {recursive: true, force: true});
  });
  // Terminal Ctrl-C signals the whole foreground process group.
  const run = await interruptRun({temp, group: true, signal, env: {APP_INTEGRATION_PG_BIN: bin, APP_INTEGRATION_PG_PORT: String(port)}});
  assert.equal(run.code, signal === 'SIGINT' ? 130 : 143, `Exit after cleanup, not killed by ${run.signal}`);
  assert.deepEqual(readdirSync(temp), [], 'The run directory and cluster data must be removed');
  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve); });
  await new Promise(resolve => probe.close(resolve));
});

for (const signal of ['SIGINT', 'SIGTERM']) test(`${signal} on a shared-server run drops only its own database`, {timeout: 90000}, async t => {
  // Own the entire control server: other test files create/drop databases concurrently.
  // Never infer ownership from a prefix or sweep databases belonging to sibling tests.
  const discovery = process.env.APP_INTEGRATION_PG_BIN ? null : spawnSync('pg_config', ['--bindir'], {encoding: 'utf8'});
  const bin = process.env.APP_INTEGRATION_PG_BIN ?? (discovery.status === 0 ? discovery.stdout.trim() : '');
  if (!existsSync(join(bin, 'initdb'))) return t.skip('No PostgreSQL server binaries for an isolated shared-server control');
  const previousPort = process.env.APP_INTEGRATION_PG_PORT;
  process.env.APP_INTEGRATION_PG_PORT = String(await freePort());
  let server;
  try { server = await disposableDatabase(); }
  finally {
    if (previousPort === undefined) delete process.env.APP_INTEGRATION_PG_PORT;
    else process.env.APP_INTEGRATION_PG_PORT = previousPort;
  }
  const pool = new pg.Pool({connectionString: server.url, max: 1});
  t.after(async () => {try { await pool.end(); } finally { await server.cleanup(); }});
  await pool.query('CREATE TABLE interruption_control (value text NOT NULL)');
  await pool.query("INSERT INTO interruption_control VALUES ('synthetic-do-not-reset')");
  const databases = async () => (await pool.query('SELECT datname FROM pg_database ORDER BY datname')).rows.map(row => row.datname);
  const temp = mkdtempSync(join(tmpdir(), 'q46-'));
  const before = await databases();
  t.after(async () => {
    rmSync(temp, {recursive: true, force: true});
  });
  // Signal just the runner, as when a supervisor cancels a shared-server run.
  const run = await interruptRun({temp, group: false, signal, env: {APP_INTEGRATION_ADMIN_URL: server.url}});
  assert.equal(run.code, signal === 'SIGINT' ? 130 : 143, `Exit after cleanup, not killed by ${run.signal}`);
  assert.deepEqual(await databases(), before, 'The nested database must be dropped and nothing else touched');
  assert.deepEqual((await pool.query('SELECT value FROM interruption_control')).rows,
    [{value: 'synthetic-do-not-reset'}], 'The shared input database must retain its sentinel');
  assert.deepEqual(readdirSync(temp), []);
});
