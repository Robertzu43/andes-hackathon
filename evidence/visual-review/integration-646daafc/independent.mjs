import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
const require=createRequire('/tmp/andes53-tools/package.json');
const {chromium}=require('playwright-core');const {AxeBuilder}=require('@axe-core/playwright');
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const report={candidate:'646daafc75ee16dd0a90ef7322ed4e9ba1045af8',scope:'synthetic adapter only',rows:[],errors:[]};
try{
  const context=await browser.newContext({viewport:{width:390,height:844}});
  for(const locale of ['es','pt-BR'])for(const kind of ['phone','relay']){
    const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
    await page.goto(`http://127.0.0.1:3056/?locale=${locale}&kind=${kind}`);
    await page.waitForFunction(()=>document.querySelector('[data-visual]').dataset.visualState==='ready');
    const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    const primary=await page.locator('#primary-action').evaluate(e=>{
      const r=e.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
      return {inFold:r.top>=0&&r.bottom<=innerHeight,unobscured:hit===e||e.contains(hit)};
    });
    assert(primary.inFold&&primary.unobscured);assert.deepEqual(audit.violations.map(v=>v.id),[]);
    await page.locator('#primary-action').click();assert(page.url().endsWith('#primary-result'));
    report.rows.push({locale,kind,primary,axeViolations:[],localAnchor:true});await page.close();
  }
  const failed=await context.newPage();await failed.goto('http://127.0.0.1:3056/?failure&locale=pt-BR&kind=relay');
  await failed.waitForFunction(()=>document.querySelector('[data-visual]').dataset.visualState==='fallback');
  const state=await failed.locator('[data-visual]').evaluate(root=>({caption:root.querySelector('figcaption').textContent,status:root.querySelector('[role=status]').textContent,retry:root.querySelector('[data-visual-explore]').textContent,fallback:!root.querySelector('[data-visual-fallback]').hidden}));
  assert(state.fallback);assert(!state.status.includes('Synthetic'));assert(state.retry.length>0);
  report.failureRecovery=state;await failed.close();assert.deepEqual(report.errors,[]);
  console.log(JSON.stringify(report));
}finally{await writeFile('evidence/visual-review/integration-646daafc/raw/independent-results.json',JSON.stringify(report,null,2));await browser.close()}
