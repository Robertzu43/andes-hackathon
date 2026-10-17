import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, readdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { figureSources } from './figure-sources.mjs';

const { launchBrowser, pause } = await import(pathToFileURL(process.env.CODUS_BROWSER_HELPER
  ?? join(homedir(), '.claude/skills/codus-site-seo/scripts/browser.mjs')).href);
const [base = 'http://localhost:3055', output = '/tmp/andes55-bound-figures'] = process.argv.slice(2);
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
await mkdir(output, { recursive: true });
const browser = await launchBrowser();
const report = {
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceState: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
  foundation: '6f8dc52a566d3880cf1f10bbfd5282a888725ca1', figures: figureSources,
  base, rows: [], behavior: [], limitations: [
    'Actual figure sources and shared foundation in an isolated unconfigured/demo fixture',
    'No real driver/contact feature, API, trip, alert, delivery or physical-device acceptance',
    'Builder integration results require exact-head independent review',
  ],
};
async function wait(page, predicate) {
  for (let i = 0; i < 160; i++) { if (await page.evaluate(predicate)) return; await pause(30); }
  throw new Error('Expected bound-figure state did not settle');
}
async function key(page, selector, key = 'Enter', code = 13) {
  await page.evaluate(selector => document.querySelector(selector).focus(), selector);
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key,
    ...(key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}), windowsVirtualKeyCode: code });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code });
}
async function ready(page, kind) {
  await wait(page, () => document.querySelector('[data-visual]')?.dataset.visualState === 'ready');
  if (kind === 'phone') await wait(page, () => !!document.querySelector('.andes-phone-mount input'));
  else await wait(page, () => !!document.querySelector('.andes-relay [data-example="local"]'));
}
async function pageFor(locale, kind, width = 390, height = 844) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, mobile: width <= 500 });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__figureFrames = 0;
    const nativeFrame = requestAnimationFrame;
    window.requestAnimationFrame = callback => nativeFrame.call(window, time => { window.__figureFrames++; callback(time); });
  ` });
  const listener = event => {
    if (event.sessionId !== page.sessionId) return;
    if (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') page.errors.push('console.error');
    if (event.method === 'Network.loadingFailed') page.errors.push(event.params.errorText);
  };
  page.protocol.listeners.add(listener);
  const close = page.close.bind(page);
  page.close = async () => { page.protocol.listeners.delete(listener); await close(); };
  await page.goto(new URL(`/?locale=${locale}&art=${kind}`, base).href);
  await wait(page, () => !!document.querySelector('#visual-disclosure'));
  return page;
}
async function still(page) {
  await pause(120);
  const before = await page.evaluate(() => window.__figureFrames);
  await pause(150);
  assert.equal(await page.evaluate(() => window.__figureFrames), before, 'frames continue while still');
}
async function fullShot(page, path) {
  // A full-page clip can include fixed elements translated above a scrolled
  // viewport. Capture at scroll origin so the hidden skip link stays offscreen.
  await page.evaluate(() => scrollTo(0, 0));
  await pause(40);
  await page.screenshot({ path, fullPage: true });
}

try {
  for (const locale of ['es', 'pt-BR']) for (const kind of ['phone', 'relay']) {
    for (const [width, height] of [[390,844], [1440,900], [1920,1080], [360,800], [430,932]]) {
      const page = await pageFor(locale, kind, width, height);
      const closed = await page.evaluate(() => {
        const rect = document.querySelector('#primary-action').getBoundingClientRect();
        return { primaryInFold: rect.top >= 0 && rect.bottom <= innerHeight,
          figureRequests: performance.getEntriesByType('resource').filter(r => /(?:hairline-|PhoneCanvas-|anatomy-)/.test(r.name)).map(r => r.name) };
      });
      assert.ok(closed.primaryInFold); assert.equal(closed.figureRequests.length, 0);
      const stem = `${locale}-${kind}-${width}x${height}`;
      await page.screenshot({ path: join(output, `${stem}-closed.png`) });
      await key(page, '#visual-disclosure'); await ready(page, kind); await still(page);
      const open = await page.evaluate(() => ({
        locale: document.querySelector('[data-visual]').lang,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        state: document.querySelector('[data-visual]').dataset.visualMotion,
        engineRequested: performance.getEntriesByType('resource').some(r => /PhoneCanvas-/.test(r.name)),
        caption: document.querySelector('[data-visual] > figcaption').textContent.trim(),
        unnamed: [...document.querySelectorAll('[data-visual] button,[data-visual] input')].filter(el => el.getClientRects().length && !el.labels?.length && !(el.textContent || el.getAttribute('aria-label') || '').trim()).length,
      }));
      assert.equal(open.locale, locale); assert.equal(open.overflow, false);
      assert.equal(open.state, 'still'); assert.equal(open.engineRequested, false); assert.equal(open.unnamed, 0);
      await fullShot(page, join(output, `${stem}-open.png`));
      assert.deepEqual(page.errors, []); report.rows.push({ locale, kind, width, height, ...closed, ...open, errors: page.errors });
      await page.close();
    }
  }

  for (const locale of ['es', 'pt-BR']) for (const kind of ['phone', 'relay']) {
    const page = await pageFor(locale, kind); await key(page, '#visual-disclosure'); await ready(page, kind);
    if (kind === 'phone') {
      await key(page, '.andes-phone-mount input', 'End', 35);
      assert.equal(await page.evaluate(() => document.querySelector('.andes-phone-mount input').value), '1');
      assert.ok(await page.evaluate(() => document.querySelector('.andes-phone__still').src.includes('phone-rest-open')));
    } else {
      await key(page, '[data-example="acknowledged"]');
      assert.equal(await page.evaluate(() => document.querySelector('.andes-relay').dataset.relayExample), 'acknowledged');
      const unknown = locale === 'es' ? 'Sin confirmar' : 'Não confirmada';
      assert.equal(await page.evaluate(() => document.querySelector('[data-relay-fact="1"]').textContent), unknown);
      assert.equal(await page.evaluate(() => document.querySelector('[data-relay-fact="3"]').textContent), unknown);
    }
    if (kind === 'phone') await key(page, '.andes-phone-mount input', 'Home', 36);
    else await key(page, '[data-example="local"]');
    const touch = await page.evaluate(kind => {
      const node = document.querySelector(kind === 'phone' ? '.andes-phone-mount input' : '[data-example="acknowledged"]');
      node.scrollIntoView(); const rect = node.getBoundingClientRect();
      return { x: rect.x + rect.width * (kind === 'phone' ? .95 : .5), y: rect.y + rect.height / 2 };
    }, kind);
    await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...touch, id: 1 }] });
    await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await wait(page, () => document.querySelector('.andes-phone-mount input')?.value === '1'
      || document.querySelector('.andes-relay')?.dataset.relayExample === 'acknowledged');
    await still(page);
    await fullShot(page, join(output, `${locale}-${kind}-static-keyboard.png`));
    await key(page, 'button[data-visual-motion]');
    if (kind === 'phone') {
      await page.evaluate(() => document.querySelector('.andes-phone__frame').scrollIntoView());
      await wait(page, () => !!document.querySelector('.andes-phone__canvas'));
      assert.ok(await page.evaluate(() => performance.getEntriesByType('resource').some(r => /PhoneCanvas-/.test(r.name))));
    } else {
      await page.evaluate(() => document.querySelector('.andes-relay svg').scrollIntoView());
      await key(page, '[data-example="local"]');
    }
    const other = await browser.newPage(); await other.send('Page.bringToFront');
    await wait(page, () => document.hidden); await still(page);
    await page.send('Page.bringToFront'); await wait(page, () => !document.hidden); await still(page);
    await other.close();
    assert.equal(await page.evaluate(() => document.querySelector('[data-visual]').dataset.visualMotion), 'still');
    await key(page, 'button[data-visual-motion]');
    if (kind === 'phone') {
      await page.evaluate(() => document.querySelector('.andes-phone__frame').scrollIntoView());
      await wait(page, () => !!document.querySelector('.andes-phone__canvas'));
    }
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await wait(page, () => document.querySelector('button[data-visual-motion]').hidden);
    await still(page);
    if (kind === 'phone') assert.equal(await page.evaluate(() => document.querySelector('.andes-phone__canvas')), null);
    else {
      await key(page, '[data-example="acknowledged"]'); await still(page);
      assert.equal(await page.evaluate(() => document.querySelector('.andes-relay').dataset.relayExample), 'acknowledged');
    }
    await fullShot(page, join(output, `${locale}-${kind}-reduced.png`));
    const clip = await page.evaluate(() => {
      const root = document.querySelector('.andes-phone__frame') || document.querySelector('.andes-relay svg');
      const rect = root.getBoundingClientRect();
      return { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height, scale: 4 };
    });
    await page.screenshot({ path: join(output, `${locale}-${kind}-detail-4x.png`), clip });
    await key(page, '#route-away'); await wait(page, () => !!document.querySelector('#route-back'));
    await still(page);
    assert.equal(await page.evaluate(() => document.querySelector('[data-visual]')), null);
    assert.deepEqual(page.errors, []); await page.close();
    report.behavior.push(`${locale}/${kind}: native keyboard/touch, explicit motion, native tab pause, reduced-motion stillness and shared-route teardown`);
  }

  const build = process.env.VISUAL_FOUNDATION_BUILD ?? '/tmp/andes55-foundation-build';
  const manifest = JSON.parse(await readFile(join(build, '.vite/manifest.json'), 'utf8'));
  for (const source of Object.values(figureSources)) {
    assert.ok(Object.values(manifest).some(entry => entry.src?.includes(source.revision) && entry.src.endsWith('/index.mjs') && entry.isDynamicEntry));
  }
  report.production = [];
  for (const file of await readdir(join(build, 'assets'))) {
    const bytes = await readFile(join(build, 'assets', file));
    report.production.push({ file, bytes: bytes.length, gzipBytes: gzipSync(bytes).length });
  }
  const repo = fileURLToPath(new URL('../../../../', import.meta.url));
  report.dependencyManifest = JSON.parse(await readFile(join(repo, '.codus/visual-fixtures/dependencies.json'), 'utf8'));
  report.ok = true;
} catch (error) { report.ok = false; report.error = String(error); process.exitCode = 1; }
finally { await browser.close(); await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); }
console.log(JSON.stringify({ ok: report.ok, rows: report.rows.length, behavior: report.behavior, production: report.production, error: report.error }, null, 2));
