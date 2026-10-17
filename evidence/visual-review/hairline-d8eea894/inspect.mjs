import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
const require=createRequire('/tmp/andes53-tools/package.json');
const {chromium}=require('playwright-core');
const root='evidence/visual-review/hairline-d8eea894/raw';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
  const page=await browser.newPage({viewport:{width:2100,height:1600}});
  for(const locale of ['es','pt-BR']) {
    const cells=[];
    for(const suffix of ['viewport','sections']) for(const size of ['360x800','390x844','430x932','1440x900','1920x1080']) {
      const file=`${locale}-${size}-${suffix}.png`;
      const b64=(await readFile(`${root}/${file}`)).toString('base64');
      cells.push(`<figure><figcaption>${file}</figcaption><img src="data:image/png;base64,${b64}"></figure>`);
    }
    await page.setContent(`<html><style>body{margin:12px;background:#ddd;font:14px system-ui}main{display:grid;grid-template-columns:repeat(5,400px);gap:12px}figure{margin:0;background:#fff}img{width:400px;display:block}figcaption{padding:8px}</style><main>${cells.join('')}</main></html>`);
    await page.waitForFunction(()=>[...document.images].every(e=>e.complete&&e.naturalWidth));
    await page.screenshot({path:`${root}/sheet-${locale}.png`,fullPage:true});
  }
  await page.goto('http://127.0.0.1:3056/');
  await page.waitForSelector('figcaption');
  const colors=await page.evaluate(()=>{
    const rgb=s=>(s.match(/[\d.]+/g)||[]).slice(0,3).map(Number);
    const light=s=>rgb(s).map(n=>{const v=n/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((t,v,i)=>t+v*[.2126,.7152,.0722][i],0);
    return ['h1','figcaption','.preview-detail','button','select'].map(selector=>{
      const e=document.querySelector(selector);const s=getComputedStyle(e);let parent=e;let bg;
      while(parent){const b=getComputedStyle(parent).backgroundColor;if(b!=='rgba(0, 0, 0, 0)'&&b!=='transparent'){bg=b;break}parent=parent.parentElement}
      if(!bg)throw new Error('Unresolved background');
      const a=light(s.color),b=light(bg);return {selector,foreground:s.color,background:bg,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
    });
  });
  if(colors.some(c=>c.ratio<4.5))throw new Error('Text contrast below 4.5');
  await writeFile(`${root}/runtime-contrast.json`,JSON.stringify(colors,null,2));
  console.log(JSON.stringify(colors));
} finally {await browser.close()}
