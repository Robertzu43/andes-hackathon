import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
const require=createRequire('/tmp/andes53-tools/package.json');
const {chromium}=require('playwright-core');
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  await page.addInitScript(()=>{
    const Native=window.IntersectionObserver;window.reviewObservers=[];
    window.IntersectionObserver=class extends Native {
      constructor(callback,options){super(callback,options);this.callback=callback;this.targets=new Set();window.reviewObservers.push(this);}
      observe(node){this.targets.add(node);super.observe(node)}
      disconnect(){this.targets.clear();super.disconnect()}
    };
  });
  await page.goto('http://127.0.0.1:3056/');await page.getByRole('button').click();
  await page.waitForSelector('[data-hairline] svg');
  const result={candidate:'d8eea894d90af249ec2d81689f629fabc5c476f0',fixture:'controlled batched IntersectionObserver entries, exact unmodified source'};
  for(const states of [[true,false],[false,true]]) {
    await page.evaluate(states=>{
      const target=document.querySelector('.andes-phone__frame');
      const observer=window.reviewObservers.find(o=>o.targets.has(target));
      observer.callback(states.map(isIntersecting=>({target,isIntersecting})));
    },states);
    await page.waitForTimeout(150);
    result[states.join(',')]={latestVisible:states.at(-1),engineMounted:await page.locator('[data-hairline]').count()>0};
  }
  await writeFile('evidence/visual-review/hairline-d8eea894/raw/batched-io-finding.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
}finally{await browser.close()}
