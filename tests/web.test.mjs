import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {generateKeyPair, SignJWT} from 'jose';
import {fixture} from './helpers/runtime.mjs';

const shell = '<!doctype html><title>SYNTHETIC app</title>';
// A synthetic Vite build, with synthetic data just outside it to detect escaping reads.
function build(t) {
  const base = mkdtempSync(join(tmpdir(), 'andes-web-')); const root = join(base, 'dist');
  mkdirSync(join(root, 'assets'), {recursive: true});
  writeFileSync(join(root, 'index.html'), shell);
  writeFileSync(join(root, 'assets', 'app-SYNTH.js'), 'export const synthetic = true;');
  writeFileSync(join(root, 'assets', 'app-SYNTH.css'), 'body { color: black; }');
  writeFileSync(join(root, 'robots.txt'), 'User-agent: *');
  writeFileSync(join(root, 'empty.txt'), '');
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
    assert.equal(r.body, shell, url); assert.equal(r.headers['cache-control'], 'no-store', url);
  }
  for (const [url, type, body] of [
    ['/assets/app-SYNTH.js?x=1', /^text\/javascript/, 'export const synthetic = true;'],
    ['/assets/app-SYNTH.css', /^text\/css/, 'body { color: black; }']
  ]) {
    const r = await get(f, url);
    assert.equal(r.statusCode, 200, url); assert.match(r.headers['content-type'], type, url);
    assert.equal(r.body, body); assert.equal(r.headers['cache-control'], 'public, max-age=31536000, immutable');
  }
  const robots = await get(f, '/robots.txt');
  assert.equal(robots.body, 'User-agent: *'); assert.match(robots.headers['content-type'], /^text\/plain/);
  assert.equal(robots.headers['cache-control'], 'no-cache');
  assert.equal((await get(f, '/index.html')).body, shell);
  const empty = await get(f, '/empty.txt');
  assert.equal(empty.statusCode, 200); assert.equal(empty.body, '');
  const head = await f.app.inject({method: 'HEAD', url: '/assets/app-SYNTH.js'});
  assert.equal(head.statusCode, 200); assert.equal(head.body, '');
  assert.match(head.headers['content-type'], /^text\/javascript/);
  for (const url of ['/assets/missing.js', '/index.php', '/assets/app-SYNTH.map']) {
    const r = await get(f, url); assert.equal(r.statusCode, 404, url); assert.deepEqual(r.json(), {code: 'not_found'}, url);
  }
  for (const url of ['/v1/me', '/v1/unknown', '/v1', '/v1?x=1', '/v1/', '/v1/unknown.js', '/%76%31/unknown', '/v1%2funknown']) {
    const r = await get(f, url); assert.equal(r.statusCode, 401, url); assert.deepEqual(r.json(), {code: 'unauthorized'}, url);
  }
  for (const url of ['/v1/unknown', '/v1', '/v1/unknown.js', '/v1%2funknown']) {
    assert.deepEqual(await f.req('GET', url), {status: 404, body: {code: 'not_found'}}, url);
  }
  assert.equal((await f.req('GET', '/v1/me')).status, 200);
  const map = await get(f, '/mapa');
  assert.equal(map.statusCode, 200); assert.match(map.body, /Robos e intentos de robo en carretera/);
  assert.deepEqual((await get(f, '/health')).json(), {status: 'ok'});
  const hotspots = await get(f, '/v1/insights/hotspots');
  assert.equal(hotspots.statusCode, 200); assert.deepEqual(hotspots.json().cells, []);
});

test('paths that climb out of the build are refused before SPA fallback, even over raw HTTP', async t => {
  const f = await fixture(t, {webRoot: build(t)});
  const origin = new URL(await f.app.listen({port: 0, host: '127.0.0.1'}));
  const raw = path => new Promise((resolve, reject) => http.get({host: origin.hostname, port: origin.port, path}, response => {
    let body = ''; response.setEncoding('utf8');
    response.on('data', chunk => { body += chunk; }); response.on('end', () => resolve({status: response.statusCode, body}));
  }).on('error', reject));
  assert.equal((await raw('/robots.txt')).status, 200, 'positive control: raw requests reach the build');
  for (const path of [
    '/../secret.txt', '/assets/../../secret.txt', '/..%2fsecret.txt', '/assets/..%2f..%2fsecret.txt', '/%2e%2e/secret.txt', '/..\\secret.txt',
    '/../private', '/assets/../../private', '/%2e%2e/private', '/assets/%2e%2e%2f%2e%2e/private',
    '/%2e%2e%5cprivate', '/..\\private', '/trips/%00', '/assets/app-SYNTH.js%00', '/%zz'
  ]) {
    const response = await raw(path);
    // The router can reject malformed paths with 400 before our JSON 404 guard runs.
    assert.ok([400, 404].includes(response.status), `${path}: ${response.status}`);
    assert.doesNotMatch(response.body, /SYNTHETIC secret|SYNTHETIC app/, path);
  }
});

test('static reads reject file and directory symlinks outside the build, including a sibling with the same prefix', async t => {
  const root = build(t); const base = dirname(root);
  mkdirSync(join(base, 'dist-sibling'));
  writeFileSync(join(base, 'dist-sibling', 'secret.txt'), 'SYNTHETIC secret in a sibling');
  symlinkSync(join(base, 'secret.txt'), join(root, 'assets', 'leak.txt'));
  symlinkSync(base, join(root, 'outside'));
  symlinkSync(join(base, 'dist-sibling'), join(root, 'sibling'));
  symlinkSync(join(root, 'robots.txt'), join(root, 'alias.txt'));
  const f = await fixture(t, {webRoot: root});
  assert.equal((await get(f, '/alias.txt')).body, 'User-agent: *', 'confined symlinks remain readable');
  for (const url of ['/assets/leak.txt', '/outside/secret.txt', '/sibling/secret.txt']) {
    const response = await get(f, url);
    assert.equal(response.statusCode, 404, url); assert.deepEqual(response.json(), {code: 'not_found'}, url);
    assert.doesNotMatch(response.body, /SYNTHETIC secret/, url);
  }
});

test('the demo session and callback keep their existing public handlers with a web build', async t => {
  const {demoIssuer} = await import('../dist/demo.js'); const demo = await demoIssuer({});
  const f = await fixture(t, {webRoot: build(t), auth: demo.auth, demo,
    callbackConfig: {projectId: 'prj_fixture', senderId: 'snd_fixture', secret: 'syntheticfixture-secret'}});
  const session = await f.app.inject({method: 'POST', url: '/v1/demo/session', payload: {}});
  assert.equal(session.statusCode, 200); assert.equal(session.json().synthetic, true);
  const callback = await f.app.inject({method: 'POST', url: '/v1/callbacks/zavu', payload: {}});
  assert.equal(callback.statusCode, 401); assert.equal(callback.json().code, 'invalid_callback');
});

async function assertInvalidBuild(t, root) {
  const f = await fixture(t);
  const {createApp} = await import('../dist/api/app.js'); const {createContext} = await import('../dist/db.js');
  const ctx = createContext(f.ctx.pool.options.connectionString, f.ctx.clock);
  try {
    assert.throws(() => createApp({ctx, auth: {issuer: 'https://synthetic.test', audience: 'andes-test', keyResolver: async () => { throw new Error('unused'); }},
      webRoot: root}), /index\.html/);
  } finally { await ctx.close(); }
}

test('without a web build the API refuses to start instead of serving 404s', async t => {
  await assertInvalidBuild(t, join(dirname(build(t)), 'missing-dist'));
});

test('a build directory without index.html fails at startup', async t => {
  const root = build(t); rmSync(join(root, 'index.html'));
  await assertInvalidBuild(t, root);
});

test('a symlinked index.html outside the build fails before reading the shell', async t => {
  const root = build(t); rmSync(join(root, 'index.html'));
  symlinkSync(join(dirname(root), 'secret.txt'), join(root, 'index.html'));
  await assertInvalidBuild(t, root);
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
    try {
      const response = await app.inject({method: 'GET', url: '/v1/test/ip', headers: {authorization: `Bearer ${token}`, 'x-forwarded-for': forwarded}});
      assert.equal(response.statusCode, 200); return response.json().ip;
    } finally { await app.close(); }
  }
  assert.equal(await ipFor(1, '198.51.100.7'), '198.51.100.7', 'the client the proxy saw');
  assert.equal(await ipFor(1, '203.0.113.9, 198.51.100.7'), '198.51.100.7', 'an entry the client wrote is ignored');
  assert.equal(await ipFor(undefined, '198.51.100.7'), '127.0.0.1', 'createApp trusts no proxy unless told');
  assert.equal(await ipFor(0, '198.51.100.7'), '127.0.0.1');
  assert.equal(await ipFor(2, '203.0.113.9, 198.51.100.7, 192.0.2.4'), '198.51.100.7');
  assert.equal(await ipFor(3, '203.0.113.9, 198.51.100.7, 192.0.2.4'), '203.0.113.9');
});

test('the server refuses a TRUST_PROXY_HOPS that is not a small integer', async t => {
  const server = fileURLToPath(new URL('../dist/server.js', import.meta.url));
  for (const hops of ['true', '-1', '1.5', '4', '', ' ', '\t\r\n', 'NaN', 'Infinity']) {
    await t.test(`TRUST_PROXY_HOPS=${JSON.stringify(hops)}`, () => {
      const run = spawnSync(process.execPath, [server], {encoding: 'utf8', timeout: 20000, env: {PATH: process.env.PATH, DEMO_MODE: 'true', TRUST_PROXY_HOPS: hops}});
      assert.equal(run.status, 1); assert.match(run.stderr, /TRUST_PROXY_HOPS must be an integer from 0 to 3/);
    });
  }
});

test('the server accepts the default TRUST_PROXY_HOPS and every supported hop count', () => {
  const server = fileURLToPath(new URL('../dist/server.js', import.meta.url));
  for (const hops of [undefined, '0', '1', '2', '3']) {
    const run = spawnSync(process.execPath, [server], {encoding: 'utf8', timeout: 20000,
      env: {PATH: process.env.PATH, DEMO_MODE: 'true', ...(hops === undefined ? {} : {TRUST_PROXY_HOPS: hops})}});
    assert.equal(run.status, 1, `TRUST_PROXY_HOPS=${hops}`);
    assert.match(run.stderr, /Database URL or complete PostgreSQL components required/, `TRUST_PROXY_HOPS=${hops} reaches database validation`);
  }
});
