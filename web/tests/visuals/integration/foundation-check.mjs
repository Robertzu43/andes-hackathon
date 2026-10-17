import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, readdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const { launchBrowser, pause } = await import(pathToFileURL(process.env.CODUS_BROWSER_HELPER
  ?? join(homedir(), '.claude/skills/codus-site-seo/scripts/browser.mjs')).href);
const [base = 'http://localhost:3055', output = '/tmp/andes55-foundation-evidence'] = process.argv.slice(2);
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
await mkdir(output, { recursive: true });
const browser = await launchBrowser();
const report = {
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceState: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
  foundation: '6f8dc52a566d3880cf1f10bbfd5282a888725ca1',
  base, rows: [], behavior: [], limitations: [
    'Uses the real shared shell/router/locale with a synthetic visual module, not finished Hairline or Anatomy',
    'No real session, API, trip, alert, delivery, physical-device or human comprehension acceptance',
    'Production fixture chunks differ from an actual feature-owned application route bundle',
  ],
};
async function wait(page, test) {
  for (let i = 0; i < 100; i++) { if (await page.evaluate(test)) return; await pause(30); }
  throw new Error('Expected fixture state did not settle');
}
async function enter(page, selector) {
  await page.evaluate(selector => document.querySelector(selector).focus(), selector);
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13 });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
}
async function open(query = '', width = 390, height = 844) {
  const page = await browser.newPage();
  const listener = event => {
    if (event.sessionId !== page.sessionId) return;
    if (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') page.errors.push('console.error');
    if (event.method === 'Network.loadingFailed') page.errors.push(event.params.errorText);
  };
  page.protocol.listeners.add(listener);
  const close = page.close.bind(page);
  page.close = async () => { page.protocol.listeners.delete(listener); await close(); };
  await page.setViewport({ width, height, mobile: width <= 500 });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await page.goto(new URL('/' + query, base).href);
  await wait(page, () => !!document.querySelector('#visual-disclosure'));
  return page;
}

try {
  for (const locale of ['es', 'pt-BR']) for (const kind of ['phone', 'relay']) {
    for (const [width, height] of [[390,844], [1440,900], [1920,1080], [360,800], [430,932]]) {
      const page = await open(`?locale=${locale}&kind=${kind}`, width, height);
      const before = await page.evaluate(() => {
        const r = document.querySelector('#primary-action').getBoundingClientRect();
        return {
          mainVisible: r.top >= 0 && r.bottom <= innerHeight,
          optionalRequested: performance.getEntriesByType('resource').some(r => /fixture-module/.test(r.name)),
          shells: document.querySelectorAll('.andes-app').length,
          languages: document.querySelectorAll('.andes-language').length,
        };
      });
      assert.ok(before.mainVisible); assert.equal(before.optionalRequested, false);
      assert.equal(before.shells, 1); assert.equal(before.languages, 1);
      const stem = `${locale}-${kind}-${width}x${height}`;
      await page.screenshot({ path: join(output, `${stem}-closed.png`) });
      await enter(page, '#visual-disclosure');
      await wait(page, () => document.querySelector('[data-visual]')?.dataset.visualState === 'ready');
      const after = await page.evaluate(() => ({
        width: innerWidth, height: innerHeight, lang: document.querySelector('[data-visual]').lang,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        frames: document.querySelector('.andes-visual__art').dataset.frames,
        cssInk: getComputedStyle(document.querySelector('[data-visual]')).color,
        cssSurface: getComputedStyle(document.querySelector('[data-visual]')).backgroundColor,
        mainHeight: document.querySelector('#primary-action').getBoundingClientRect().height,
      }));
      assert.equal(after.width, width); assert.equal(after.height, height); assert.equal(after.lang, locale);
      assert.equal(after.overflow, false); assert.equal(after.frames, '0'); assert.ok(after.mainHeight >= 56);
      await page.screenshot({ path: join(output, `${stem}-open.png`), fullPage: true });
      assert.deepEqual(page.errors, []);
      report.rows.push({ locale, kind, ...before, ...after, errors: page.errors });
      await page.close();
    }
  }

  const page = await open();
  await enter(page, '#visual-disclosure');
  await wait(page, () => document.querySelector('[data-visual]')?.dataset.visualState === 'ready');
  await page.evaluate(() => { window.__retainedArt = document.querySelector('.andes-visual__art'); });
  await enter(page, '#primary-action');
  assert.ok(await page.evaluate(() => document.querySelector('#primary-result').textContent.endsWith('1')));
  assert.ok(await page.evaluate(() => window.__retainedArt === document.querySelector('.andes-visual__art') && window.__retainedArt.querySelector('svg')));
  report.behavior.push('Unrelated primary-action state updates retain the mounted artwork');

  await enter(page, 'button[data-visual-motion]');
  await pause(80);
  assert.ok(await page.evaluate(() => Number(document.querySelector('.andes-visual__art').dataset.frames) > 0));
  await page.evaluate(() => {
    const select = document.querySelector('.andes-language select'); select.value = 'pt-BR';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await wait(page, () => document.querySelector('[data-visual]')?.lang === 'pt-BR' && document.querySelector('[data-visual]')?.dataset.visualState === 'ready');
  assert.ok(await page.evaluate(() => window.__retainedArt.dataset.destroyed === 'true' && !window.__retainedArt.isConnected));
  assert.equal(await page.evaluate(() => document.querySelector('.andes-visual__art').dataset.frames), '0');
  assert.ok(await page.evaluate(() => document.querySelector('figcaption').textContent.includes('Seu silêncio')));
  report.behavior.push('The actual foundation language switch disposes the old module and remounts translated text at rest');

  await enter(page, 'button[data-visual-motion]');
  const background = await browser.newPage();
  await background.send('Page.bringToFront');
  await wait(page, () => document.hidden);
  const pausedFrames = await page.evaluate(() => document.querySelector('.andes-visual__art').dataset.frames);
  await pause(100);
  assert.equal(await page.evaluate(() => document.querySelector('.andes-visual__art').dataset.frames), pausedFrames);
  await page.send('Page.bringToFront');
  await wait(page, () => !document.hidden);
  await pause(80);
  assert.equal(await page.evaluate(() => document.querySelector('.andes-visual__art').dataset.frames), pausedFrames);
  await background.close();
  report.behavior.push('Native browser tab visibility stops frames and returning does not restart motion');

  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await wait(page, () => document.querySelector('button[data-visual-motion]').hidden);
  await enter(page, '.andes-visual__art button');
  assert.equal(await page.evaluate(() => document.querySelector('.andes-visual__art').dataset.steps), '1');
  await page.screenshot({ path: join(output, 'pt-BR-reduced-motion.png'), fullPage: true });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await wait(page, () => !document.querySelector('button[data-visual-motion]').hidden);
  report.behavior.push('Reduced motion retains a meaningful static keyboard action with the real shared locale');

  await page.evaluate(() => { window.__retainedArt = document.querySelector('.andes-visual__art'); });
  await enter(page, '#visual-disclosure'); await pause(60);
  assert.equal(await page.evaluate(() => window.__retainedArt.dataset.destroyed), 'true');
  await enter(page, '#visual-disclosure');
  await wait(page, () => document.querySelector('[data-visual]')?.dataset.visualState === 'ready');
  await enter(page, '#mount-toggle'); await pause(60);
  assert.equal(await page.evaluate(() => document.querySelector('[data-visual]')), null);
  await enter(page, '#mount-toggle');
  await wait(page, () => document.querySelector('[data-visual]')?.dataset.visualState === 'ready');
  report.behavior.push('StrictMode, disclosure close/reopen and explicit remove/remount leave one working host');

  await page.evaluate(() => { window.__retainedArt = document.querySelector('.andes-visual__art'); });
  await enter(page, 'button[data-visual-motion]');
  await enter(page, '#route-away');
  await wait(page, () => !!document.querySelector('#route-back'));
  const frames = await page.evaluate(() => window.__retainedArt.dataset.frames);
  await pause(100);
  assert.ok(await page.evaluate(frames => window.__retainedArt.dataset.destroyed === 'true' && window.__retainedArt.dataset.frames === frames, frames));
  await enter(page, '#route-back');
  await wait(page, () => !!document.querySelector('#visual-disclosure'));
  assert.equal(await page.evaluate(() => document.querySelector('[data-visual]')), null);
  assert.deepEqual(page.errors, []); await page.close();
  report.behavior.push('Existing shared-router navigation aborts the module; return starts with the optional explanation closed');

  const failure = await open('?failure&locale=pt-BR'); await enter(failure, '#visual-disclosure');
  await wait(failure, () => document.querySelector('[data-visual]')?.dataset.visualState === 'fallback');
  await enter(failure, '#primary-action');
  assert.ok(await failure.evaluate(() => document.querySelector('#primary-result').textContent.endsWith('1')));
  await failure.screenshot({ path: join(output, 'failure-primary-action.png'), fullPage: true });
  assert.deepEqual(failure.errors, []); await failure.close();
  report.behavior.push('An optional import failure preserves caption and the shared primary action');

  const build = process.env.VISUAL_FOUNDATION_BUILD ?? '/tmp/andes55-foundation-build';
  const manifest = JSON.parse(await readFile(join(build, '.vite/manifest.json'), 'utf8'));
  const optional = manifest['tests/visuals/integration/fixture-module.ts'];
  assert.ok(optional?.isDynamicEntry, 'optional module was included in the initial entry');
  report.production = { dynamicEntry: optional.file, files: [] };
  for (const file of await readdir(join(build, 'assets'))) {
    const bytes = await readFile(join(build, 'assets', file));
    report.production.files.push({ file, bytes: bytes.length, gzipBytes: gzipSync(bytes).length });
  }
  report.ok = true;
} catch (error) { report.ok = false; report.error = String(error); process.exitCode = 1; }
finally { await browser.close(); await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); }
console.log(JSON.stringify({ ok: report.ok, rows: report.rows.length, behavior: report.behavior, production: report.production, error: report.error }, null, 2));
