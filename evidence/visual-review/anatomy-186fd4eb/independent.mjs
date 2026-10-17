import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
const require=createRequire('/tmp/andes53-tools/package.json');
const {chromium}=require('playwright-core');const {AxeBuilder}=require('@axe-core/playwright');
const output='evidence/visual-review/anatomy-186fd4eb/raw';await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const report={candidate:'186fd4eb4688961de183af9283154b14da933ce9',rows:[],errors:[],checks:[],capabilityFinding:null};
const origin='http://127.0.0.1:3056';
try {
  for(const locale of ['es','pt-BR'])for(const [width,height]of [[360,800],[390,844],[430,932],[1440,900],[1920,1080]]){
    const page=await browser.newPage({viewport:{width,height}});
    page.on('pageerror',e=>report.errors.push(e.message));
    await page.goto(`${origin}/web/tests/visuals/anatomy/preview-${locale}.html`);
    await page.waitForSelector('button[data-example]');
    const errors=[];for(const state of ['local','accepted','unconfirmed','acknowledged']){
      await page.locator(`[data-example=${state}]`).focus();await page.keyboard.press('Enter');
      await page.waitForTimeout(350);
      const observed=await page.evaluate(()=>({state:document.querySelector('.andes-relay').dataset.relayExample,
        facts:[...document.querySelectorAll('[data-relay-fact]')].map(n=>n.textContent),
        pose:[...document.querySelectorAll('[data-relay-motion]')].map(n=>({part:n.dataset.relayMotion,transform:n.getAttribute('transform')})),
        overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
        targets:[...document.querySelectorAll('button')].map(n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height}))}));
      assert.equal(observed.state,state);assert.equal(observed.overflow,0);assert(observed.targets.every(t=>t.width>=44&&t.height>=44));
      assert.equal(observed.facts[1],locale==='es'?'Sin confirmar':'Não confirmada');
      assert.equal(observed.facts[3],locale==='es'?'Sin confirmar':'Não confirmada');
      if(state==='accepted')report.currentAccepted=observed.pose;
      if(state==='unconfirmed')assert.deepEqual(observed.pose,report.currentAccepted);
      errors.push({state,delivery:observed.facts[1],help:observed.facts[3]});
    }
    await page.locator('[data-example=accepted]').click();await page.waitForTimeout(350);
    await page.evaluate(()=>scrollTo(0,0));
    await page.screenshot({path:`${output}/${locale}-${width}x${height}-viewport.png`});
    await page.screenshot({path:`${output}/${locale}-${width}x${height}-sections.png`,fullPage:true});
    report.rows.push({locale,width,height,states:errors});await page.close();
  }
  delete report.currentAccepted;
  report.checks.push('40 exact state/locale/viewport cases: source-attributed delivery/help remain unknown, accepted/unconfirmed poses identical, 44px controls, zero overflow');
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const page=await context.newPage();
  await page.addInitScript(()=>{
    const add=EventTarget.prototype.addEventListener;window.reviewVisibilityCalls=0;
    EventTarget.prototype.addEventListener=function(type,listener,options){
      if(this===document&&type==='visibilitychange'&&typeof listener==='function'){
        const original=listener;listener=function(...args){window.reviewVisibilityCalls++;return original.apply(this,args)};
      }
      return add.call(this,type,listener,options);
    };
  });
  await page.goto(`${origin}/web/tests/visuals/anatomy/preview-es.html`);await page.waitForSelector('button[data-example]');
  for(const state of ['local','acknowledged']){
    await page.locator(`[data-example=${state}]`).click();await page.waitForTimeout(350);
    const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    await writeFile(`${output}/axe-${state}.json`,JSON.stringify(axe,null,2));
    report.checks.push({axeState:state,violations:axe.violations.map(v=>({id:v.id,impact:v.impact}))});
  }
  await page.locator('[data-example=local]').focus();await page.keyboard.press('End');
  assert.equal(await page.locator('.andes-relay').getAttribute('data-relay-example'),'acknowledged');
  await page.keyboard.press('Home');assert.equal(await page.locator('.andes-relay').getAttribute('data-relay-example'),'local');
  await page.emulateMedia({reducedMotion:'reduce'});await page.locator('[data-example=acknowledged]').click();
  await page.screenshot({path:`${output}/reduced.png`,fullPage:true});
  report.checks.push('Native End/Home and reduced-motion example selection preserve semantic state');
  report.capabilityFinding=await page.evaluate(async()=>{
    window.relay.destroy();
    const Native=window.IntersectionObserver;window.IntersectionObserver=undefined;
    const {mountVisual}=await import('/web/src/visuals/anatomy/index.mjs');
    const host=document.createElement('section');document.querySelector('main').append(host);
    const controller=new AbortController();const baseline=window.reviewVisibilityCalls;let error;
    try{mountVisual(host,{locale:'es',motion:'still',signal:controller.signal})}catch(e){error=e.message}
    controller.abort();document.dispatchEvent(new Event('visibilitychange'));
    const before=host.querySelector('.andes-relay')?.dataset.relayExample;
    host.querySelector('[data-example=acknowledged]')?.click();
    const after=host.querySelector('.andes-relay')?.dataset.relayExample;
    window.IntersectionObserver=Native;
    return {error,visibilityCallbacksAfterExternalAbort:window.reviewVisibilityCalls-baseline,before,after,returnedInstance:false};
  });
  console.log(JSON.stringify(report.capabilityFinding));
  assert(report.capabilityFinding.error);assert.equal(report.capabilityFinding.visibilityCallbacksAfterExternalAbort,1);
  assert.equal(report.capabilityFinding.after,'acknowledged');
  await page.close();
  const noJS=await browser.newPage({viewport:{width:390,height:844},javaScriptEnabled:false});
  await noJS.goto(`${origin}/web/tests/visuals/anatomy/preview-es.html`);
  assert.equal(await noJS.locator('[data-relay-static] li').count(),4);
  await noJS.screenshot({path:`${output}/no-js.png`,fullPage:true});await noJS.close();
  const zoom=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:4});
  await zoom.goto(`${origin}/web/tests/visuals/anatomy/preview-es.html`);await zoom.waitForSelector('button[data-example]');
  await zoom.locator('.iso-plate').screenshot({path:`${output}/detail-4x.png`});await zoom.close();
  assert.deepEqual(report.errors,[]);
  report.verdict='changes-requested: missing IntersectionObserver throws after listeners and leaves resources alive after outer abort';
}finally{await writeFile(`${output}/independent-results.json`,JSON.stringify(report,null,2));await browser.close()}
