import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture} from './helpers/runtime.mjs';

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
