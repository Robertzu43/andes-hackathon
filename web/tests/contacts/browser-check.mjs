import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { homedir } from 'node:os';

const base = new URL(process.argv[2]);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) throw new Error('Local fixture only');
const output = resolve(process.argv[3] ?? '/private/tmp/andes-l51-ui-evidence'); mkdirSync(output, { recursive: true });
const helper = process.env.CODUS_BROWSER_HELPER ?? join(homedir(), '.claude/skills/codus-site-seo/scripts/browser.mjs');
const { launchBrowser, pause } = await import(pathToFileURL(helper).href);
const browser = await launchBrowser(); const page = await browser.newPage();
const results = [];
async function wait(fn) {
  for (let n = 0; n < 100; n++) { if (await page.evaluate(fn)) return; await pause(40); }
  throw new Error('Fixture did not reach expected visible state');
}
async function open(screen, locale = 'es', scenario = 'normal', extra = '') {
  await page.goto(`${base.origin}/tests/contacts/fixture.html?screen=${screen}&locale=${locale}&scenario=${scenario}${extra}`);
  await wait(() => !!document.querySelector('h1'));
  if (scenario === 'signed-out') await wait(() => document.querySelector('main a[href="/session"]') !== null);
  else if (screen === 'trip' && !['forbidden', 'server-error', 'unauthorized'].includes(scenario)) {
    if (scenario === 'no-location') await wait(() => document.querySelector('[data-action="acknowledge"]')?.disabled === false);
    else await wait(() => document.body.innerText.includes('-23.55000'));
  } else if (screen === 'contacts' || screen === 'privacy') await wait(() =>
    !document.querySelector('.andes-loading') && (!!document.querySelector('.andes-contact-list') || !!document.querySelector('.andes-empty') || !!document.querySelector('[role="alert"]') || !!document.querySelector('main a[href="/session"]')));
  else await wait(() => !!document.querySelector('#accept-limit'));
}
async function click(selector) {
  await page.evaluate(selector => { const node = document.querySelector(selector); if (!node) throw new Error(selector); node.click(); }, selector);
}
async function button(text) {
  await page.evaluate(text => { const node = [...document.querySelectorAll('button')].find(n => n.textContent.trim() === text);
    if (!node) throw new Error(text); node.click(); }, text);
}
async function fill(selector, text) {
  await page.evaluate(selector => { const node = document.querySelector(selector); node.focus(); node.select(); }, selector);
  await page.send('Input.insertText', { text });
}
async function record(name, fn) {
  try { await fn(); results.push({ name, pass: true }); console.log(`PASS ${name}`); }
  catch (error) { await capture(`FAILED-${name}`); writeFileSync(join(output, `FAILED-${name}.json`), JSON.stringify(await page.evaluate(() => ({
    body: document.body.innerText, active: document.activeElement?.outerHTML, calls: window.__CONTACT_FIXTURE__?.calls,
  })), null, 2)); throw error; }
}
async function capture(name) {
  await page.screenshot({ path: join(output, `${name}.png`) });
  await page.screenshot({ path: join(output, `${name}-full.png`), fullPage: true });
}
try {
  if (process.env.ANDES_CONTACT_CONTROLS_ONLY !== '1') for (const locale of ['es', 'pt-BR']) for (const [width, height] of [[390, 844], [1440, 900], [1920, 1080], [360, 800], [430, 932]]) {
    await page.setViewport({ width, height, mobile: width < 600 });
    for (const screen of ['contacts', 'privacy', 'invitation', 'trip']) await record(`${locale}-${screen}-${width}`, async () => {
      await open(screen, locale);
      const facts = await page.evaluate(() => ({ headings: document.querySelectorAll('h1').length, lang: document.documentElement.lang,
        overflow: document.documentElement.scrollWidth > innerWidth + 1, demo: !!document.querySelector('.andes-demo'), errors: document.querySelectorAll('vite-error-overlay').length,
        unnamed: [...document.querySelectorAll('button,a,input,select')].filter(n => {
          if (n.closest('label') || n.getAttribute('aria-label') || n.id && document.querySelector(`label[for="${CSS.escape(n.id)}"]`)) return false;
          return !n.textContent.trim();
        }).map(n => n.outerHTML),
      }));
      assert.equal(facts.headings, 1); assert.equal(facts.lang, locale); assert.equal(facts.overflow, false); assert.equal(facts.demo, true);
      assert.equal(facts.errors, 0); assert.deepEqual(facts.unnamed, []); assert.deepEqual(page.errors, []);
      await capture(`${locale}-${screen}-${width}`);
    });
  }
  await page.setViewport({ width: 390, height: 844, mobile: true });
  await record('invite-validation-keyboard-explicit-scope-and-no-duplicate-post', async () => {
    await open('contacts');
    await page.evaluate(() => document.querySelector('[data-action="invite-open"]').focus());
    for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, ...(type === 'keyDown' ? { text: '\r' } : {}) });
    await wait(() => !!document.querySelector('#invite-contact-id'));
    assert.equal(await page.evaluate(() => document.activeElement.id), 'invite-contact-id');
    await click('form button[type="submit"]');
    assert.equal(await page.evaluate(() => window.__CONTACT_FIXTURE__.calls.filter(c => c.method === 'POST').length), 0);
    assert.equal(await page.evaluate(() => document.querySelectorAll('[aria-invalid="true"]').length), 2);
    await fill('#invite-contact-id', '00000000-0000-4000-8000-000000000006');
    await fill('input[type="tel"]', '+5511000000001'); await click('input[type="checkbox"]');
    await page.evaluate(() => { const b = document.querySelector('form button[type="submit"]'); b.click(); b.click(); });
    await wait(() => !!document.querySelector('[data-contact-state="recorded"]'));
    const posts = await page.evaluate(() => window.__CONTACT_FIXTURE__.calls.filter(c => c.method === 'POST'));
    assert.equal(posts.length, 1); assert.deepEqual(JSON.parse(posts[0].body), { contactId: '00000000-0000-4000-8000-000000000006', phone: '+5511000000001', map: true, incident: false });
    assert.ok(posts[0].key); await wait(() => document.activeElement?.dataset.action === 'invite-open');
    await capture('invitation-receipt');
  });
  await record('acknowledgement-action-escape-and-session-clearing', async () => {
    await open('trip'); await click('[data-action="acknowledge"]');
    await wait(() => !!document.querySelector('[data-contact-state="recorded"]'));
    await fill('.andes-contact-report input', 'SYNTHETIC: <img src=x onerror=alert(1)> cannot assist');
    await click('[data-action="report"]'); await wait(() => document.querySelectorAll('.andes-contact-receipts .andes-update').length === 2);
    assert.equal(await page.evaluate(() => document.querySelector('.andes-contact-receipts img') !== null), false);
    const posts = await page.evaluate(() => window.__CONTACT_FIXTURE__.calls.filter(c => c.method === 'POST'));
    assert.equal(posts.length, 2); assert.ok(posts[0].path.endsWith('/acknowledgements')); assert.ok(posts[1].path.endsWith('/actions'));
    assert.notEqual(posts[0].key, posts[1].key); assert.equal(posts.some(c => c.path.endsWith('/resolve')), false);
    await capture('own-distinct-response-receipts');
    await page.evaluate(() => window.__CONTACT_GATEWAY__.end());
    await wait(() => document.querySelector('main a[href="/session"]') !== null);
    assert.equal(await page.evaluate(() => document.body.innerText.includes('-23.55000') || document.body.innerText.includes('SYNTHETIC:')), false);
    await page.evaluate(async () => { window.__CONTACT_FIXTURE__.identity = '00000000-0000-4000-8000-000000000006'; await window.__CONTACT_GATEWAY__.begin(); });
    await wait(() => document.querySelector('.andes-contact-report input')?.disabled === false);
    assert.equal(await page.evaluate(() => document.querySelector('.andes-contact-report input').value), '');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.andes-contact-receipts .andes-update').length), 0);
  });
  await record('unknown-revoke-refused-retry-retains-key-and-conceals-facts', async () => {
    await open('trip', 'es', 'unknown-revoke'); await button('Dejar de compartir este viaje'); await button('Sí, revocar permiso');
    await wait(() => !!document.querySelector('[data-contact-state="uncertain"]'));
    assert.equal(await page.evaluate(() => document.body.innerText.includes('-23.55000')), false);
    await button('Reintentar el mismo pedido');
    await wait(() => !!document.querySelector('[data-contact-state="uncertain"]'));
    await wait(() => document.activeElement?.dataset.action === 'retry-same');
    const calls = await page.evaluate(() => window.__CONTACT_FIXTURE__.calls.filter(c => c.path.endsWith('/revoke')));
    assert.equal(calls.length, 2); assert.equal(calls[0].key, calls[1].key); assert.equal(calls[0].body, calls[1].body);
    assert.equal(await page.evaluate(() => document.querySelector('[data-action="report"]').disabled), true);
    await capture('unknown-revoke-after-refused-retry');
  });
  for (const [screen, scenario] of [['contacts', 'empty'], ['contacts', 'forbidden'], ['contacts', 'server-error'], ['contacts', 'truncated'], ['contacts', 'signed-out'], ['trip', 'no-location'], ['trip', 'resolved']]) {
    await record(`${screen}-${scenario}`, async () => { await open(screen, 'pt-BR', scenario); assert.deepEqual(page.errors, []); await capture(`${screen}-${scenario}`); });
  }
  await record('missing-recipient-references-disable-actions-without-invented-reads', async () => {
    await open('trip', 'es', 'normal', '&references=missing');
    assert.equal(await page.evaluate(() => document.querySelector('[data-action="acknowledge"]').disabled), true);
    assert.equal(await page.evaluate(() => window.__CONTACT_FIXTURE__.calls.some(c => c.path.includes('/incidents/'))), false);
    await capture('missing-recipient-reference');
  });
  await record('reduced-motion-and-expanded-portuguese-form', async () => {
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await open('contacts', 'pt-BR'); await click('[data-action="invite-open"]');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('button')).transitionDuration), '0s');
    await capture('pt-BR-expanded-form-reduced-motion');
  });
  await record('primary-response-visible-on-narrow-portuguese-phone', async () => {
    await page.setViewport({ width: 360, height: 800, mobile: true }); await open('trip', 'pt-BR');
    const visible = await page.evaluate(() => { const box = document.querySelector('[data-action="response-open"]').getBoundingClientRect();
      return box.top >= 0 && box.bottom <= innerHeight; });
    assert.equal(visible, true); await capture('pt-BR-narrow-primary-response');
  });
} finally {
  const composition = JSON.parse(readFileSync(resolve('..', 'composition.json'), 'utf8'));
  writeFileSync(join(output, 'results.json'), JSON.stringify({ composition, results, count: results.length,
    scope: 'Builder checks: real React/foundation/API code with synthetic in-memory HTTP replies; no backend/browser OIDC/device qualification or independent acceptance' }, null, 2));
  await page.close(); await browser.close();
}
