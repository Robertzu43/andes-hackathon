// Narrow gatekeeper incident-as-of/scope controls; synthetic loopback HTTP only.
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
async function enter(selector) {
  await page.evaluate(selector => document.querySelector(selector).focus(), selector);
  for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type,
    key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, ...(type === 'keyDown' ? { text: '\r' } : {}) });
}
try {
  for (const locale of ['es', 'pt-BR']) for (const [width, height] of [[390, 844], [1440, 900]]) {
    await page.setViewport({ width, height, mobile: width === 390 });
    await page.goto(`${base.origin}/tests/contacts/fixture.html?screen=trip&locale=${locale}`);
    await until(() => document.querySelector('[data-action="acknowledge"]')?.disabled === false);
    const observation = await page.evaluate(() => ({ text: document.querySelector('[data-contact-observation="incident"]')?.textContent,
      time: document.querySelector('[data-contact-observation="incident"] time')?.dateTime,
      cue: document.querySelector('[aria-labelledby="incident-title"] .andes-hint')?.textContent,
      overflow: document.documentElement.scrollWidth > innerWidth + 1 }));
    await page.screenshot({ path: join(output, `${locale}-${width}-incident.png`), fullPage: true });
    assert.ok(observation.time); assert.match(observation.text, locale === 'es' ? /Este dispositivo/ : /Este dispositivo/);
    assert.match(observation.cue, /consulta anterior/i); assert.equal(observation.overflow, false);
    await enter('[data-action="acknowledge"]');
    await until(() => document.querySelectorAll('.andes-contact-receipts .andes-update').length === 1);
    await page.evaluate(() => { window.__CONTACT_FIXTURE__.mode = 'map-denied'; });
    await enter('[aria-labelledby="location-title"] button');
    await until(() => !document.body.innerText.includes('-23.55000'));
    assert.equal(await page.evaluate(() => document.querySelector('[data-action="acknowledge"]').disabled), false);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.andes-contact-receipts .andes-update').length), 1);
    await page.screenshot({ path: join(output, `${locale}-${width}-map-denied-sos.png`), fullPage: true });
    await page.evaluate(() => { window.__CONTACT_FIXTURE__.mode = 'normal'; });
    await enter('[aria-labelledby="location-title"] button');
    await until(() => document.body.innerText.includes('-23.55000'));
    await page.evaluate(() => { window.__CONTACT_FIXTURE__.mode = 'incident-denied'; });
    await enter('[aria-labelledby="incident-title"] button');
    await until(() => document.querySelector('[data-action="acknowledge"]')?.disabled === true);
    assert.equal(await page.evaluate(() => document.body.innerText.includes('-23.55000')), true);
    assert.deepEqual(page.errors, []);
    results.push({ locale, width, height, observation, independentScopes: true });
    console.log(`PASS ${locale} ${width}: device receipt, earlier observation, both scope denials`);
  }
} catch (error) {
  writeFileSync(join(output, 'failure.txt'), String(error.stack)); throw error;
} finally {
  writeFileSync(join(output, 'results.json'), JSON.stringify({ results }, null, 2) + '\n'); await browser.close();
}
