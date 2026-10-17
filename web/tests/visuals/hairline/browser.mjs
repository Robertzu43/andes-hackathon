import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(resolve(process.env.ANDES_VISUAL_TOOLS || web, 'package.json'));
const { chromium } = require('playwright-core');
const { AxeBuilder } = require('@axe-core/playwright');
const origin = process.env.ANDES_VISUAL_URL || 'http://127.0.0.1:3053';
const evidence = process.env.ANDES_VISUAL_EVIDENCE || '/tmp/andes53-evidence';
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const results = [];
const errors = [];
const failures = [];
const requests = [];
const record = (name, detail) => { results.push({ name, detail }); console.log(`PASS ${name}`); };

async function screenshot(page, name, scripted = true) {
  if (scripted) await page.evaluate(async () => {
    window.scrollTo(0, 0);
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.waitForTimeout(150);
  await page.screenshot({ path: resolve(evidence, `${name}.png`), fullPage: true });
}
async function ready(page) {
  await page.waitForFunction(() => document.querySelector('figcaption') &&
    [...document.images].every(img => img.complete && img.naturalWidth > 0));
}
async function paths(page) {
  return page.locator('[data-hairline] svg').evaluate(svg => svg.innerHTML);
}

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
  page.on('request', request => requests.push(request.url()));
  await page.goto(origin);
  await ready(page);
  assert.equal(await page.locator('[data-hairline]').count(), 0);
  assert(!requests.some(url => /PhoneCanvas|hairline_react/.test(url)));
  record('Still default has no animation engine request', requests.length);

  const dimensions = [[390,844], [1440,900], [1920,1080], [360,800], [430,932]];
  for (const [width,height] of dimensions) {
    await page.setViewportSize({ width, height });
    for (const locale of ['es', 'pt-BR']) {
      await page.locator('select').selectOption(locale);
      await ready(page);
      assert.equal(await page.evaluate(() => document.documentElement.lang), locale);
      assert(await page.locator('figcaption').isVisible());
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
      await screenshot(page, `rest-${locale}-${width}x${height}`);
    }
  }
  record('Ten bilingual still renders have captions and zero horizontal overflow', dimensions);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('select').selectOption('es');
  const range = page.locator('input[type=range]');
  await range.focus();
  const medium = await page.locator('.andes-phone__still').getAttribute('src');
  await page.keyboard.press('End');
  await page.waitForFunction(() => document.querySelector('input[type=range]').value === '1');
  assert.notEqual(await page.locator('.andes-phone__still').getAttribute('src'), medium);
  await screenshot(page, 'still-open-keyboard');
  await page.keyboard.press('Home');
  await page.waitForFunction(() => document.querySelector('input[type=range]').value === '0');
  assert.equal(await page.locator('[data-hairline]').count(), 0);
  await screenshot(page, 'still-compact-keyboard');
  record('Keyboard range changes useful still geometry without an engine', 'Home / End');

  const enable = page.getByRole('button', { name: 'Explorar la ilustración' });
  await enable.focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-hairline] svg');
  const first = await paths(page);
  await page.locator('.andes-phone__frame').hover({ position: { x: 250, y: 80 } });
  await page.waitForTimeout(1500);
  assert.notEqual(await paths(page), first);
  const settled = await paths(page);
  await page.waitForTimeout(350);
  assert.equal(await paths(page), settled);
  await screenshot(page, 'interactive-pointer');
  assert.equal(await page.locator('[data-hairline]').getAttribute('aria-hidden'), 'true');
  assert.equal(await page.locator('[aria-live]').count(), 0);
  record('Explicit keyboard enable, pointer response, settled geometry and no raw live readout', 'Phone SVG changes then settles');

  await page.evaluate(() => {
    window.__phoneSection = document.querySelector('.andes-phone').parentElement;
    window.__phoneSection.style.marginTop = '1800px';
    window.scrollTo(0,0);
  });
  await page.waitForSelector('[data-hairline]', { state: 'detached' });
  await page.evaluate(() => { window.__phoneSection.style.marginTop = ''; });
  await page.waitForSelector('[data-hairline] svg');
  record('Offscreen unmount and visible remount', 'IntersectionObserver removes the upstream engine');

  // The page lifecycle event is simulated, not physical app background proof.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForSelector('[data-hairline]', { state: 'detached' });
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForSelector('[data-hairline] svg');
  record('Simulated document-hidden cleanup', 'Native visibility listener; physical iPhone not qualified');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForSelector('[data-hairline]', { state: 'detached' });
  assert(await page.locator('button').isDisabled());
  await range.focus();
  await page.keyboard.press('End');
  await screenshot(page, 'reduced-motion-open');
  assert(await page.locator('figcaption').isVisible());
  record('Reduced motion is still, range and caption stay useful', 'Runtime preference change');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForSelector('[data-hairline] svg');
  await page.getByRole('button', { name: 'Dejar la ilustración quieta' }).click();
  await page.waitForSelector('[data-hairline]', { state: 'detached' });
  await page.reload();
  await ready(page);
  assert.equal(await page.locator('[data-hairline]').count(), 0);
  record('Stop and reload return to still with no autoplay persistence', 'No motion setting stored');

  for (const locale of ['es', 'pt-BR']) {
    await page.locator('select').selectOption(locale);
    const audit = await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    await writeFile(resolve(evidence, `axe-${locale}.json`), JSON.stringify(audit, null, 2));
    assert.deepEqual(audit.violations.map(v => ({ id:v.id, impact:v.impact })), []);
  }
  record('WCAG 2.1 A/AA axe scan in both locales', 'No violations');

  const zoom = await browser.newPage({ viewport: { width: 400, height: 500 }, deviceScaleFactor: 4 });
  await zoom.goto(origin);
  await ready(zoom);
  await zoom.locator('.andes-phone__frame').screenshot({ path: resolve(evidence, 'rest-detail-4x.png') });
  await zoom.close();

  const noJS = await browser.newPage({ viewport: { width:390, height:844 }, javaScriptEnabled:false });
  await noJS.goto(origin);
  assert(await noJS.getByText('Con la página cerrada', { exact:false }).isVisible());
  assert.equal(await noJS.locator('img').evaluate(img => img.complete && img.naturalWidth > 0), true);
  assert.equal(await noJS.locator('img').getAttribute('alt'), 'Ilustración de las capas de un teléfono / Ilustração das camadas de um telefone');
  await screenshot(noJS, 'no-javascript-390x844', false);
  await noJS.close();
  record('No-JavaScript bilingual HTML caption and rest image', 'No interactive control promise');

  const touchContext = await browser.newContext({ viewport:{width:390,height:844}, hasTouch:true, isMobile:true });
  const touch = await touchContext.newPage();
  await touch.goto(origin);
  await ready(touch);
  await touch.getByRole('button', { name:'Explorar la ilustración' }).tap();
  await touch.waitForSelector('[data-hairline] svg');
  const box = await touch.locator('.andes-phone__frame').boundingBox();
  const before = await paths(touch);
  await touch.touchscreen.tap(box.x + box.width * .8, box.y + box.height * .35);
  await touch.waitForTimeout(1500);
  assert.notEqual(await paths(touch), before);
  assert.equal(await touch.locator('[data-hairline]').evaluate(el => getComputedStyle(el).touchAction), 'pan-y');
  await screenshot(touch, 'touch-interactive');
  await touchContext.close();
  record('Emulated touch responds and preserves vertical pan', 'Browser emulation only');

  // Exercise the public host bridge directly, including abort and repeated teardown.
  await page.evaluate(async moduleURL => {
    const { mountVisual } = await import(moduleURL);
    const host = document.createElement('section');
    host.id = 'bridge-test';
    document.querySelector('main').prepend(host);
    const sibling = document.createElement('p');
    sibling.textContent = 'Caption fixture';
    host.append(sibling);
    const controller = new AbortController();
    const visual = mountVisual(host, { locale:'pt-BR', motion:'still', signal:controller.signal });
    window.__bridge = { host, controller, visual };
  }, `/@fs/${resolve(web, 'src/visuals/hairline/index.mjs')}`);
  await page.locator('#bridge-test').getByLabel('Separação das camadas').waitFor();
  await page.locator('#bridge-test').getByLabel('Separação das camadas').focus();
  await page.keyboard.press('End');
  await page.evaluate(() => window.__bridge.visual.setMotion('interactive'));
  await page.waitForSelector('#bridge-test [data-hairline] svg');
  await page.evaluate(() => {
    window.__bridge.controller.abort();
    window.__bridge.visual.destroy();
    window.__bridge.visual.setMotion('interactive');
  });
  assert.equal(await page.locator('#bridge-test [data-hairline]').count(), 0);
  assert.equal(await page.locator('#bridge-test').textContent(), 'Caption fixture');
  await page.evaluate(() => window.__bridge.host.remove());
  record('Public bridge language, keyboard, abort, idempotent destroy and sibling preservation', 'No stale root after teardown');

  // Block the optional chunk in a clean context; a useful rest and caption must survive.
  const blockedContext = await browser.newContext({ viewport:{width:390,height:844} });
  const blocked = await blockedContext.newPage();
  await blocked.route('**/PhoneCanvas*', route => route.abort());
  await blocked.goto(origin);
  await ready(blocked);
  await blocked.getByRole('button', { name:'Explorar la ilustración' }).click();
  await blocked.waitForTimeout(500);
  assert.equal(await blocked.locator('[data-hairline]').count(), 0);
  assert(await blocked.locator('figcaption').isVisible());
  assert.equal(await blocked.locator('.andes-phone__still').evaluate(img => img.complete && img.naturalWidth>0), true);
  await screenshot(blocked, 'optional-chunk-failed');
  await blockedContext.close();
  record('Blocked optional chunk preserves text and useful still', 'Failure intentionally injected in separate browser context');

  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  assert(!requests.some(url => new URL(url).origin !== new URL(origin).origin));
  record('Clean primary runtime and network, no external requests', { errors, failures });
  await writeFile(resolve(evidence, 'browser-results.json'), JSON.stringify({ results, errors, failures, requests },null,2));
} finally { await browser.close(); }
