import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
const require=createRequire('/tmp/andes53-tools/package.json');
const {chromium}=require('playwright-core');
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const observations={candidate:'d8eea894d90af249ec2d81689f629fabc5c476f0'};
try {
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await context.addInitScript({content:await readFile('evidence/visual-review/probe.js','utf8')});
  const page=await context.newPage();await page.goto('http://127.0.0.1:3056/');
  await page.getByRole('button').tap();
  await page.locator('.andes-phone__frame').scrollIntoViewIfNeeded();await page.waitForSelector('[data-hairline] svg');
  const box=await page.locator('[data-hairline]').boundingBox();
  const session=await context.newCDPSession(page);
  const before=await page.evaluate(()=>scrollY);
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height*.8}]});
  for(let step=1;step<=8;step++) {
    await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height*.8-step*18}]});
    await page.waitForTimeout(25);
  }
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.waitForTimeout(200);
  const after=await page.evaluate(()=>scrollY);assert(after>before);
  observations.trustedTouchPan={before,after,delta:after-before};
  await page.locator('.andes-phone__frame').scrollIntoViewIfNeeded();await page.waitForSelector('[data-hairline] svg');
  await page.evaluate(()=>{
    andesVisualProbe.observe('.andes-phone');
    Object.defineProperty(document,'hidden',{configurable:true,value:true});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForSelector('[data-hairline]',{state:'detached'});
  observations.simulatedHidden=await page.evaluate(()=>andesVisualProbe.sample({durationMs:800}));
  assert.equal(observations.simulatedHidden.delta.callbacks,0);
  await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForSelector('[data-hairline] svg');
  observations.hiddenRestored=true;
  observations.limits='Visibility event is controlled/synthetic; headless tab switching and minimizing kept document.visibilityState visible. No physical iPhone or native hidden-tab qualification.';
  console.log(JSON.stringify({touchPan:observations.trustedTouchPan,hiddenRAF:observations.simulatedHidden.delta,restored:true}));
} finally {await writeFile('evidence/visual-review/hairline-d8eea894/raw/lifecycle.json',JSON.stringify(observations,null,2));await browser.close();}
