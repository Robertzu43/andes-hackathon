import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
const require=createRequire('/tmp/andes53-tools/package.json');
const {chromium}=require('playwright-core');const {AxeBuilder}=require('@axe-core/playwright');
const output='/Users/sebasbimbi/.codus/workspaces/andes-visual-review/evidence/visual-review/integration-8c54a17/raw';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const report={candidate:'8c54a17793bb6133d462cfa2598bcefe72c79590',foundation:'6f8dc52a566d3880cf1f10bbfd5282a888725ca1',scope:'Independent changed binding checks in the actual FoundationRoot fixture; unconfigured/demo session; no feature/API acceptance',rows:[],errors:[]};
try {
  for(const locale of ['es','pt-BR'])for(const kind of ['phone','relay']) {
    const context=await browser.newContext({viewport:{width:360,height:800}});
    const page=await context.newPage();
    page.on('pageerror',e=>report.errors.push(e.message));
    await page.goto(`http://127.0.0.1:3056/?locale=${locale}&art=${kind}`);
    await page.waitForSelector('#primary-action');
    const primary=await page.locator('#primary-action').evaluate(e=>{
      const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
      return {inFold:r.top>=0&&r.bottom<=innerHeight,unobscured:hit===e||e.contains(hit),height:r.height};
    });
    assert.ok(primary.inFold&&primary.unobscured&&primary.height>=56);
    assert.equal(await page.evaluate(()=>performance.getEntriesByType('resource').filter(r=>/PhoneCanvas-|hairline-|anatomy-/.test(r.name)).length),0);
    await page.locator('#visual-disclosure').focus();await page.keyboard.press('Enter');
    await page.waitForFunction(()=>document.querySelector('[data-visual]')?.dataset.visualState==='ready');
    await page.waitForSelector(kind==='phone'?'.andes-phone-mount input':'.andes-relay button[data-example]');
    if(kind==='relay')await page.locator('[data-example=acknowledged]').click();
    const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    await writeFile(`${output}/axe-${locale}-${kind}.json.gz`,gzipSync(JSON.stringify(audit,null,2)+'\n'));
    assert.deepEqual(audit.violations.map(v=>v.id),[]);
    await page.evaluate(()=>scrollTo(0,0));
    await page.screenshot({path:`${output}/${locale}-${kind}-360-sections.png`,fullPage:true});
    const observed=await page.evaluate(()=>{
      const pixels=value=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const context=canvas.getContext('2d');context.fillStyle=value;context.fillRect(0,0,1,1);return [...context.getImageData(0,0,1,1).data]};
      const style=getComputedStyle(document.querySelector('[data-visual]'));
      return {
      overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
      shellCount:document.querySelectorAll('.andes-app').length,languageCount:document.querySelectorAll('.andes-language').length,
      caption:document.querySelector('[data-visual]>figcaption').textContent.trim(),
      color:style.color,background:style.backgroundColor,
      colorRGBA:pixels(style.color),backgroundRGBA:pixels(style.backgroundColor),
      motion:document.querySelector('[data-visual]').dataset.visualMotion,
      engineRequested:performance.getEntriesByType('resource').some(r=>/PhoneCanvas-/.test(r.name)),
    }});
    assert.equal(observed.overflow,0);assert.equal(observed.shellCount,1);assert.equal(observed.languageCount,1);
    assert.deepEqual(observed.colorRGBA,[23,49,57,255]);assert.deepEqual(observed.backgroundRGBA,[252,253,253,255]);
    assert.equal(observed.motion,'still');assert.equal(observed.engineRequested,false);
    await page.evaluate(()=>window.__retainedArt=document.querySelector('.andes-visual__art'));
    await page.locator('#primary-action').click();
    assert.ok((await page.locator('#primary-result').textContent()).endsWith('1'));
    assert.ok(await page.evaluate(()=>window.__retainedArt===document.querySelector('.andes-visual__art')&&!!window.__retainedArt.querySelector('svg,img')));
    const next=locale==='es'?'pt-BR':'es';
    await page.locator('.andes-language select').selectOption(next);
    await page.waitForFunction(next=>document.querySelector('[data-visual]')?.lang===next&&document.querySelector('[data-visual]')?.dataset.visualState==='ready',next);
    await page.waitForSelector(kind==='phone'?'.andes-phone-mount input':'.andes-relay button[data-example]');
    assert.ok(await page.evaluate(()=>!window.__retainedArt.isConnected));
    assert.equal(await page.locator('[data-visual]').getAttribute('data-visual-motion'),'still');
    const translated=await page.locator('[data-visual]>figcaption').textContent();
    assert.notEqual(translated.trim(),observed.caption);
    await page.locator('#mount-toggle').click();assert.equal(await page.locator('[data-visual]').count(),0);
    await page.locator('#mount-toggle').click();
    await page.waitForFunction(()=>document.querySelector('[data-visual]')?.dataset.visualState==='ready');
    await page.locator('#visual-disclosure').focus();await page.keyboard.press('Enter');
    await page.waitForFunction(()=>!document.querySelector('[data-visual]'));
    report.rows.push({locale,kind,width:360,height:800,primary,...observed,axeViolations:[],parentRerenderRetainsArt:true,localeRemountAtRest:next,removeRemount:true,disclosureDisposes:true});
    await context.close();
  }
  const context=await browser.newContext({viewport:{width:390,height:844}});const page=await context.newPage();
  await page.goto('http://127.0.0.1:3056/?failure&locale=pt-BR&art=relay');
  await page.locator('#visual-disclosure').click();
  await page.waitForFunction(()=>document.querySelector('[data-visual]')?.dataset.visualState==='fallback');
  const fallback=await page.locator('[data-visual]').evaluate(root=>({caption:root.querySelector('figcaption').textContent,status:root.querySelector('[role=status]').textContent,retry:root.querySelector('[data-visual-explore]').textContent,visible:!root.querySelector('[data-visual-fallback]').hidden}));
  assert.ok(fallback.visible&&fallback.retry.trim());assert.ok(!fallback.status.includes('Synthetic'));
  await page.locator('#primary-action').click();assert.ok((await page.locator('#primary-result').textContent()).endsWith('1'));
  await page.screenshot({path:`${output}/failure-primary.png`,fullPage:true});report.fallback=fallback;
  await context.close();assert.deepEqual(report.errors,[]);report.ok=true;
} finally {await writeFile(`${output}/independent-results.json`,JSON.stringify(report,null,2)+'\n');await browser.close()}
console.log(JSON.stringify({ok:report.ok,rows:report.rows.length,errors:report.errors}));
