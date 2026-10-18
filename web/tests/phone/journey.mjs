// Driver → SOS alert → contact, in Chrome, against this checkout's API and Postgres.
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { browser } from '../foundation/cdp.mjs';
import { copyPhoneCaptures } from './captures.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const phone = /\+[1-9]\d{6,14}/;

test('a private window can register a trip, raise SOS, and read the contact alert', { timeout: 180000 }, async t => {
  assert.ok(existsSync(join(root, 'dist/api/app.js')), 'Build the backend before this journey');
  assert.ok(existsSync(join(root, 'web/dist/index.html')), 'Build the web app before this journey');
  process.env.APP_INTEGRATION_PG_PORT ??= '56448';
  const { disposableDatabase } = await import(pathToFileURL(join(root, 'scripts/app-integration/runtime.mjs')));
  const { createContext, migrate } = await import(pathToFileURL(join(root, 'dist/db.js')));
  const { createApp } = await import(pathToFileURL(join(root, 'dist/api/app.js')));
  const { demoIssuer } = await import(pathToFileURL(join(root, 'dist/demo.js')));
  const shots = await mkdtemp(join(tmpdir(), 'andes-phone-shots-'));
  const db = await disposableDatabase();
  const ctx = createContext(db.url);
  let app, chrome;
  try {
    await migrate(ctx.pool);
    const demo = await demoIssuer({ DEMO_MODE: 'true' });
    app = createApp({ ctx, auth: demo.auth, demo, automaticChecks: true, channelSupport: [],
      webRoot: join(root, 'web/dist'), trustProxyHops: 0 });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    assert.ok(address && typeof address === 'object');
    const origin = `http://127.0.0.1:${address.port}`;
    chrome = await browser(shots);
    await chrome.viewport(390, 844);
    const page = chrome;
    // Intercept real production fetches in Chrome. Successful requests still hit this API/SQL.
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `
      const actualFetch = window.fetch.bind(window);
      window.__phoneRequests = [];
      window.__phoneFault = null;
      window.fetch = async (url, init = {}) => {
        const path = new URL(url, location.href).pathname;
        const method = init.method || 'GET';
        window.__phoneRequests.push({path, method, body: init.body || null, key: init.headers?.['Idempotency-Key'] || null});
        const fault = window.__phoneFault;
        if (fault === 'gateway' && path === '/v1/demo/session') return new Response('{}', {status:503});
        if (fault === 'family-gateway' && path === '/v1/me') return new Response('{}', {status:503});
        if (fault === 'status' && path.endsWith('/status')) return new Response('{}', {status:503});
        if (fault === 'status-denied' && path.endsWith('/status')) return new Response('{}', {status:403});
        if (fault === 'status-missing' && path.endsWith('/status')) return new Response('{}', {status:404});
        if (fault === 'delay-status' && path.endsWith('/status')) await new Promise(resolve => { window.__releaseStatus = resolve; });
        if (fault === 'reject-confirm' && path.endsWith('/confirm')) return new Response(JSON.stringify({code:'contact_not_accepted'}), {status:409});
        const response = await actualFetch(url, init);
        if (['missing-family','pending-family','revoked-family','foreign-family'].includes(fault) && path === '/v1/bootstrap') {
          const data = await response.json();
          if (fault === 'missing-family') data.contacts = data.contacts.filter(c => c.role !== 'family');
          else data.contacts = data.contacts.map(c => c.role !== 'family' ? c : fault === 'foreign-family'
            ? {...c, contactId:'a0000000-0000-4000-8000-000000000099'}
            : {...c, status:fault === 'pending-family' ? 'pending' : 'revoked', acceptedAt:null,
              revokedAt:fault === 'revoked-family' ? '2026-10-18T09:00:00Z' : null,
              revokedBy:fault === 'revoked-family' ? 'contact' : null,
              map:{...c.map,accepted:false}, incident:{...c.incident,accepted:false}});
          return new Response(JSON.stringify(data), {status:200, headers:{'Content-Type':'application/json'}});
        }
        if (fault === 'lost-confirm' && path.endsWith('/confirm')) { await response.text(); throw new TypeError('synthetic lost response'); }
        return response;
      };
    ` });
    async function waitFor(expression, label) {
      const start = Date.now();
      let last = '';
      while (Date.now() - start < 20000) {
        if (await page.evaluate(`(() => { try { return Boolean(${expression}); } catch { return false; } })()`)) return;
        last = await page.evaluate('document.body ? document.body.innerText.slice(0, 700) : ""');
        await delay(100);
      }
      throw new Error(`${label} at ${await page.evaluate('location.href')}\n${last}`);
    }
    async function fill(selector, value) {
      const actual = await page.evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error('Missing ${selector}');
        const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
        proto.set.call(el, ${JSON.stringify(value)});
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return el.value;
      })()`);
      assert.equal(actual, value, selector);
    }
    await page.goto(`${origin}/`);
    await page.capture('01-welcome');
    await page.click('[data-action="start-demo"]');
    await waitFor(`document.querySelector('#trip-origin')`, 'trip form');
    await fill('#trip-text', 'Carga de demostración');
    await fill('#trip-origin', 'Lima');
    await fill('#trip-destination', 'Arequipa');
    await page.click('[data-action="im-stopped"]');
    await waitFor(`document.querySelector('[data-action="im-stopped"]').checked === true`, 'stopped');
    await page.capture('02-trip');
    await page.click('[data-action="confirm-trip"]');
    await waitFor(`document.querySelector('[data-action="sos"]')`, 'SOS screen');
    await page.click('[data-action="checkin-ok"]');
    await waitFor(`document.querySelector('[data-command-state="accepted"]')`, 'check-in accepted');
    await page.click('[data-action="sos"]');
    await waitFor(`document.querySelector('[data-alert-state="recorded"]')`, 'SOS recorded');
    await page.capture('03-sos');
    assert.equal(await page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true, 'SOS screen overflows');
    await page.click('[data-action="open-contact"]');
    await waitFor(`document.querySelector('[data-action="start-contact"]')`, 'contact gate');
    await page.click('[data-action="start-contact"]');
    await waitFor(`document.body.innerText.includes('Pedido de ayuda (SOS) del conductor') && document.querySelector('[data-delivery-honesty]')`, 'contact alert');
    await page.capture('04-contact');
    const body = await page.evaluate('document.body.innerText');
    assert.match(body, /Entregado no es lo mismo que recibido/);
    assert.match(body, /Familia · SMS: No disponible/);
    assert.doesNotMatch(body, phone);
    assert.equal(await page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true, 'contact screen overflows');
    assert.deepEqual(page.runtime, []);
    const jobs = await ctx.pool.query(`SELECT j.status, j.channel, cg.role FROM jobs j
      LEFT JOIN contact_grants cg ON cg.id = j.grant_id
      JOIN incidents i ON i.id = j.incident_id WHERE i.trigger = 'sos'`);
    assert.ok(jobs.rows.some(row => row.role === 'family' && row.channel === 'sms' && row.status === 'unavailable'));
    const checks = await ctx.pool.query(`SELECT count(*)::int AS n FROM trip_events WHERE kind = 'checkin_ok'`);
    assert.equal(checks.rows[0].n, 1);
    const originalTrip = await page.evaluate(`location.pathname.split('/')[3]`);
    async function navigate(path) {
      await page.evaluate(`history.pushState({}, '', ${JSON.stringify(path)}); dispatchEvent(new PopStateEvent('popstate'));`);
      await delay(250);
    }
    async function newForm(fault = null) {
      await page.goto(`${origin}/`);
      await page.evaluate(`window.__phoneFault = ${JSON.stringify(fault)}`);
      await page.click('[data-action="start-demo"]');
      await waitFor(`document.querySelector('#trip-origin')`, 'new trip form');
      await fill('#trip-text', 'Carga de demostración'); await fill('#trip-origin', 'Lima'); await fill('#trip-destination', 'Arequipa');
      await page.click('[data-action="im-stopped"]');
    }
    const writes = () => page.evaluate(`window.__phoneRequests.filter(r => /\\/(sos|commands)$/.test(r.path))`);
    await t.test('Q1 Chrome route A to B issues zero wrong-target writes and recovers A', async () => {
      await navigate('/trips/a0000000-0000-4000-8000-000000000099/check-in');
      const before = (await writes()).length;
      for (const action of ['sos', 'checkin-ok']) if (await page.evaluate(`!!document.querySelector('[data-action="${action}"]')`)) await page.click(`[data-action="${action}"]`);
      await delay(100);
      assert.equal((await writes()).length, before, 'mismatched route sent a write');
      assert.match(await page.evaluate('document.body.innerText'), /otro viaje/i);
      await page.click('[data-action="bound-trip"]');
      await waitFor(`document.querySelector('[data-action="sos"]')`, 'bound trip recovery');
      await page.click('[data-action="checkin-ok"]'); await page.click('[data-action="sos"]'); await delay(100);
      assert.deepEqual((await writes()).slice(before).map(r => r.path),
        [`/v1/trips/${originalTrip}/commands`, `/v1/trips/${originalTrip}/sos`]);
    });
    await t.test('Q2 Chrome failed refresh preserves stale read time without false absence and SOS works', async () => {
      await page.evaluate(`window.__phoneFault = 'status'`);
      await navigate(`/trips/${originalTrip}/alerts`);
      await waitFor(`document.querySelector('[data-status-state="stale"], [data-status-state="unknown"]')`, 'status uncertainty');
      assert.doesNotMatch(await page.evaluate('document.body.innerText'), /No hay un control abierto|Ningún aviso visible/);
      assert.ok(await page.evaluate(`!!document.querySelector('[data-status-state="stale"] time[datetime]')`));
      await page.capture('05-stale-status');
      const before = (await writes()).length; await page.click('[data-action="sos"]'); await delay(100);
      assert.equal((await writes()).length, before + 1);
      for (const fault of ['status-denied', 'status-missing']) {
        await page.evaluate(`window.__phoneFault = ${JSON.stringify(fault)}`);
        await navigate(`/trips/${originalTrip}/check-in`); await navigate(`/trips/${originalTrip}/alerts`);
        await waitFor(`document.querySelector('[data-status-state="unknown"]')`, fault);
        assert.doesNotMatch(await page.evaluate('document.body.innerText'), /No hay un control abierto|Ningún aviso visible/);
      }
    });
    for (const fault of ['missing-family', 'pending-family', 'revoked-family', 'foreign-family']) await t.test(`Q3 Chrome ${fault} sends zero confirms`, async () => {
      await newForm(fault); await page.click('[data-action="confirm-trip"]'); await delay(300);
      const requests = await page.evaluate(`window.__phoneRequests.filter(r => r.path.endsWith('/confirm'))`);
      assert.equal(requests.length, 0); assert.match(await page.evaluate('document.body.innerText'), /aceptación|acepte/);
    });
    await t.test('Q3 Chrome fresh catalog revocation after preparation sends zero confirms', async () => {
      await newForm(); await page.evaluate(`window.__phoneFault = 'revoked-family'`);
      await page.click('[data-action="confirm-trip"]'); await delay(300);
      assert.equal(await page.evaluate(`window.__phoneRequests.filter(r => r.path.endsWith('/confirm')).length`), 0);
      assert.match(await page.evaluate('document.body.innerText'), /aceptación|acepte/);
    });
    await t.test('Q2 Chrome delayed first status remains unknown, SOS sends, valid null check recovers', async () => {
      await newForm(); await page.evaluate(`window.__phoneFault = 'delay-status'`); await page.click('[data-action="confirm-trip"]');
      await waitFor(`document.querySelector('[data-action="sos"]') && window.__releaseStatus`, 'delayed first status');
      assert.ok(await page.evaluate(`!!document.querySelector('[data-status-state="unknown"]')`));
      assert.doesNotMatch(await page.evaluate('document.body.innerText'), /No hay un control abierto|Ningún aviso visible/);
      const before = (await writes()).length; await page.click('[data-action="sos"]');
      await waitFor(`document.querySelector('[data-alert-state="recorded"]')`, 'SOS during delayed status');
      assert.equal((await writes()).length, before + 1);
      await page.evaluate(`window.__phoneFault = null; window.__releaseStatus();`);
      await waitFor(`document.querySelector('[data-status-state="current"]')`, 'fresh status');
      assert.match(await page.evaluate('document.body.innerText'), /No hay un control abierto/);
    });
    await t.test('Q4 Chrome rejected confirm recovers the single saved draft', async () => {
      await newForm(); await page.evaluate(`window.__phoneFault = 'reject-confirm'`); await page.click('[data-action="confirm-trip"]');
      await waitFor(`document.querySelector('[data-outcome]')`, 'rejected confirmation');
      assert.ok(await page.evaluate(`!!document.querySelector('[data-action="retry-confirm"]')`), 'no saved-draft recovery');
      await page.evaluate(`window.__phoneFault = null`); await page.click('[data-action="retry-confirm"]');
      await waitFor(`document.querySelector('[data-action="sos"]')`, 'recovered confirmation');
      assert.equal(await page.evaluate(`window.__phoneRequests.filter(r => r.path === '/v1/trip-drafts').length`), 1);
    });
    for (const recovery of ['retry-unknown-confirm', 'reconcile-confirm']) await t.test(`Q4 Chrome lost response ${recovery} retains original intent and one SQL trip`, async () => {
      await newForm(); await page.evaluate(`window.__phoneFault = 'lost-confirm'`); await page.click('[data-action="confirm-trip"]');
      await waitFor(`document.querySelector('[data-outcome="unknownWrite"]')`, 'unknown confirmation');
      await page.capture(`06-unknown-${recovery}`);
      assert.equal(await page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true, 'recovery screen overflows');
      const first = await page.evaluate(`window.__phoneRequests.find(r => r.path.endsWith('/confirm'))`);
      const id = first.path.split('/')[3];
      assert.equal((await ctx.pool.query('SELECT count(*)::int AS n FROM trips WHERE id = $1', [id])).rows[0].n, 1);
      assert.ok(await page.evaluate(`!!document.querySelector('[data-action="${recovery}"]')`), 'no uncertainty recovery');
      assert.equal(await page.evaluate(`!!document.querySelector('[data-action="confirm-trip"]')`), false);
      await page.evaluate(`window.__phoneFault = null`); await page.click(`[data-action="${recovery}"]`);
      await waitFor(`document.querySelector('[data-action="sos"]')`, 'lost response recovered');
      const confirms = await page.evaluate(`window.__phoneRequests.filter(r => r.path.endsWith('/confirm'))`);
      if (recovery === 'retry-unknown-confirm') { assert.equal(confirms.length, 2); assert.deepEqual(confirms[0], confirms[1]); }
      else assert.equal(confirms.length, 1);
      assert.equal(await page.evaluate(`window.__phoneRequests.filter(r => r.path === '/v1/trip-drafts').length`), 1);
      assert.equal((await ctx.pool.query('SELECT count(*)::int AS n FROM trips WHERE id = $1', [id])).rows[0].n, 1);
    });
    await t.test('Q5 Chrome family gateway resolved error protects contact view and retry reuses the world', async () => {
      await page.click('[data-action="open-contact"]'); await waitFor(`document.querySelector('[data-action="start-contact"]')`, 'family gate');
      await page.evaluate(`window.__phoneFault = 'family-gateway'`); await page.click('[data-action="start-contact"]');
      await waitFor(`document.body.innerText.includes('No pudimos abrir la vista del contacto')`, 'family snapshot error');
      assert.equal(await page.evaluate(`!!document.querySelector('[data-contact-session]')`), false);
      await page.capture('07-family-gateway-error');
      assert.equal(await page.evaluate(`window.__phoneRequests.filter(r => r.path === '/v1/demo/session').length`), 1);
      await page.evaluate(`window.__phoneFault = null`); await page.click('[data-action="start-contact"]');
      await waitFor(`document.querySelector('[data-contact-session]')`, 'family gateway retry');
      assert.equal(await page.evaluate(`window.__phoneRequests.filter(r => r.path === '/v1/demo/session').length`), 1);
    });
    await t.test('Q5 Chrome gateway failure stays on Home then authenticates once on retry', async () => {
      await page.goto(`${origin}/`); await page.evaluate(`window.__phoneFault = 'gateway'`); await page.click('[data-action="start-demo"]'); await delay(300);
      assert.equal(await page.evaluate('location.pathname'), '/'); assert.match(await page.evaluate('document.body.innerText'), /No pudimos abrir/);
      assert.equal(await page.evaluate(`window.__phoneRequests.filter(r => r.path === '/v1/bootstrap').length`), 0);
      await page.evaluate(`window.__phoneFault = null; const b = document.querySelector('[data-action="start-demo"]'); b.click(); b.click();`);
      await waitFor(`document.querySelector('#trip-origin')`, 'gateway retry');
      assert.equal(await page.evaluate(`window.__phoneRequests.filter(r => r.path === '/v1/demo/session').length`), 2);
    });
    assert.deepEqual(page.runtime, [], 'no renderer exceptions during fault/recovery cases');
    console.log(`Phone journey captures: ${join(shots, 'captures')}`);
    await copyPhoneCaptures(shots, process.env.ANDES_SCREENSHOT_DIR);
  } catch (error) {
    console.error(error);
    throw error;
  } finally {
    try { await chrome?.close(); } catch (error) { console.error('chrome close', error); }
    try { await app?.close(); } catch (error) { console.error('app close', error); }
    await db.cleanup();
    assert.equal(existsSync(db.directory), false, 'owned PostgreSQL directory removed');
    console.log('CLEANUP: owned Chrome/API closed and disposable PostgreSQL directory removed');
  }
});
