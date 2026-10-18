// Isolated foundation + actual signed backend. No application/production login.
import assert from 'node:assert/strict';
import {fork, spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {realpathSync} from 'node:fs';
import {copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, isAbsolute, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {exportJWK, generateKeyPair, SignJWT} from 'jose';
import pg from 'pg';
import {command, stop, testEnvironment} from './runtime.mjs';
import {verifiedBackendSource} from './source-pin.mjs';

export const FOUNDATION_SHA = '6f8dc52a566d3880cf1f10bbfd5282a888725ca1';
export const BROWSER_CLIENT_SHA = 'db7034fc9e1dba035b87368117376e9730d6b830';
const repo = fileURLToPath(new URL('../../', import.meta.url));
function blob(revision, path) {
  const result = spawnSync('git', ['show', `${revision}:${path}`], {cwd: repo, maxBuffer: 2 * 1024 * 1024});
  assert.equal(result.status, 0, 'Fetch the frozen foundation/client Git objects');
  return result.stdout;
}

async function ownedResources(directory) {
  const extra = {};
  for (const key of ['APP_INTEGRATION_PG_BIN', 'APP_INTEGRATION_PG_PORT', 'APP_INTEGRATION_ADMIN_URL']) {
    if (process.env[key]) extra[key] = process.env[key];
  }
  const owner = fork(fileURLToPath(new URL('./browser-resources.mjs', import.meta.url)), [], {
    // The PTY may kill its entire foreground group. IPC still bounds this owner.
    env: testEnvironment(extra), silent: true, execArgv: [], detached: true,
  });
  owner.stdout.resume(); owner.stderr.resume();
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 30000);
  try {
    const ready = Promise.race([
      once(owner, 'message', {signal: abort.signal}).then(([value]) => value),
      once(owner, 'exit', {signal: abort.signal}).then(() => {throw Error('Fixture resource owner exited before readiness');}),
    ]);
    owner.send({type: 'create', directory});
    const result = await ready;
    assert.equal(result.failed, undefined, 'Fixture database setup failed; select the intended PostgreSQL binary directory');
    return {...result, cleanup: async () => {
      if (owner.exitCode !== null || owner.signalCode !== null) return;
      const exited = once(owner, 'exit'); owner.send({type: 'cleanup'}); await exited;
    }};
  } catch (error) {await stop(owner); throw error;}
  finally {clearTimeout(timer); abort.abort();}
}

export async function startBrowserFixture(dependencyRoot) {
  assert.ok(Number(process.versions.node.split('.')[0]) >= 24 && Number(process.versions.node.split('.')[0]) < 27, 'Use Node 24–26');
  process.chdir(repo);
  verifiedBackendSource();
  assert.ok(dependencyRoot && isAbsolute(dependencyRoot), 'Set APP_INTEGRATION_WEB_ROOT to an explicit installed web package');
  // Borrow only dependencies; render a fresh exact-source extraction, never the donor app.
  for (const name of ['package.json', 'package-lock.json']) {
    assert.deepEqual(await readFile(join(dependencyRoot, name)), blob(FOUNDATION_SHA, `web/${name}`), 'Dependency package must match the frozen foundation lock');
  }
  const directory = await mkdtemp(join(tmpdir(), 'andes-q46-browser-'));
  const web = join(directory, 'web');
  const previousEnvironment = process.env;
  let runtime, pool, api, server, vite, closed = false;
  const previews = new Set();
  async function close() {
    if (closed) return;
    closed = true;
    try {
      await Promise.allSettled([...previews].map(value => value.httpServer.closeAllConnections?.()));
      for (const value of previews) await new Promise(resolve => value.httpServer.close(resolve));
      await server?.close();
    } finally {
      try { await stop(api); await pool?.end(); }
      finally {
        try { await runtime?.cleanup(); }
        finally { process.chdir(repo); process.env = previousEnvironment; await rm(directory, {recursive: true, force: true}); }
      }
    }
  }
  try {
    runtime = await ownedResources(directory);
    const inventory = spawnSync('git', ['ls-tree', '-r', '--name-only', FOUNDATION_SHA, 'web'], {cwd: repo, encoding: 'utf8'});
    assert.equal(inventory.status, 0);
    for (const path of inventory.stdout.trim().split('\n')) {
      assert.ok(path.startsWith('web/') && !path.split('/').includes('..'));
      const target = join(directory, path);
      await mkdir(dirname(target), {recursive: true});
      await writeFile(target, blob(FOUNDATION_SHA, path));
    }
    await symlink(join(dependencyRoot, 'node_modules'), join(web, 'node_modules'), 'dir');
    const fixture = join(web, '__andes_fixture__');
    await mkdir(join(fixture, 'api'), {recursive: true});
    for (const name of ['index', 'client', 'session', 'errors', 'responses', 'types', 'journeys', 'driver', 'gateway']) {
      await writeFile(join(fixture, 'api', `${name}.ts`), blob(BROWSER_CLIENT_SHA, `web/src/lib/api/${name}.ts`));
    }
    await copyFile(fileURLToPath(new URL('./browser-bootstrap.mjs', import.meta.url)), join(fixture, 'bootstrap.mjs'));
    await writeFile(join(directory, 'package.json'), '{"type":"module"}\n');
    // Node's native TypeScript loader uses this explicit module boundary too.
    await writeFile(join(fixture, 'package.json'), '{"type":"module"}\n');
    pool = new pg.Pool({connectionString: runtime.url, max: 2});
    const {migrate} = await import(pathToFileURL(join(repo, 'dist/db.js')));
    await migrate(pool);
    const {publicKey, privateKey} = await generateKeyPair('RS256');
    const clock = join(runtime.directory, 'browser-clock.txt');
    await writeFile(clock, new Date().toISOString());
    api = fork(join(repo, 'scripts/app-integration/api-process.mjs'), [], {
      env: testEnvironment({APP_INTEGRATION_DATABASE_URL: runtime.url, APP_INTEGRATION_CLOCK: clock,
        APP_INTEGRATION_PUBLIC_JWK: JSON.stringify(await exportJWK(publicKey))}), silent: true, execArgv: [],
    });
    api.stdout.resume(); api.stderr.resume();
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 10000);
    let ready;
    try {
      ready = await Promise.race([
        once(api, 'message', {signal: abort.signal}).then(([value]) => value),
        once(api, 'exit', {signal: abort.signal}).then(() => {throw Error('Fixture API exited before readiness');}),
      ]);
    } finally {clearTimeout(timer); abort.abort();}
    const apiOrigin = `http://127.0.0.1:${ready.port}`;
    async function credentials() {
      const expires = Math.floor(Date.now() / 1000) + 600;
      const accessToken = await new SignJWT({phone_number: '+15555550146', phone_number_verified: true})
        .setProtectedHeader({alg: 'RS256'}).setIssuer('https://andes-integration.invalid').setAudience('andes-q46')
        .setSubject('synthetic-browser-driver').setIssuedAt().setExpirationTime(expires).sign(privateKey);
      return {issuer: 'https://andes-integration.invalid', subject: 'synthetic-browser-driver', accessToken, expiresAt: expires * 1000};
    }
    process.chdir(web);
    process.env = testEnvironment({ANDES_API_PROXY_TARGET: apiOrigin, ANDES_ENABLE_TEST_HOOKS: '1', ANDES_WEB_PORT: '0'});
    vite = await import(pathToFileURL(join(web, 'node_modules/vite/dist/node/index.js')));
    const config = {root: web, configFile: join(web, 'vite.config.ts'), configLoader: 'runner',
      cacheDir: join(directory, 'vite-cache'), logLevel: 'error'};
    server = await vite.createServer({...config, server: {host: '127.0.0.1', port: 0, cors: false}, plugins: [{
      name: 'q46-synthetic-credentials',
      configureServer(value) {value.middlewares.use('/__andes_fixture__/credentials', async (req, res) => {
        const expected = `http://127.0.0.1:${value.httpServer.address().port}`;
        res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'application/json');
        if (req.method !== 'POST' || req.headers.origin !== expected || req.headers.host !== new URL(expected).host
            || req.headers['x-andes-fixture'] !== 'synthetic-only') {
          res.statusCode = 403; res.end('{"code":"fixture_denied"}'); return;
        }
        try {res.end(JSON.stringify(await credentials()));}
        catch {res.statusCode = 503; res.end('{"code":"fixture_unavailable"}');}
      });},
    }]});
    await server.listen();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    async function productionPreview(configured = true) {
      if (configured) {
        await vite.build({...config, mode: 'production', build: {outDir: join(directory, 'production')}});
      }
      process.env.ANDES_API_PROXY_TARGET = configured ? apiOrigin : '';
      try {
        const preview = await vite.preview({...config, mode: 'production', build: {outDir: join(directory, 'production')}, preview: {host: '127.0.0.1', port: 0}});
        previews.add(preview);
        return `http://127.0.0.1:${preview.httpServer.address().port}`;
      } finally {process.env.ANDES_API_PROXY_TARGET = apiOrigin;}
    }
    return {origin, directory, pool, clientModule: join(fixture, 'api/index.ts'), productionPreview, close};
  } catch (error) {await close(); throw error;}
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let fixture;
  try {
    process.chdir(repo); verifiedBackendSource();
    await command('npm', ['run', 'typecheck']); await command('npm', ['run', 'build']);
    fixture = await startBrowserFixture(process.env.APP_INTEGRATION_WEB_ROOT);
    console.log(`SYNTHETIC browser fixture: foundation ${FOUNDATION_SHA}; client ${BROWSER_CLIENT_SHA}; real local signed API/PostgreSQL`);
    console.log(`Local: ${fixture.origin}/session`);
    console.log('Mount: import /__andes_fixture__/bootstrap.mjs and call mountSession(); synthetic credentials stay in memory');
    // IPC is only for the bounded lifecycle test; it contains no credentials.
    process.send?.({origin: fixture.origin, directory: fixture.directory});
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
  } catch (error) {
    await fixture?.close();
    console.error('Synthetic browser fixture failed; check frozen source, dependency root and documented prerequisites');
    if (error.message.startsWith('Integration database setup failed (')) {
      console.error(error.message + '; set APP_INTEGRATION_PG_BIN to the intended PostgreSQL 15+ binary directory');
    }
    process.exitCode = 1;
  }
}
