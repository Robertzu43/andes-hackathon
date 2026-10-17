// Real Chrome CDP tests. No account, backend, database or external network.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import assert from 'node:assert/strict';

const profile = mkdtempSync(join(tmpdir(), 'andes-relay-browser-'));
const chrome = spawn(process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','about:blank']);
let socket;
const report = {};
const pause = ms => new Promise(done => setTimeout(done, ms));
try {
  const port = await new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error('Chrome startup timeout')), 15000);
    chrome.stderr.on('data', chunk => { const match=String(chunk).match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//); if(match){clearTimeout(timer);done(Number(match[1]));} });
    chrome.once('error', fail);
  });
  const page = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {method:'PUT'})).json();
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await once(socket, 'open');
  let id=0;
  const pending=new Map(), errors=[], requests=[];
  socket.addEventListener('message', event => {
    const data=JSON.parse(event.data);
    if(data.id){const task=pending.get(data.id);if(task){clearTimeout(task.timer);pending.delete(data.id);data.error?task.fail(new Error(data.error.message)):task.done(data.result);}}
    if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails.text);
    if(data.method==='Runtime.consoleAPICalled' && ['error','warning'].includes(data.params.type)) errors.push(data.params.type);
    if(data.method==='Network.requestWillBeSent') requests.push(data.params.request.url);
  });
  const send=(method,params={})=>new Promise((done,fail)=>{const n=++id;const timer=setTimeout(()=>{pending.delete(n);fail(new Error(method+' timeout'));},10000);pending.set(n,{done,fail,timer});socket.send(JSON.stringify({id:n,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
  await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
  await send('Accessibility.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.testFrames=0;window.testFrameTimes=[];const testRAF=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=f=>testRAF(t=>{window.testFrames++;const at=performance.now();f(t);window.testFrameTimes.push(performance.now()-at)});`});
  await send('Page.navigate',{url:'http://127.0.0.1:3054/web/tests/visuals/anatomy/preview-es.html'});
  await pause(600);
  assert.equal(await evaluate('document.querySelectorAll("button").length'),4);
  assert.equal(await evaluate('window.testFrames'),0,'no initial autoplay frames');
  const at=await evaluate(`(()=>{const b=document.querySelector('[data-example=acknowledged]');b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:at.x,y:at.y}]});
  await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await pause(450);
  assert.equal(await evaluate('document.querySelector(".andes-relay").dataset.relayExample'),'acknowledged');
  report.touch='CDP touchStart/touchEnd selected acknowledged';
  const count=await evaluate('window.testFrames');await pause(350);
  assert.equal(await evaluate('window.testFrames'),count,'settled loop stopped');
  report.idleFrames=0;report.initialAutoplayFrames=0;
  await evaluate('window.scrollTo(0,0)');await pause(100);
  const beforeMotion=await evaluate('window.testFrames');
  await evaluate('document.querySelector("[data-example=local]").click()');await pause(450);
  assert.ok(await evaluate('window.testFrames')>beforeMotion,'visible explicit selection eases through frames');
  report.frameCost=await evaluate('(()=>{const a=[...window.testFrameTimes].sort((a,b)=>a-b);return{samples:a.length,p95ms:a[Math.min(a.length-1,Math.floor(a.length*.95))],maxMs:a.at(-1)}})()');
  await evaluate('window.scrollTo(0,document.body.scrollHeight)');await pause(100);
  const beforeOffscreen=await evaluate('window.testFrames');
  await evaluate('document.querySelector("[data-example=local]").click()');await pause(150);
  assert.equal(await evaluate('window.testFrames'),beforeOffscreen,'offscreen selector creates no frames');
  report.offscreenFrames=0;

  await evaluate('window.scrollTo(0,0)');await pause(100);
  const other=await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
  await send('Target.activateTarget',{targetId:other.id});await pause(100);
  const hidden=await evaluate('document.hidden');
  if(hidden){
    const before=await evaluate('window.testFrames');
    await evaluate('document.querySelector("[data-example=acknowledged]").click()');await pause(150);
    assert.equal(await evaluate('window.testFrames'),before,'background tab creates no frames');
    report.hiddenTab='native document.hidden=true after Target.activateTarget; zero new frames';
  }else{report.hiddenTab='headless Chrome did not mark the background tab hidden; native visibility proof remains open';}
  await send('Target.activateTarget',{targetId:page.id});
  const tree=await send('Accessibility.getFullAXTree');
  const buttons=tree.nodes.filter(n=>n.role?.value==='button'&&!n.ignored);
  assert.equal(buttons.length,4);assert.ok(buttons.every(n=>n.name?.value?.length>5));
  report.accessibilityTree=buttons.map(n=>({role:n.role.value,name:n.name.value,pressed:n.properties.find(p=>p.name==='pressed')?.value.value}));

  await evaluate(`(async()=>{window.relay.destroy();const {mountVisual}=await import('/web/src/visuals/anatomy/index.mjs');window.relayAbort=new AbortController();window.relay=mountVisual(document.querySelector('#relay-host'),{locale:'es',motion:'interactive',signal:window.relayAbort.signal});window.relayAbort.abort();})()`);
  assert.equal(await evaluate('document.querySelector("[data-relay-controls]").hidden'),true);
  assert.equal(await evaluate('document.querySelector("[data-relay-static]").hidden'),false);
  const beforeDestroy=await evaluate('window.testFrames');
  await evaluate('window.relay.setMotion("interactive");document.querySelector("[data-example=acknowledged]").click()');await pause(150);
  assert.equal(await evaluate('window.testFrames'),beforeDestroy);
  report.abort='restored all static explanations, listeners detached, no frames after abort';

  await send('Emulation.setScriptExecutionDisabled',{value:true});
  await send('Page.navigate',{url:'http://127.0.0.1:3054/web/tests/visuals/anatomy/preview-es.html'});await pause(400);
  // DOM inspection is through CDP with JS execution re-enabled after the page
  // loaded with scripts disabled; no app script is re-executed.
  const staticShot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
  writeFileSync(new URL('evidence/no-javascript-390.png',import.meta.url),Buffer.from(staticShot.data,'base64'));
  await send('Emulation.setScriptExecutionDisabled',{value:false});
  assert.equal(await evaluate('document.querySelector("[data-relay-controls]").hidden'),true);
  assert.equal(await evaluate('document.querySelector("[data-relay-static]").hidden'),false);
  assert.equal(await evaluate('document.querySelectorAll("[data-relay-static] li").length'),4);
  report.noJavaScript='actual Chrome script execution disabled at navigation; all four explanations present';
  report.externalRequests=requests.filter(url=>!url.startsWith('http://127.0.0.1:3054/')&&!url.startsWith('data:'));
  assert.deepEqual(report.externalRequests,[]);assert.deepEqual(errors,[]);report.console='clean';
  writeFileSync(new URL('evidence/lifecycle.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
} finally {
  socket?.close();
  const exited = chrome.exitCode !== null || chrome.signalCode !== null ? Promise.resolve() : once(chrome, 'exit');
  chrome.kill('SIGKILL');
  await exited;
  rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
