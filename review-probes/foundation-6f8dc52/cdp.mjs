import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';

export async function browser(output) {
  const profile=await mkdtemp(join(tmpdir(),'andes-q52-chrome-'));
  const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',[
    '--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
    '--disable-background-networking','--disable-component-update','--remote-debugging-port=0',
    '--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','pipe']});
  let stderr='', socket;
  try {
    const endpoint=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Owned browser startup timeout')),15000);
      chrome.stderr.on('data',chunk=>{stderr+=chunk;const match=stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
      chrome.once('error',reject);chrome.once('exit',code=>reject(new Error('Owned browser exited '+code)));
    });
    socket=new WebSocket(endpoint);await once(socket,'open');
    let serial=0;const waiting=new Map();let session;
    const runtime=[],network=[],loaded=new Set();
    socket.addEventListener('message',event=>{
      const v=JSON.parse(event.data);
      if(v.id){const p=waiting.get(v.id);if(!p)return;clearTimeout(p.timer);waiting.delete(v.id);v.error?p.reject(new Error(v.error.message)):p.resolve(v.result);}
      else if(v.method==='Page.lifecycleEvent'&&v.params.name==='load')loaded.add(v.params.loaderId);
      else if(v.method==='Runtime.exceptionThrown')runtime.push(v.params.exceptionDetails.exception?.description??v.params.exceptionDetails.text);
      else if(v.method==='Network.responseReceived')network.push({url:v.params.response.url,status:v.params.response.status});
    });
    function send(method,params={},target=session){return new Promise((resolve,reject)=>{
      const id=++serial,timer=setTimeout(()=>{waiting.delete(id);reject(new Error('CDP timeout '+method));},15000);
      waiting.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,...(target?{sessionId:target}:{})}));
    });}
    const target=await send('Target.createTarget',{url:'about:blank'},null);
    session=(await send('Target.attachToTarget',{targetId:target.targetId,flatten:true},null)).sessionId;
    for(const method of ['Page.enable','Runtime.enable','Network.enable'])await send(method);
    await send('Page.setLifecycleEventsEnabled',{enabled:true});
    async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;}
    async function wait(expression){for(let i=0;i<60;i++){if(await evaluate(expression))return;await delay(25);}throw new Error('Condition not reached: '+expression);}
    async function goto(url){const nav=await send('Page.navigate',{url});if(nav.loaderId){for(let i=0;i<200&&!loaded.has(nav.loaderId);i++)await delay(25);if(!loaded.has(nav.loaderId))throw new Error('Page load did not complete');}await wait(`location.href === ${JSON.stringify(url)} && document.readyState === "complete" && !!document.querySelector("h1")`);await evaluate('document.fonts.ready.then(()=>true)');}
    async function viewport(width,height){await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600,screenWidth:width,screenHeight:height});await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});}
    async function click(selector){const rect=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('Missing control');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      await send('Input.dispatchMouseEvent',{type:'mousePressed',...rect,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...rect,button:'left',clickCount:1});}
    async function key(key,selector){if(selector)await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
      const codes={Enter:13,Tab:9,' ':32,ArrowDown:40,ArrowUp:38,Home:36,End:35,Escape:27};
      const text=key==='Enter'?'\r':key===' '?' ':undefined;
      await send('Input.dispatchKeyEvent',{type:text?'keyDown':'rawKeyDown',key,code:key===' '?'Space':key,windowsVirtualKeyCode:codes[key],nativeVirtualKeyCode:codes[key],...(text?{text,unmodifiedText:text}:{})});
      await send('Input.dispatchKeyEvent',{type:'keyUp',key,code:key===' '?'Space':key,windowsVirtualKeyCode:codes[key],nativeVirtualKeyCode:codes[key]});}
    async function select(selector,value){await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));return e.value;})()`);await delay(20);}
    async function capture(name){const size=await evaluate('({w:innerWidth,h:Math.max(document.documentElement.scrollHeight,innerHeight)})');const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:size.w,height:size.h,scale:1}});await mkdir(join(output,'captures'),{recursive:true});const path=join(output,'captures',name+'.png');const data=Buffer.from(shot.data,'base64');if(data.readUInt32BE(16)!==size.w)throw new Error('Capture width differs from actual viewport');await writeFile(path,data);return path;}
    async function close(){socket.close();chrome.kill('SIGTERM');await Promise.race([once(chrome,'exit'),delay(3000).then(()=>chrome.kill('SIGKILL'))]);await rm(profile,{recursive:true,force:true});}
    return {send,evaluate,wait,goto,viewport,click,key,select,capture,runtime,network,close};
  }catch(error){socket?.close();chrome.kill('SIGTERM');await rm(profile,{recursive:true,force:true});throw error;}
}
