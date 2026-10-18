// Disposable local test resources. This module never reads the application's .env.
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp, mkdir, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {randomBytes} from 'node:crypto';
import pg from 'pg';

export function localAdminUrl(value) {
  const url = new URL(value);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol), 'PostgreSQL URL required');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Only explicit loopback database hosts allowed');
  assert.equal(url.search, '', 'Database URL options are not allowed');
  return url;
}

export function runDatabaseUrl(value) {
  const url = new URL(value);
  assert.match(url.pathname, /^\/andes_q46_[a-f0-9]{16}$/, 'Only an owned integration database is allowed');
  if (url.searchParams.has('host')) {
    assert.match(url.searchParams.get('host'), /^\/.*\/andes-q46-[^/]+\/socket$/, 'Only private run sockets allowed');
    assert.equal([...url.searchParams.keys()].join(','), 'host');
    assert.equal(url.hostname, 'localhost');
  } else {
    localAdminUrl(value);
  }
  return url;
}

export function testEnvironment(extra = {}) {
  return {
    PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
    LANG: 'C.UTF-8', ZAVU_LIVE_SEND: 'false', ANDES_APP_INTEGRATION: 'synthetic-only',
    ...extra,
  };
}

export async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  try { await exited; } finally { clearTimeout(timer); }
}

const running = new Set();
let interrupted = false;
// SIGINT/SIGTERM: stop current commands and start no new ones, so the caller's
// normal finally path drops the database, stops PostgreSQL and removes the directory.
export function onInterrupt() {
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    interrupted = true;
    process.exitCode = signal === 'SIGINT' ? 130 : 143;
    for (const child of running) child.kill('SIGTERM');
  });
}

export async function command(file, args, options = {}) {
  assert.ok(!interrupted, 'Interrupted');
  const child = spawn(file, args, {stdio: 'inherit', env: testEnvironment(), ...options});
  running.add(child);
  const timer = setTimeout(() => child.kill('SIGKILL'), 120000);
  try {
    const [code, signal] = await once(child, 'exit');
    assert.equal(code, 0, `${file} failed (${signal ?? code})`);
  } finally { running.delete(child); clearTimeout(timer); await stop(child); }
}

export async function disposableDatabase() {
  const directory = await mkdtemp(join(tmpdir(), 'andes-q46-'));
  const database = `andes_q46_${randomBytes(8).toString('hex')}`;
  let postgres, admin, created = false;
  let stage = 'configuration';
  async function cleanup() {
    try {
      if (created) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    } finally {
      try { await admin?.end(); } finally {
        await stop(postgres);
        await rm(directory, {recursive: true, force: true});
      }
    }
  }
  try {
    let adminUrl;
    if (process.env.APP_INTEGRATION_ADMIN_URL) {
      adminUrl = localAdminUrl(process.env.APP_INTEGRATION_ADMIN_URL);
    } else {
      const configured = process.env.APP_INTEGRATION_PG_BIN;
      const discovery = configured ? null : spawnSync('pg_config', ['--bindir'], {encoding: 'utf8'});
      const bin = configured ?? discovery?.stdout?.trim();
      assert.ok(bin && (configured || discovery.status === 0), 'Install PostgreSQL 15+ or set APP_INTEGRATION_PG_BIN');
      const data = join(directory, 'data');
      const socket = join(directory, 'socket');
      await mkdir(socket, {mode: 0o700});
      const port = Number(process.env.APP_INTEGRATION_PG_PORT ?? 56446);
      assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535, 'Invalid integration PostgreSQL port');
      const probe = createServer();
      try {
        await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve); });
      } finally { if (probe.listening) await new Promise(resolve => probe.close(resolve)); }
      const password = randomBytes(24).toString('hex');
      stage = 'cluster initialization';
      const passwordFile = join(directory, 'init-password');
      let initialized;
      try {
        await writeFile(passwordFile, password + '\n', {mode: 0o600});
        initialized = spawnSync(join(bin, 'initdb'), ['-D', data, '-U', 'andes_q46', '--auth-local=trust', '--auth-host=scram-sha-256', '--pwfile=' + passwordFile, '--no-locale', '--encoding=UTF8'], {encoding: 'utf8', timeout: 30000});
      } finally { await rm(passwordFile, {force: true}); }
      assert.equal(initialized.status, 0, 'Could not initialize owned PostgreSQL cluster');
      // Loopback SCRAM and private Unix socket, never a shared service. Its own process group, so a
      // terminal Ctrl-C reaches only this runner, which drops the database before stopping it.
      postgres = spawn(join(bin, 'postgres'), ['-D', data, '-k', socket, '-h', '127.0.0.1', '-p', String(port), '-c', 'max_connections=100'], {stdio: 'ignore', detached: true});
      let startError;
      postgres.on('error', error => { startError = error; });
      adminUrl = new URL(`postgresql://andes_q46@127.0.0.1:${port}/postgres`);
      adminUrl.password = password;
      stage = 'owned cluster readiness';
      let ready = false;
      for (let i = 0; i < 100; i++) {
        const client = new pg.Client({connectionString: adminUrl.toString(), connectionTimeoutMillis: 200});
        try {
          await client.connect();
          const actualData = (await client.query('SHOW data_directory')).rows[0].data_directory;
          assert.equal(await realpath(actualData), await realpath(data), 'Wrong PostgreSQL instance');
          ready = true; break;
        }
        catch { assert.ok(!startError && postgres.exitCode === null, 'Owned PostgreSQL process failed'); await delay(100); }
        finally { await client.end().catch(() => {}); }
      }
      assert.ok(ready, 'Owned PostgreSQL readiness timed out');
    }
    stage = 'administrative connection';
    admin = new pg.Pool({connectionString: adminUrl.toString(), max: 1, connectionTimeoutMillis: 3000});
    const version = (await admin.query('SHOW server_version_num')).rows[0].server_version_num;
    assert.ok(Number(version) >= 150000, 'PostgreSQL 15+ required');
    stage = 'owned database creation';
    await admin.query(`CREATE DATABASE ${database}`);
    created = true;
    const url = new URL(adminUrl);
    url.pathname = '/' + database;
    runDatabaseUrl(url.toString());
    return {directory, url: url.toString(), postgresVersion: version, cleanup};
  } catch { await cleanup(); throw new Error(`Integration database setup failed (${stage})`); }
}
