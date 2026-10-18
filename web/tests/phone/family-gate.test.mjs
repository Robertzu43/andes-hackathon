// FamilyGate is the only door into the seeded contact view.
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { installDom } from './dom-shim.mjs';

installDom();

function familyRuntime(familyGateway) {
  const idle = { getSnapshot: () => ({ state: 'signed-out', mode: 'demo' }), subscribe: () => () => {} };
  return { gateway: idle, familyGateway, api: {}, session: {}, familyApi: {}, familySession: {},
    journey: { snapshot: () => ({}), subscribe: () => () => {} } };
}
function gateway(state, begin) {
  const snapshot = { state, mode: 'demo' };
  return { getSnapshot: () => snapshot, subscribe: () => () => {}, begin };
}

test('FamilyGate shows contactFailed when begin() rejects', async t => {
  const { createServer } = await import('vite');
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const vite = await createServer({ root, configFile: fileURLToPath(new URL('../../vite.config.ts', import.meta.url)),
    logLevel: 'silent', server: { middlewareMode: true, hmr: false } });
  t.after(() => vite.close());
  const { renderContactGate } = await vite.ssrLoadModule('/tests/phone/family-render.tsx');
  let begins = 0;
  const view = await renderContactGate(familyRuntime(gateway('signed-out', () => {
    begins += 1;
    return Promise.reject(new Error('session refused'));
  })));
  t.after(() => view.unmount());
  assert.equal(view.text().includes('No pudimos abrir la vista del contacto.'), false);
  await view.click();
  assert.equal(begins, 1);
  assert.match(view.text(), /No pudimos abrir la vista del contacto\./);
});

test('FamilyGate shows the connecting busy state', async t => {
  const { createServer } = await import('vite');
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const vite = await createServer({ root, configFile: fileURLToPath(new URL('../../vite.config.ts', import.meta.url)),
    logLevel: 'silent', server: { middlewareMode: true, hmr: false } });
  t.after(() => vite.close());
  const { renderContactGate } = await vite.ssrLoadModule('/tests/phone/family-render.tsx');
  let begins = 0;
  const view = await renderContactGate(familyRuntime(gateway('connecting', () => { begins += 1; return Promise.resolve(); })));
  t.after(() => view.unmount());
  const button = view.button();
  assert.equal(button.getAttribute('aria-busy'), 'true');
  assert.equal(button.getAttribute('data-action'), 'start-contact');
  assert.match(button.textContent, /Ver el aviso/);
  assert.equal(view.text().includes('No pudimos abrir la vista del contacto.'), false);
  await view.click();
  assert.equal(begins, 0, 'a connecting gate does not start another session');
});


test('Q5 real FamilyGate resolved error, connecting, retry, authentication and expiry follow gateway snapshot', async t => {
  const { fixture, realGateway, screens, ids } = await import('./screen-fixture.mjs');
  const { renderContactGate } = await screens(t, '/tests/phone/family-render.tsx');
  const f = fixture(t), g = realGateway(t);
  let protectedReads = 0;
  f.runtime.familyGateway = g.gateway; f.runtime.familySession = g.session;
  f.runtime.familyApi = {
    getIdentity: async () => { protectedReads++; return { id: ids.family }; },
    getTripStatus: async () => ({ trip: { status: 'active', paused: false }, check: null, incident: null, deliveries: [] }),
    getSnapshot: async () => ({ location: null, freshness: 'unavailable' }),
  };
  const view = await renderContactGate(f.runtime); t.after(view.unmount);
  await view.click();
  assert.equal(g.gateway.getSnapshot().state, 'error');
  assert.match(view.text(), /No pudimos abrir la vista del contacto/);
  assert.equal(protectedReads, 0);
  g.succeed(); let release; g.hold(new Promise(done => { release = done; }));
  await view.click(); assert.equal(g.gateway.getSnapshot().state, 'connecting');
  assert.equal(view.button().getAttribute('aria-busy'), 'true');
  await view.click(); assert.equal(g.acquisitions(), 2);
  await view.flush(async () => { release(); await g.gateway.begin(); });
  assert.equal(g.gateway.getSnapshot().state, 'authenticated'); assert.equal(view.hasButton(), false);
  assert.equal(protectedReads, 1);
  await view.flush(g.expire); assert.equal(g.gateway.getSnapshot().state, 'expired');
  assert.match(view.text(), /venció/); assert.equal(view.hasButton(), true);
});
