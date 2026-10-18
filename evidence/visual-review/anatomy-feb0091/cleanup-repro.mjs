import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
const require=createRequire('/tmp/andes53-tools/package.json');
const {chromium}=require('playwright-core');
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const report={candidate:'feb009167e3ae064d4480dc87d65c3b5b7fdbfcd',provenance:'Original component56 missing-IO probe, with returned-handle/static observations added; identical abort, visibility and old-button actions',rows:[]};
try {
  for(const locale of ['es','pt-BR']) {
    const page=await browser.newPage({viewport:{width:390,height:844}});
    await page.addInitScript(()=>{
      const add=EventTarget.prototype.addEventListener;window.reviewVisibilityCalls=0;
      EventTarget.prototype.addEventListener=function(type,listener,options){
        if(this===document&&type==='visibilitychange'&&typeof listener==='function'){
          const original=listener;listener=function(...args){window.reviewVisibilityCalls++;return original.apply(this,args)};
        }
        return add.call(this,type,listener,options);
      };
    });
    await page.goto(`http://127.0.0.1:3056/web/tests/visuals/anatomy/preview-${locale}.html`);
    await page.waitForSelector('button[data-example]');
    const result=await page.evaluate(async locale=>{
      window.relay.destroy();
      const Native=window.IntersectionObserver;window.IntersectionObserver=undefined;
      const {mountVisual}=await import('/web/src/visuals/anatomy/index.mjs');
      const host=document.createElement('section');document.querySelector('main').append(host);
      const controller=new AbortController();const baseline=window.reviewVisibilityCalls;let error=null,handle;
      try{handle=mountVisual(host,{locale,motion:'still',signal:controller.signal})}catch(e){error=e.message}
      controller.abort();document.dispatchEvent(new Event('visibilitychange'));
      const before=host.querySelector('.andes-relay')?.dataset.relayExample??null;
      host.querySelector('[data-example=acknowledged]')?.click();
      const after=host.querySelector('.andes-relay')?.dataset.relayExample??null;
      window.IntersectionObserver=Native;
      const root=host.querySelector('.andes-relay');
      return {locale,error,visibilityCallbacksAfterExternalAbort:window.reviewVisibilityCalls-baseline,before,after,
        returnedInstance:Boolean(handle),staticExamples:root.querySelectorAll('[data-relay-static] li').length,
        controlsHidden:root.querySelector('[data-relay-controls]').hidden,staticVisible:!root.querySelector('[data-relay-static]').hidden};
    },locale);
    report.rows.push(result);
    assert.equal(result.error,null);assert.equal(result.visibilityCallbacksAfterExternalAbort,0);
    assert.equal(result.before,result.after);assert.ok(result.returnedInstance);
    assert.equal(result.staticExamples,4);assert.ok(result.controlsHidden&&result.staticVisible);
    await page.screenshot({path:`evidence/visual-review/anatomy-feb0091/raw/${locale}-missing-io.png`,fullPage:true});
    await page.close();
  }
  report.ok=true;
} finally {
  await writeFile('evidence/visual-review/anatomy-feb0091/raw/cleanup-repro.json',JSON.stringify(report,null,2)+'\n');
  await browser.close();
}
console.log(JSON.stringify(report));
