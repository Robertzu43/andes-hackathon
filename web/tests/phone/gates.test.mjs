import assert from 'node:assert/strict';
import test from 'node:test';
import { screens, fixture, realGateway } from './screen-fixture.mjs';

test('Q5 Home resolved error, connecting, retry, authentication and expiry follow gateway snapshot', async t => {
  const { mountPhone } = await screens(t), f = fixture(t), g = realGateway(t);
  f.runtime.gateway = g.gateway;
  const view = await mountPhone(f.runtime, 'home'); t.after(view.unmount);
  await view.click('start-demo');
  assert.equal(g.gateway.getSnapshot().state, 'error', 'real begin resolves and publishes error');
  assert.match(view.text(), /No pudimos abrir/);
  assert.equal(view.find(n => n.hasAttribute?.('data-location'))?.textContent, '/');
  assert.equal(f.reads(), 0);
  g.succeed(); let release; g.hold(new Promise(done => { release = done; }));
  await view.click('start-demo'); assert.equal(g.gateway.getSnapshot().state, 'connecting');
  assert.equal(view.action('start-demo').getAttribute('aria-busy'), 'true');
  await view.click('start-demo'); assert.equal(g.acquisitions(), 2, 'duplicate start joins one acquisition');
  await view.flush(async () => { release(); await g.gateway.begin(); });
  assert.equal(g.gateway.getSnapshot().state, 'authenticated');
  assert.match(view.text(), /\/trips\/new/);
  await view.flush(g.expire); assert.equal(g.gateway.getSnapshot().state, 'expired');
  assert.match(view.text(), /venció/);
});
