import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const require = createRequire('/tmp/andes53-tools/package.json');
const { chromium } = require('playwright-core');
const { AxeBuilder } = require('@axe-core/playwright');
const output = resolve('evidence/visual-review/hairline-d8eea894/raw');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const origin = 'http://127.0.0.1:3056';
const source = '/private/tmp/andes56-d8eea894/web/src/visuals/hairline';
const report = { candidate: 'd8eea894d90af249ec2d81689f629fabc5c476f0', checks: [], observations: [], errors: [], failures: [] };
const record = (name, detail) => { report.checks.push({ name, detail }); console.log(`PASS ${name}`); };
const ready = page => page.waitForFunction(() => document.querySelector('figcaption') && [...document.images].every(e => e.complete && e.naturalWidth > 0));
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript({ content: await readFile('evidence/visual-review/probe.js', 'utf8') });
  const page = await context.newPage();
  page.on('pageerror', e => report.errors.push(e.message));
  page.on('response', r => { if (r.status() >= 400) report.failures.push({ status: r.status(), url: r.url() }); });
  const requests = [];
  page.on('request', r => requests.push(r.url()));
  await page.goto(origin);
  await ready(page);
  assert.equal(await page.locator('[data-hairline]').count(), 0);
  assert(!requests.some(url => /PhoneCanvas|hairline_react/.test(url)));
  record('Default does not load or mount the animation engine', requests);
  const sizes = [[360,800],[390,844],[430,932],[1440,900],[1920,1080]];
  for (const locale of ['es','pt-BR']) {
    for (const [width,height] of sizes) {
      // Fresh compositor for each size: resizing after fullPage screenshots can
      // retain stale tiles in Chrome. Preserve both viewport and section evidence.
      const capture = await context.newPage();
      await capture.setViewportSize({ width, height });
      await capture.goto(origin);
      await capture.locator('select').selectOption(locale);
      await ready(capture);
      await capture.evaluate(async () => { await document.fonts.ready; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); });
      const measured = await capture.evaluate(() => ({ width: innerWidth, height: innerHeight,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        lang: document.documentElement.lang,
        targets: [...document.querySelectorAll('button,select,input')].map(e => ({ width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height })) }));
      assert.equal(measured.width,width); assert.equal(measured.height,height);
      assert.equal(measured.lang,locale); assert.equal(measured.overflow,0);
      assert(measured.targets.every(t => t.width >= 44 && t.height >= 44));
      await capture.screenshot({ path: `${output}/${locale}-${width}x${height}-viewport.png` });
      await capture.screenshot({ path: `${output}/${locale}-${width}x${height}-sections.png`, fullPage:true });
      report.observations.push({ locale,width,height,...measured });
      await capture.close();
    }
  }
  record('Both locales at five exact sizes: loaded images, zero overflow and 44px controls', sizes);
  await page.setViewportSize({ width:390,height:844 });
  for (const locale of ['es','pt-BR']) {
    await page.locator('select').selectOption(locale);
    await page.locator('button').focus();
    await page.keyboard.press('Enter');
    await page.locator('.andes-phone__frame').scrollIntoViewIfNeeded();
    await page.waitForSelector('[data-hairline] svg');
    const audit = await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    await writeFile(`${output}/axe-interactive-${locale}.json`, JSON.stringify(audit,null,2));
    assert.deepEqual(audit.violations.map(v=>v.id),[]);
    assert.equal(await page.locator('[aria-hidden=true][tabindex="0"]').count(),0);
    await page.locator('.andes-phone__frame').hover({position:{x:240,y:80}});
    await page.waitForTimeout(1600);
    await page.evaluate(() => andesVisualProbe.observe('.andes-phone'));
    const sample = await page.evaluate(() => andesVisualProbe.sample({durationMs:800}));
    assert.equal(sample.delta.callbacks,0); assert.equal(sample.delta.mutations,0);
    report.observations.push({ locale, interactiveIdle:sample });
    await page.screenshot({path:`${output}/interactive-${locale}.png`,fullPage:true});
    await page.getByRole('button').click();
    await page.waitForSelector('[data-hairline]',{state:'detached'});
  }
  record('Interactive states pass axe in both locales, have no hidden focus target and settle to zero RAF/mutations', 'Actual native Enter and pointer input');
  await page.locator('select').selectOption('es');
  const range = page.locator('input[type=range]');
  await range.focus(); await page.keyboard.press('End');
  assert.equal(await range.inputValue(),'1');
  await page.keyboard.press('Home'); assert.equal(await range.inputValue(),'0');
  await page.keyboard.press('ArrowRight'); assert.equal(await range.inputValue(),'0.5');
  assert.equal(await page.locator('[data-hairline]').count(),0);
  record('Home/End/Arrow keyboard controls change static poses without engine', '0 / 0.5 / 1');
  await page.getByRole('button').click();
  await page.locator('.andes-phone__frame').scrollIntoViewIfNeeded();
  await page.waitForSelector('[data-hairline] svg');
  await page.emulateMedia({ reducedMotion:'reduce' });
  await page.waitForSelector('[data-hairline]',{state:'detached'});
  assert(await page.locator('button').isDisabled());
  await range.focus(); await page.keyboard.press('End'); assert.equal(await range.inputValue(),'1');
  await page.screenshot({path:`${output}/reduced-motion.png`,fullPage:true});
  await page.emulateMedia({ reducedMotion:'no-preference' });
  await page.locator('.andes-phone__frame').scrollIntoViewIfNeeded();
  await page.waitForSelector('[data-hairline] svg');
  await page.evaluate(() => { document.querySelector('.andes-phone').style.marginTop='2000px'; scrollTo(0,0); });
  await page.waitForSelector('[data-hairline]',{state:'detached'});
  const offscreen = await page.evaluate(() => andesVisualProbe.sample({durationMs:800}));
  assert.equal(offscreen.delta.callbacks,0);
  report.observations.push({offscreen});
  await page.evaluate(() => { document.querySelector('.andes-phone').style.marginTop=''; });
  await page.locator('.andes-phone__frame').scrollIntoViewIfNeeded();
  await page.waitForSelector('[data-hairline] svg');
  record('Live reduced motion and real IntersectionObserver unmount/restore with zero offscreen RAF', 'Static range still works');
  const other = await context.newPage(); await other.goto('about:blank'); await other.bringToFront();
  await page.waitForTimeout(250);
  const hidden = await page.evaluate(() => ({ state:document.visibilityState,hidden:document.hidden,engines:document.querySelectorAll('[data-hairline]').length }));
  report.observations.push({nativeHidden:hidden});
  if (hidden.hidden) { assert.equal(hidden.engines,0); record('Native hidden browser tab unmounts engine',hidden); }
  else report.observations.push({limitation:'Headless Chrome kept both tabs visible; native hidden-tab proof unavailable, no physical-device claim'});
  await other.close(); await page.bringToFront();
  await page.getByRole('button').click(); await page.waitForSelector('[data-hairline]',{state:'detached'});
  await page.evaluate(async source => {
    const {mountVisual}=await import(source+'/index.mjs');
    const host=document.createElement('div'); host.id='independent-bridge';
    host.append(document.createTextNode('Owner caption stays')); document.querySelector('main').prepend(host);
    window.reviewBridge={host,mountVisual};
  }, '/@fs'+source);
  for(let cycle=0;cycle<4;cycle++) {
    await page.evaluate(() => {
      const b=window.reviewBridge; b.controller=new AbortController();
      b.handle=b.mountVisual(b.host,{locale:'pt-BR',motion:'interactive',signal:b.controller.signal});
    });
    await page.locator('#independent-bridge').scrollIntoViewIfNeeded();
    await page.waitForSelector('#independent-bridge [data-hairline] svg');
    await page.evaluate(() => { const b=window.reviewBridge;b.controller.abort();b.handle.destroy();b.handle.setMotion('interactive'); });
    assert.equal(await page.locator('#independent-bridge').textContent(),'Owner caption stays');
  }
  await page.evaluate(() => { reviewBridge.host.remove(); andesVisualProbe.observe('main'); });
  const afterUnmount=await page.evaluate(() => andesVisualProbe.sample({durationMs:800}));
  assert.equal(afterUnmount.delta.callbacks,0); assert.equal(afterUnmount.delta.mutations,0);
  report.observations.push({afterUnmount});
  record('Four real bridge mount/abort/destroy cycles preserve sibling text and leave zero RAF/mutations', 'No claim of heap/listener leak proof');
  const noJS=await browser.newPage({viewport:{width:390,height:844},javaScriptEnabled:false});
  await noJS.goto(origin); await noJS.waitForTimeout(300);
  assert(await noJS.getByText('Con la página cerrada',{exact:false}).isVisible());
  assert(await noJS.getByText('Com a página fechada',{exact:false}).isVisible());
  assert(await noJS.locator('img').evaluate(e=>e.complete&&e.naturalWidth>0));
  await noJS.screenshot({path:`${output}/no-js.png`,fullPage:true});await noJS.close();
  record('No-JS fixture contains both factual captions and a loaded still', 'Host integration remains55 responsibility');
  const detail=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:4});
  await detail.goto(origin);await ready(detail);
  await detail.locator('.andes-phone__frame').screenshot({path:`${output}/detail-4x.png`}); await detail.close();
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.failures,[]);
  assert(requests.every(url=>new URL(url).origin===origin));
  record('Clean source-bound runtime/network and local-only requests',requests);
} catch(error) { report.failure=error.stack; throw error; }
finally { await writeFile(`${output}/independent-results.json`,JSON.stringify(report,null,2));await browser.close(); }
