// Opt-in provisional demo. An exact backend revision is mandatory; no old receipt is rebound.
import assert from 'node:assert/strict';
import {fork, spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {realpathSync} from 'node:fs';
import {mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import pg from 'pg';
import {command, stop, testEnvironment} from './runtime.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const protectedPaths = ['src', 'db', 'package.json', 'package-lock.json', 'tsconfig.json'];
function git(args, cwd = repo) {
  const result = spawnSync('git', args, {cwd, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024});
  assert.equal(result.status, 0, 'Exact backend Git object unavailable or source preparation failed');
  return result.stdout.trim();
}
export function assertDemoSource(directory, revision) {
  assert.equal(git(['rev-parse', 'HEAD'], directory), revision);
  git(['diff', '--exit-code', revision, '--', ...protectedPaths], directory);
  assert.equal(git(['ls-files', '--others', '--', ...protectedPaths], directory), '', 'Untracked or ignored backend source is not allowed');
}
async function messageFrom(child, start, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const ready = Promise.race([
      once(child, 'message', {signal: controller.signal}).then(([value]) => value),
      once(child, 'exit', {signal: controller.signal}).then(() => {throw Error('Demo child exited before readiness');}),
    ]);
    start?.();
    return await ready;
  } finally {clearTimeout(timer); controller.abort();}
}

export async function startDemoFixture({backendSha, port = 33446} = {}) {
  assert.ok(Number(process.versions.node.split('.')[0]) >= 24 && Number(process.versions.node.split('.')[0]) < 27, 'Use Node 24–26');
  assert.match(backendSha ?? '', /^[a-f0-9]{40}$/, 'An explicit full backend commit is required');
  assert.ok(Number.isInteger(port) && (port === 0 || port >= 1024 && port <= 65535), 'Invalid API port');
  assert.equal(git(['rev-parse', `${backendSha}^{commit}`]), backendSha);
  // Fail before creating a database when the design-only base has no actual demo issuer.
  git(['cat-file', '-e', `${backendSha}:src/demo.ts`]);
  const directory = await mkdtemp(join(tmpdir(), 'andes-q46-browser-demo-'));
  const backend = join(directory, 'backend');
  const clientEnds = [];
  let owner, api, pool, closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    try {await stop(api); await pool?.end(); await Promise.all(clientEnds);}
    finally {
      try {
        if (owner?.connected) {
          const exited = once(owner, 'exit');
          owner.send({type: 'cleanup'}); await exited;
        }
      } finally {await stop(owner); await rm(directory, {recursive: true, force: true});}
    }
  }
  try {
    git(['clone', '--shared', '--no-checkout', '--quiet', repo, backend]);
    git(['checkout', '--detach', '--quiet', backendSha], backend);
    assert.deepEqual(await readFile(join(backend, 'package-lock.json')), await readFile(join(repo, 'package-lock.json')), 'Candidate dependencies must match the installed harness lock');
    await symlink(join(repo, 'node_modules'), join(backend, 'node_modules'), 'dir');
    assertDemoSource(backend, backendSha);
    await command('npm', ['run', 'typecheck'], {cwd: backend});
    await command('npm', ['run', 'build'], {cwd: backend});
    assertDemoSource(backend, backendSha);
    const extra = {};
    for (const name of ['APP_INTEGRATION_PG_BIN', 'APP_INTEGRATION_PG_PORT']) {
      if (process.env[name]) extra[name] = process.env[name];
    }
    // No shared/admin database option: this demo always owns its loopback cluster.
    owner = fork(fileURLToPath(new URL('./browser-resources.mjs', import.meta.url)), [], {
      env: testEnvironment(extra), silent: true, execArgv: [], detached: true,
    });
    owner.stdout.resume(); owner.stderr.resume();
    const runtime = await messageFrom(owner, () => owner.send({type: 'create', directory}), 30000);
    assert.equal(runtime.failed, undefined, 'Owned demo PostgreSQL setup failed');
    const expiresAt = new Date(Date.now() + 600000).toISOString();
    pool = new pg.Pool({connectionString: runtime.url, max: 2});
    pool.on('connect', client => clientEnds.push(new Promise(resolve => client.once('end', resolve))));
    pool.on('error', () => {});
    const {migrate} = await import(pathToFileURL(join(backend, 'dist/db.js')));
    await migrate(pool);
    api = fork(fileURLToPath(new URL('./demo-api-process.mjs', import.meta.url)), [], {
      env: testEnvironment({DATABASE_URL: runtime.url, DEMO_MODE: 'true',
        APP_INTEGRATION_BACKEND_ROOT: backend, APP_INTEGRATION_API_PORT: String(port)}),
      cwd: backend, silent: true, execArgv: [],
    });
    api.stdout.resume(); api.stderr.resume();
    const ready = await messageFrom(api, null, 10000);
    assertDemoSource(backend, backendSha);
    const origin = `http://127.0.0.1:${ready.port}`;
    const postgresPid = Number((await readFile(join(runtime.directory, 'data/postmaster.pid'), 'utf8')).split('\n')[0]);
    const sourceFiles = ['demo-fixture.mjs', 'demo-api-process.mjs', 'browser-resources.mjs', 'runtime.mjs'];
    const sourceHashes = {};
    for (const name of sourceFiles) sourceHashes[name] = createHash('sha256').update(await readFile(new URL(name, import.meta.url))).digest('hex');
    const state = {state: 'running', classification: 'provisional', finalEvidence: false,
      backendSha, harnessCommit: git(['rev-parse', 'HEAD']), harnessSourceHashes: sourceHashes,
      api: {origin, pid: ready.pid, cwd: backend},
      postgres: {pid: postgresPid, port: Number(new URL(runtime.url).port),
        clusterDirectory: runtime.directory, database: new URL(runtime.url).pathname.slice(1)},
      demoMode: true, liveSend: false, channelSupport: [], workers: false, expiresAt};
    const statePath = join(directory, 'runtime-state.json');
    await writeFile(statePath, JSON.stringify(state, null, 2) + '\n', {mode: 0o600});
    return {origin, directory, backend, pool, backendSha, state, statePath,
      apiPid: ready.pid, databaseDirectory: runtime.directory, finalEvidence: false, close};
  } catch (error) {await close(); throw error;}
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let fixture;
  try {
    fixture = await startDemoFixture({backendSha: process.env.APP_INTEGRATION_BACKEND_SHA,
      port: Number(process.env.APP_INTEGRATION_API_PORT ?? 33446)});
    console.log(`PROVISIONAL SYNTHETIC runtime; exact backend ${fixture.backendSha}; finalEvidence=false; liveSend=false; no workers`);
    console.log(`Local: ${fixture.origin}`);
    console.log(`Runtime state: ${fixture.statePath}`);
    console.log('Actual POST /v1/demo/session creates one world; retain its role credentials in memory. Restart resets this owned world and signer. Ten-minute lifetime.');
    process.send?.({origin: fixture.origin, directory: fixture.directory, apiPid: fixture.apiPid,
      databaseDirectory: fixture.databaseDirectory, backendSha: fixture.backendSha});
    let stopping = false;
    const shutdown = async () => {
      if (stopping) return;
      stopping = true; clearTimeout(deadline);
      try {await fixture.close();}
      finally {if (process.connected) process.disconnect();}
    };
    const deadline = setTimeout(() => void shutdown(), 600000);
    for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.once(signal, () => void shutdown());
    process.once('disconnect', () => void shutdown());
  } catch {
    await fixture?.close();
    console.error('Demo runtime failed: require an exact backend with actual demo support, matching dependencies, free loopback ports and PostgreSQL15+');
    process.exitCode = 1;
  }
}
