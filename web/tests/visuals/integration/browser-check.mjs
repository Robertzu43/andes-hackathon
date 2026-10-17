import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';

// The installed Codus skill supplies a small CDP client, not an app dependency.
// The embedded Codus browser remains the interactive smoke-check surface.
const helper = process.env.CODUS_BROWSER_HELPER ?? join(homedir(), '.claude/skills/codus-site-seo/scripts/browser.mjs');
const { launchBrowser, pause } = await import(pathToFileURL(helper).href);
const [base = 'http://localhost:3055', output = '/tmp/andes-visual-integration-evidence'] = process.argv.slice(2);
const origin = new URL(base);
assert.ok(['localhost', '127.0.0.1'].includes(origin.hostname), 'fixture evidence must stay on loopback');
await mkdir(output, { recursive: true });
const browser = await launchBrowser();
const report = {
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceState: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
  base, capturedAt: new Date().toISOString(), rows: [], controls: [], limitations: [
    'Synthetic adapter fixture, not an integrated app or finished Hairline/Anatomy figure',
    'Browser viewport/touch emulation is not physical iPhone qualification',
    'Automated accessibility checks and captures require independent visual and screen-reader review',
    'Gzip sizes are stripped standalone module sizes, not the production application bundle',
  ],
};

async function wait(page, predicate) {
  for (let i = 0; i < 100; i++) { if (await page.evaluate(predicate)) return; await pause(30); }
  throw new Error('Fixture did not reach the expected state');
}
async function open(query = '', viewport = { width: 390, height: 844 }) {
  const page = await browser.newPage();
  const listener = event => {
    if (event.sessionId !== page.sessionId) return;
    if (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') page.errors.push('console.error');
    if (event.method === 'Network.loadingFailed') page.errors.push(event.params.errorText);
  };
  page.protocol.listeners.add(listener);
  const close = page.close.bind(page);
  page.close = async () => { page.protocol.listeners.delete(listener); await close(); };
  await page.setViewport({ ...viewport, mobile: viewport.width <= 500 });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  assert.equal((await page.goto(new URL(query, base).href)).status(), 200);
  return page;
}

try {
  for (const locale of ['es', 'pt-BR']) for (const kind of ['phone', 'relay']) {
    for (const [width, height] of [[390, 844], [1440, 900], [1920, 1080], [360, 800], [430, 932]]) {
      const page = await open(`/?locale=${locale}&kind=${kind}`, { width, height });
      await wait(page, () => document.querySelector('[data-visual]')?.dataset.visualState === 'ready');
      const metrics = await page.evaluate(() => {
        const primary = document.querySelector('#primary-action').getBoundingClientRect();
        const root = document.querySelector('[data-visual]');
        const buttons = [...root.querySelectorAll('button')].filter(el => el.getClientRects().length);
        return {
          width: innerWidth, height: innerHeight,
          overflow: document.documentElement.scrollWidth > innerWidth,
          primaryInFold: primary.top >= 0 && primary.bottom <= innerHeight,
          title: document.querySelector('h1').textContent,
          caption: document.querySelector('figcaption').textContent.trim(),
          minButtonHeight: Math.min(...buttons.map(el => el.getBoundingClientRect().height)),
          unnamedControls: buttons.filter(el => !(el.textContent || el.getAttribute('aria-label')).trim()).length,
          svgLabel: root.querySelector('svg').getAttribute('aria-label'),
          noAutoplayFrames: root.querySelector('.andes-visual__art').dataset.frames,
          status: root.dataset.visualMotion,
          headingOrder: [...document.querySelectorAll('h1,h2,h3')].map(el => el.tagName),
          textColours: [...new Set([...root.querySelectorAll('p,li,h3,button')].map(el => getComputedStyle(el).color))],
          background: getComputedStyle(root).backgroundColor,
        };
      });
      assert.equal(metrics.width, width); assert.equal(metrics.height, height);
      assert.equal(metrics.overflow, false); assert.equal(metrics.primaryInFold, true);
      assert.ok(metrics.minButtonHeight >= 44); assert.equal(metrics.unnamedControls, 0);
      assert.equal(metrics.noAutoplayFrames, '0'); assert.ok(metrics.svgLabel);
      assert.deepEqual(metrics.headingOrder, ['H1', 'H2', 'H3']);
      const luminance = colour => colour.match(/[\d.]+/g).slice(0, 3).map(Number).map(c => {
        c /= 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
      }).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
      const background = luminance(metrics.background);
      metrics.textContrast = metrics.textColours.map(colour => {
        const text = luminance(colour); return { colour, ratio: (Math.max(text, background) + .05) / (Math.min(text, background) + .05) };
      });
      assert.ok(metrics.textContrast.every(row => row.ratio >= 4.5));
      const stem = `${locale}-${kind}-${width}x${height}`;
      await page.screenshot({ path: join(output, `${stem}.png`) });
      await page.screenshot({ path: join(output, `${stem}-full.png`), fullPage: true });
      assert.deepEqual(page.errors, []);
      report.rows.push({ locale, kind, ...metrics, screenshot: `${stem}.png`, fullScreenshot: `${stem}-full.png`, errors: page.errors });
      await page.close();
    }
  }

  const page = await open('/?locale=es&kind=phone');
  await wait(page, () => document.querySelector('[data-visual]')?.dataset.visualState === 'ready');
  await page.evaluate(() => window.visualFixture.handle.destroy());
  report.lifecycle = await page.evaluate(async () => (await import('/tests/visuals/integration/lifecycle-tests.ts')).runLifecycleTests());
  assert.ok(report.lifecycle.passed, JSON.stringify(report.lifecycle.cases.filter(row => !row.passed)));
  await page.close();

  const offscreen = await open('/?offscreen&locale=pt-BR');
  await pause(100);
  assert.equal(await offscreen.evaluate(() => document.querySelector('[data-visual]').dataset.imports), undefined);
  await offscreen.evaluate(() => document.querySelector('[data-visual]').scrollIntoView());
  await wait(offscreen, () => document.querySelector('[data-visual]')?.dataset.visualState === 'ready');
  // Real trusted keyboard input, not a synthetic click, enables motion and exercises a static step.
  await offscreen.evaluate(() => document.querySelector('button[data-visual-motion]').focus());
  await offscreen.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await offscreen.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await pause(100);
  let frameCount = await offscreen.evaluate(() => Number(document.querySelector('.andes-visual__art').dataset.frames));
  assert.ok(frameCount > 0, 'keyboard did not enable motion');
  await offscreen.evaluate(() => scrollTo(0, 0)); await pause(100);
  frameCount = await offscreen.evaluate(() => Number(document.querySelector('.andes-visual__art').dataset.frames));
  await pause(120);
  assert.equal(await offscreen.evaluate(() => Number(document.querySelector('.andes-visual__art').dataset.frames)), frameCount);
  await offscreen.evaluate(() => document.querySelector('[data-visual]').scrollIntoView()); await pause(100);
  assert.equal(await offscreen.evaluate(() => Number(document.querySelector('.andes-visual__art').dataset.frames)), frameCount);
  await offscreen.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await pause(60);
  assert.ok(await offscreen.evaluate(() => document.querySelector('button[data-visual-motion]').hidden));
  const target = await offscreen.evaluate(() => {
    const button = document.querySelector('.andes-visual__art button');
    button.scrollIntoView(); const rect = button.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  await offscreen.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...target, id: 1 }] });
  await offscreen.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.equal(await offscreen.evaluate(() => document.querySelector('.andes-visual__art').dataset.steps), '1');
  await offscreen.screenshot({ path: join(output, 'pt-BR-reduced-motion-touch.png'), fullPage: true });
  report.controls.push('Trusted Enter enables motion; real intersection stops frames and return stays still; reduced motion retains trusted touch static-step input');
  await offscreen.close();

  const failure = await open('/?failure&locale=pt-BR&kind=relay');
  await wait(failure, () => document.querySelector('[data-visual]').dataset.visualState === 'fallback');
  assert.ok(await failure.evaluate(() => !document.querySelector('[data-visual-fallback]').hidden && document.querySelector('figcaption').textContent.includes('Não confirma assistência')));
  await failure.screenshot({ path: join(output, 'pt-BR-import-failure.png'), fullPage: true });
  assert.deepEqual(failure.errors, []); await failure.close();
  report.controls.push('Rejected import retains translated caption, facts and enabled retry without console errors');

  const noJS = await browser.newPage(); await noJS.setViewport({ width: 390, height: 844, mobile: true });
  await noJS.send('Emulation.setScriptExecutionDisabled', { value: true });
  await noJS.goto(new URL('/?kind=relay&locale=es', base).href);
  // CDP's DOM snapshot works with script execution disabled.
  const snapshot = await noJS.send('DOMSnapshot.captureSnapshot', { computedStyles: [] });
  assert.ok(snapshot.strings.some(value => value.includes('La aceptación del servidor no confirma la entrega')));
  await noJS.screenshot({ path: join(output, 'es-no-javascript.png'), fullPage: true });
  await noJS.close(); report.controls.push('With JavaScript disabled, caption and evidence stages remain in the browser DOM');

  const detail = await open('/?locale=pt-BR&kind=relay', { width: 390, height: 844 });
  await wait(detail, () => document.querySelector('[data-visual]')?.dataset.visualState === 'ready');
  const rect = await detail.evaluate(() => {
    const r = document.querySelector('[data-visual]').getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, scale: 4 };
  });
  await detail.screenshot({ path: join(output, 'pt-BR-relay-detail-4x.png'), clip: rect });
  await detail.close();

  const files = ['host.ts', 'shell.ts', 'copy.ts', 'index.ts'];
  report.modules = [];
  for (const name of files) {
    const source = stripTypeScriptTypes(await readFile(new URL(`../../../src/visuals/integration/${name}`, import.meta.url), 'utf8'));
    report.modules.push({ name, strippedBytes: Buffer.byteLength(source), gzipBytes: gzipSync(source).byteLength });
  }
  report.ok = true;
} catch (error) {
  report.ok = false; report.error = String(error); process.exitCode = 1;
} finally {
  await browser.close();
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ ok: report.ok, captures: report.rows.length, lifecycleCases: report.lifecycle?.cases.length, controls: report.controls, modules: report.modules, error: report.error }, null, 2));
