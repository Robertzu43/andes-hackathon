// The production home screen is a demo start, not a session mint on render.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

test('home offers demo start without minting, and the phone routes are mounted', async t => {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const vite = await createServer({ root, configFile: fileURLToPath(new URL('../../vite.config.ts', import.meta.url)),
    logLevel: 'silent', server: { middlewareMode: true, hmr: false } });
  t.after(() => vite.close());
  const { renderHome, phoneRoutes } = await vite.ssrLoadModule('/tests/phone/home-render.tsx');
  let begins = 0;
  const journeySnapshot = { tripId: null, auth: { state: 'unknown' }, interaction: 'unknown', operations: {},
    incident: { data: null }, status: { data: null }, selection: null };
  const gateway = { getSnapshot: () => ({ state: 'signed-out', mode: 'demo' }), subscribe: () => () => {},
    begin: async () => { begins += 1; } };
  const runtime = { gateway, journey: { snapshot: () => journeySnapshot, subscribe: () => () => {} },
    api: {}, session: {}, familyApi: {}, familySession: {}, familyGateway: gateway };
  const html = renderHome(runtime);
  assert.match(html, /data-action="start-demo"/);
  assert.match(html, /Empezar/);
  assert.match(html, /número autorizado para la prueba/);
  assert.equal(begins, 0);
  const routes = phoneRoutes(runtime);
  for (const id of ['home', 'trucks', 'tripNew', 'activeTrip', 'checkIn', 'alerts', 'summary', 'contacts', 'privacy', 'invitation', 'contactTrip']) {
    assert.equal(typeof routes[id], 'function', id);
  }
});
