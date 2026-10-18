import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture } from './helpers/runtime.mjs';

// printRoutes is a tree. Reconstruct method + URL so a new route cannot skip this allowlist.
function routesOf(tree) {
  const routes = [];
  const stack = [];
  for (const line of tree.split('\n')) {
    if (!line.trim()) continue;
    const match = line.match(/^(?<indent>(?:[│ ]{4})*)(?:├── |└── )(?<body>.*)$/);
    if (!match?.groups) throw new Error(`unparsed route line: ${line}`);
    const depth = match.groups.indent.length / 4;
    const methods = match.groups.body.match(/^(?<segment>.*?) \((?<methods>[^)]+)\)$/);
    stack.length = depth;
    stack[depth] = methods?.groups?.segment ?? match.groups.body;
    if (!methods?.groups) continue;
    const url = stack.join('');
    for (const method of methods.groups.methods.split(', ')) routes.push(`${method} ${url}`);
  }
  return routes.sort();
}

const alwaysPublic = [
  'GET /health', 'HEAD /health',
  'GET /mapa', 'HEAD /mapa',
  'GET /v1/insights/hotspots', 'HEAD /v1/insights/hotspots',
].sort();

async function openRoutes(app) {
  const routes = routesOf(app.printRoutes());
  const open = [];
  for (const route of routes) {
    const space = route.indexOf(' ');
    const method = route.slice(0, space);
    const url = route.slice(space + 1).replace(/:[A-Za-z]+/g, '00000000-0000-4000-8000-000000000001');
    const response = await app.inject({ method, url, payload: method === 'GET' || method === 'HEAD' ? undefined : {} });
    // HEAD has no body, so a 401 is the authenticator. A signed-callback rejection is also 401, but its code is invalid_callback.
    let code;
    try { code = response.json().code; } catch { code = undefined; }
    const blocked = response.statusCode === 401 && (code === undefined || code === 'unauthorized');
    if (!blocked) open.push(route);
  }
  return { routes, open: open.sort() };
}

test('unauthenticated requests are accepted only on the public route allowlist', async t => {
  const closed = await fixture(t);
  const without = await openRoutes(closed.app);
  assert.ok(without.routes.length > alwaysPublic.length);
  assert.deepEqual(without.open, alwaysPublic);
  assert.equal((await closed.app.inject({ method: 'POST', url: '/v1/demo/session', payload: {} })).json().code, 'unauthorized');
  assert.equal((await closed.app.inject({ method: 'POST', url: '/v1/callbacks/zavu', payload: {} })).json().code, 'unauthorized');

  const { demoIssuer } = await import('../dist/demo.js');
  const opened = await fixture(t, {
    demo: await demoIssuer({}),
    callbackConfig: { projectId: 'prj_fixture', senderId: 'snd_fixture', secret: 'fixture-secret-not-a-credential' },
  });
  const withExtras = await openRoutes(opened.app);
  assert.deepEqual(withExtras.open, [...alwaysPublic, 'POST /v1/callbacks/zavu', 'POST /v1/demo/session'].sort());
  assert.equal((await opened.app.inject({ method: 'POST', url: '/v1/callbacks/zavu', payload: {} })).json().code, 'invalid_callback');
});

test('webRoot adds only the built app to the public allowlist', async t => {
  const root = mkdtempSync(join(tmpdir(), 'andes-web-'));
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>SYNTHETIC app</title>');
  writeFileSync(join(root, 'assets', 'app-SYNTH.js'), 'export const synthetic = true;');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const f = await fixture(t, { webRoot: root });
  const shell = ['GET /', 'HEAD /', 'GET /*', 'HEAD /*'];
  assert.deepEqual((await openRoutes(f.app)).open, [...alwaysPublic, ...shell].sort());
  assert.equal((await f.app.inject({ method: 'GET', url: '/' })).body, '<!doctype html><title>SYNTHETIC app</title>');
  assert.equal((await f.app.inject({ method: 'GET', url: '/assets/app-SYNTH.js' })).body, 'export const synthetic = true;');
  assert.equal((await f.app.inject({ method: 'GET', url: '/v1/me' })).json().code, 'unauthorized');
});
