// Synthetic local fixture only. Uses native keyboard input and owns its Chrome/profile.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const base = new URL(process.argv[2]);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) throw new Error('Loopback fixture required');
const output = resolve(process.argv[3]); mkdirSync(output, { recursive: true });
const { launchBrowser, pause } = await import(pathToFileURL(process.env.CODUS_BROWSER_HELPER
  ?? join(homedir(), '.claude/skills/codus-site-seo/scripts/browser.mjs')).href);
const browser = await launchBrowser(); const page = await browser.newPage(); const results = [];
async function until(predicate) {
  for (let count = 0; count < 100; count++) { if (await page.evaluate(predicate)) return; await pause(40); }
  throw new Error('Expected fixture state did not settle');
}
async function key(selector, value = 'Enter') {
  await page.evaluate(selector => document.querySelector(selector).focus(), selector);
  for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', {
    type, key: value, code: value === 'Enter' ? 'Enter' : 'Space', windowsVirtualKeyCode: value === 'Enter' ? 13 : 32,
    ...(type === 'keyDown' ? { text: value === 'Enter' ? '\r' : ' ' } : {}),
  });
}
async function fill(selector, text) {
  await page.evaluate(selector => { const field = document.querySelector(selector); field.focus(); field.select(); }, selector);
  await page.send('Input.insertText', { text });
}
try {
  for (const locale of ['es', 'pt-BR']) for (const [width, height] of [[390, 844], [1440, 900]]) {
    await page.setViewport({ width, height, mobile: width === 390 });
    await page.goto(`${base.origin}/tests/contacts/fixture.html?screen=contacts&scenario=unknown-invite&locale=${locale}`);
    await until(() => !!document.querySelector('.andes-contact-list'));
    await key('[data-action="invite-open"]'); await until(() => !!document.querySelector('#invite-contact-id'));
    await fill('#invite-contact-id', '00000000-0000-4000-8000-000000000006');
    await fill('input[type="tel"]', '+5511000000001');
    await key('input[type="checkbox"]', ' '); await key('form button[type="submit"]');
    await until(() => !!document.querySelector('[data-contact-state="uncertain"]'));
    const facts = await page.evaluate(() => ({
      revokeDisabled: document.querySelector('.andes-contact-list button')?.disabled,
      postCount: window.__CONTACT_FIXTURE__.calls.filter(call => call.method === 'POST').length,
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
    }));
    await page.screenshot({ path: join(output, `${locale}-${width}-unknown.png`), fullPage: true });
    assert.equal(facts.revokeDisabled, true); assert.equal(facts.postCount, 1); assert.equal(facts.overflow, false);
    await key('[data-action="retry-same"]');
    await until(() => !!document.querySelector('[data-contact-state="recorded"]'));
    const writes = await page.evaluate(() => window.__CONTACT_FIXTURE__.calls.filter(call => call.method === 'POST'));
    assert.equal(writes.length, 2); assert.equal(writes[0].key, writes[1].key); assert.equal(writes[0].body, writes[1].body);
    assert.deepEqual(page.errors, []);
    results.push({ locale, width, height, facts, recoveredWithSameKey: true });
    console.log(`PASS ${locale} ${width}: Revoke locked, explicit same-key retry recorded`);
  }
} catch (error) {
  writeFileSync(join(output, 'failure.txt'), String(error.stack)); throw error;
} finally {
  writeFileSync(join(output, 'results.json'), JSON.stringify({ results }, null, 2) + '\n');
  await browser.close();
}
