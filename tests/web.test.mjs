import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture} from './helpers/runtime.mjs';
import {spawn, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import net from 'node:net';
import {generateKeyPair, SignJWT} from 'jose';

// A synthetic build shaped like web/dist (index.html, fingerprinted assets/, root files), with a secret just outside it.
function build(t) {
  const base = mkdtempSync(join(tmpdir(), 'andes-web-')); const root = join(base, 'dist');
  mkdirSync(join(root, 'assets'), {recursive: true});
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>SYNTHETIC app</title>');
  writeFileSync(join(root, 'assets', 'app-SYNTH.js'), 'export const synthetic = true;');
  writeFileSync(join(root, 'robots.txt'), 'User-agent: *');
  writeFileSync(join(base, 'secret.txt'), 'SYNTHETIC secret outside the build');
  t.after(() => rmSync(base, {recursive: true, force: true}));
  return root;
}
const get = (f, url) => f.app.inject({method: 'GET', url});

test('the app shell and its files load without a token; every /v1 path stays authenticated JSON', async t => {
  const f = await fixture(t, {webRoot: build(t)});
  for (const url of ['/', '/trips/11111111-1111-4111-8111-111111111111', '/contact/invitations/22222222-2222-4222-8222-222222222222?x=1']) {
    const r = await get(f, url);
    assert.equal(r.statusCode, 200, url); assert.match(r.headers['content-type'], /^text\/html/, url);
    assert.equal(r.body, '<!doctype html><title>SYNTHETIC app</title>', url); assert.equal(r.headers['cache-control'], 'no-store', url);
  }
  const asset = await get(f, '/assets/app-SYNTH.js');
  assert.equal(asset.statusCode, 200); assert.match(asset.headers['content-type'], /^text\/javascript/);
  assert.equal(asset.headers['cache-control'], 'public, max-age=31536000, immutable');
  const robots = await get(f, '/robots.txt');
  assert.equal(robots.body, 'User-agent: *'); assert.equal(robots.headers['cache-control'], 'no-cache');
  for (const url of ['/assets/missing.js', '/index.php', '/assets/app-SYNTH.map']) {
    const r = await get(f, url); assert.equal(r.statusCode, 404, url); assert.deepEqual(r.json(), {code: 'not_found'}, url);
  }
  for (const url of ['/v1/me', '/v1/unknown', '/v1']) {
    const r = await get(f, url); assert.equal(r.statusCode, 401, url); assert.deepEqual(r.json(), {code: 'unauthorized'}, url);
  }
  assert.deepEqual(await f.req('GET', '/v1/unknown'), {status: 404, body: {code: 'not_found'}});
  assert.equal((await get(f, '/mapa')).statusCode, 200, 'existing public routes keep priority');
  assert.deepEqual((await get(f, '/health')).json(), {status: 'ok'});
});

test('paths that climb out of the build are refused, even unnormalized over real HTTP', async t => {
  const f = await fixture(t, {webRoot: build(t)});
  const origin = new URL(await f.app.listen({port: 0, host: '127.0.0.1'}));
  const raw = path => new Promise((resolve, reject) => http.get({host: origin.hostname, port: origin.port, path}, response => {
    let body = ''; response.setEncoding('utf8');
    response.on('data', chunk => { body += chunk; }); response.on('end', () => resolve({status: response.statusCode, body}));
  }).on('error', reject));
  assert.equal((await raw('/robots.txt')).status, 200, 'positive control: raw requests reach the build');
  for (const path of ['/../secret.txt', '/assets/../../secret.txt', '/..%2fsecret.txt', '/assets/..%2f..%2fsecret.txt', '/%2e%2e/secret.txt', '/..\\secret.txt']) {
    const response = await raw(path);
    // 404 from our guard; the router may reject a malformed path with 400 first. Either way the secret never leaves.
    assert.ok([400, 404].includes(response.status), `${path}: ${response.status}`); assert.doesNotMatch(response.body, /SYNTHETIC secret/, path);
  }
});

test('without a web build the API refuses to start instead of serving 404s', async t => {
  const f = await fixture(t);
  const {createApp} = await import('../dist/api/app.js'); const {createContext} = await import('../dist/db.js');
  const ctx = createContext(f.ctx.pool.options.connectionString, f.ctx.clock);
  try {
    assert.throws(() => createApp({ctx, auth: {issuer: 'https://synthetic.test', audience: 'andes-test', keyResolver: async () => { throw new Error('unused'); }},
      webRoot: join(tmpdir(), `andes-no-build-${process.pid}`)}), /index\.html/);
  } finally { await ctx.close(); }
});

test('one trusted proxy hop: a client-forged X-Forwarded-For entry never becomes request.ip', async t => {
  const f = await fixture(t);
  const {createApp} = await import('../dist/api/app.js'); const {createContext} = await import('../dist/db.js');
  const {publicKey, privateKey} = await generateKeyPair('RS256');
  const token = await new SignJWT({}).setProtectedHeader({alg: 'RS256'}).setIssuer('https://synthetic.test').setAudience('andes-test')
    .setSubject('ip-probe').setIssuedAt().setExpirationTime('5m').sign(privateKey);
  async function ipFor(hops, forwarded) {
    const app = createApp({ctx: createContext(f.ctx.pool.options.connectionString, f.ctx.clock),
      auth: {issuer: 'https://synthetic.test', audience: 'andes-test', keyResolver: async () => publicKey}, ...(hops === undefined ? {} : {trustProxyHops: hops})});
    app.get('/v1/test/ip', request => ({ip: request.ip}));
    try { return (await app.inject({method: 'GET', url: '/v1/test/ip', headers: {authorization: `Bearer ${token}`, 'x-forwarded-for': forwarded}})).json().ip; }
    finally { await app.close(); }
  }
  assert.equal(await ipFor(1, '198.51.100.7'), '198.51.100.7', 'the client the proxy saw');
  assert.equal(await ipFor(1, '203.0.113.9, 198.51.100.7'), '198.51.100.7', 'an entry the client wrote is ignored');
  assert.equal(await ipFor(undefined, '198.51.100.7'), '127.0.0.1', 'createApp trusts no proxy unless told');
  assert.equal(await ipFor(0, '198.51.100.7'), '127.0.0.1');
});

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const {port} = server.address();
      server.close(() => resolve(port));
    });
  });
}
// The server entry has no IP route. This loader adds request.ip to the public health body for this test only.
function proxyProbe(t) {
  const hook = join(tmpdir(), `andes-proxy-probe-${process.pid}-${Date.now()}.mjs`);
  const code = `export async function load(url, context, nextLoad) {
  if (!url.endsWith('/dist/api/app.js')) return nextLoad(url, context);
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const needle = "return { status: 'ok' };";
  const source = readFileSync(fileURLToPath(url), 'utf8');
  if (!source.includes(needle)) throw new Error('proxy probe missed the health body');
  return { format: 'module', source: source.replace(needle, "return { status: 'ok', ip: _request.ip };"), shortCircuit: true };
}`;
  writeFileSync(hook, `import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(${JSON.stringify(code)}));
`);
  t.after(() => rmSync(hook, {force: true}));
  return hook;
}
async function listen(t, hook, hops) {
  const port = await freePort();
  const env = {PATH: process.env.PATH, DEMO_MODE: 'true', HOST: '127.0.0.1', PORT: String(port), DATABASE_URL: process.env.TEST_DATABASE_URL};
  if (hops !== undefined) env.TRUST_PROXY_HOPS = hops;
  // Own process group: this server must not share signals with the suite or a sibling integration run.
  const child = spawn(process.execPath, ['--import', hook, fileURLToPath(new URL('../dist/server.js', import.meta.url))], {env, detached: true, stdio: ['ignore', 'ignore', 'pipe']});
  let stderr = '';
  child.stderr.setEncoding('utf8'); child.stderr.on('data', chunk => { stderr += chunk; });
  t.after(() => { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already exited */ } });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {headers: {'x-forwarded-for': '198.51.100.7'}});
      if (response.status === 200) return response.json();
    } catch { /* not listening yet */ }
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error(`server did not serve health (TRUST_PROXY_HOPS=${hops}): ${stderr}`);
}

test('an unset TRUST_PROXY_HOPS ignores a client-written X-Forwarded-For', async t => {
  const root = fileURLToPath(new URL('../web/dist', import.meta.url));
  const index = join(root, 'index.html');
  const previous = existsSync(index) ? readFileSync(index) : null;
  mkdirSync(root, {recursive: true});
  writeFileSync(index, '<!doctype html><title>SYNTHETIC app</title>');
  t.after(() => { if (previous === null) rmSync(index, {force: true}); else writeFileSync(index, previous); });
  const hook = proxyProbe(t);
  assert.equal((await listen(t, hook, undefined)).ip, '127.0.0.1', 'a direct client cannot choose request.ip');
  assert.equal((await listen(t, hook, '1')).ip, '198.51.100.7', 'one configured hop still trusts the proxy');
});

test('the server refuses a TRUST_PROXY_HOPS that is not a small integer', () => {
  const server = fileURLToPath(new URL('../dist/server.js', import.meta.url));
  for (const hops of ['true', '-1', '1.5', '4']) {
    const run = spawnSync(process.execPath, [server], {encoding: 'utf8', timeout: 20000, env: {PATH: process.env.PATH, DEMO_MODE: 'true', TRUST_PROXY_HOPS: hops}});
    assert.equal(run.status, 1, hops); assert.match(run.stderr, /TRUST_PROXY_HOPS must be an integer from 0 to 3/, hops);
  }
});
