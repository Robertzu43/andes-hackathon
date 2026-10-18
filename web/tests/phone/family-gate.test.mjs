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
