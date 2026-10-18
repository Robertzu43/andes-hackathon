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

test('a private window can register a trip, raise SOS, and read the contact alert', { timeout: 180000 }, async () => {
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
    await copyPhoneCaptures(shots, process.env.ANDES_SCREENSHOT_DIR);
  } catch (error) {
    console.error(error);
    throw error;
  } finally {
    try { await chrome?.close(); } catch (error) { console.error('chrome close', error); }
    try { await app?.close(); } catch (error) { console.error('app close', error); }
    await db.cleanup();
  }
});
