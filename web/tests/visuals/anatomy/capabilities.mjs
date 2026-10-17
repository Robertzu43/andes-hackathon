// Exercise real DOM listeners and injected capability failures in isolated Chrome.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { homedir } from 'node:os';
const here = fileURLToPath(new URL('.', import.meta.url));
const driver = process.env.ANATOMY_DRIVER ?? join(homedir(), '.agents/skills/anatomy/scripts/drive.mjs');
const baselinePath = join(here, 'baseline-index.fixture.mjs');
const baseline = spawnSync('git', ['show', '186fd4eb4688961de183af9283154b14da933ce9:web/src/visuals/anatomy/index.mjs'], { encoding: 'utf8' });
if (baseline.status !== 0) throw new Error('Missing reviewed failing revision');
writeFileSync(baselinePath, baseline.stdout.replaceAll(/from '\.\/(art|model|render)\.mjs'/g, "from '/web/src/visuals/anatomy/$1.mjs'"));
const rows = [];

function exercise(kind, locale, control = false) {
  const label = `capability-${control ? 'known-bad' : kind}-${locale}`;
  const code = `(async()=>{
    const stats={documentCallbacks:0,frames:0,requestedFrames:0,cancelledFrames:0,created:0,disconnected:0};
    const ownListeners=[],outerListeners=new Set();
    const NativeObserver=window.IntersectionObserver,nativeMedia=window.matchMedia;
    const nativeAdd=EventTarget.prototype.addEventListener,nativeRemove=EventTarget.prototype.removeEventListener;
    const outer=new AbortController();
    EventTarget.prototype.addEventListener=function(type,listener,options){
      if(this===outer.signal && type==='abort')outerListeners.add(listener);
      if(options?.signal && ['click','keydown','visibilitychange','change'].includes(type)){
        ownListeners.push({type,signal:options.signal});
        const callback=event=>{if(this===document && type==='visibilitychange')stats.documentCallbacks++;listener.call(this,event)};
        return nativeAdd.call(this,type,callback,options);
      }
      return nativeAdd.call(this,type,listener,options);
    };
    EventTarget.prototype.removeEventListener=function(type,listener,options){
      if(this===outer.signal && type==='abort')outerListeners.delete(listener);
      return nativeRemove.call(this,type,listener,options);
    };
    const raf=window.requestAnimationFrame.bind(window),cancel=window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame=callback=>{stats.requestedFrames++;return raf(now=>{stats.frames++;callback(now)})};
    window.cancelAnimationFrame=id=>{stats.cancelledFrames++;cancel(id)};
    const kind=${JSON.stringify(kind)},locale=${JSON.stringify(locale)};
    if(kind==='missing-io')window.IntersectionObserver=undefined;
    if(kind==='missing-media')window.matchMedia=undefined;
    if(kind==='media-throws')window.matchMedia=()=>{throw new Error('injected matchMedia failure')};
    if(kind==='listener-throws')window.matchMedia=query=>{const media=nativeMedia.call(window,query);media.addEventListener=()=>{throw new Error('injected media listener failure')};return media};
    if(kind==='constructor-throws')window.IntersectionObserver=class{constructor(){throw new Error('injected observer constructor failure')}};
    if(kind==='observe-throws' || kind==='abort-in-observe')window.IntersectionObserver=class extends NativeObserver{
      constructor(callback){super(callback);this.callback=callback;stats.created++}
      observe(node){super.observe(node);if(kind==='abort-in-observe')outer.abort();else{this.callback([{isIntersecting:true}]);node.closest('.andes-relay').querySelector('[data-example=acknowledged]').click();throw new Error('injected observe failure')}}
      disconnect(){stats.disconnected++;super.disconnect()}
    };
    const {mountVisual}=await import(${JSON.stringify(control ? '/web/tests/visuals/anatomy/baseline-index.fixture.mjs' : '/web/src/visuals/anatomy/index.mjs')});
    let handle,thrown=null;
    try{handle=mountVisual(document.querySelector('#relay-host'),{locale:${JSON.stringify(locale)},motion:'interactive',signal:outer.signal})}catch(error){thrown=error.message}
    const root=document.querySelector('.andes-relay');
    const before=root.dataset.relayExample;
    const initialStatic=!root.querySelector('[data-relay-static]').hidden && root.querySelector('[data-relay-controls]').hidden;
    const activeAfterSetup=ownListeners.filter(listener=>!listener.signal.aborted).length;
    const outerAfterSetup=outerListeners.size;
    outer.abort();handle?.setMotion('interactive');handle?.destroy();handle?.destroy();
    document.dispatchEvent(new Event('visibilitychange'));
    root.querySelector('[data-example='+ (before==='acknowledged'?'local':'acknowledged') +']').click();
    await new Promise(done=>setTimeout(done,80));
    const flag=root.querySelector('[data-relay-motion=flag]').getAttribute('transform');
    const poseMatchesSelection=before==='acknowledged'?(flag!==null && flag!=='translate(0 0)'):(!flag || flag==='translate(0 0)');
    const result={kind,locale,thrown,handle:Boolean(handle),initialStatic,staticExamples:root.querySelectorAll('[data-relay-static] li').length,activeAfterSetup,activeAfterAbort:ownListeners.filter(listener=>!listener.signal.aborted).length,outerAfterSetup,outerAfterAbort:outerListeners.size,changedByOldButton:root.dataset.relayExample!==before,poseMatchesSelection,...stats};
    if(${control}){
      if(!result.thrown || result.activeAfterAbort===0 || !result.changedByOldButton || result.documentCallbacks===0)throw new Error('Known failing control did not reproduce');
      return result;
    }
    if(result.thrown || !result.handle || !result.poseMatchesSelection || result.staticExamples!==4 || result.activeAfterAbort!==0 || result.outerAfterAbort!==0 || result.changedByOldButton || result.documentCallbacks!==0 || result.frames!==0)throw new Error(JSON.stringify(result));
    if(kind!=='healthy' && (!result.initialStatic || result.activeAfterSetup!==0 || result.outerAfterSetup!==0))throw new Error('Setup left active resources: '+JSON.stringify(result));
    if(kind==='observe-throws' && (result.disconnected!==1 || result.requestedFrames<1 || result.cancelledFrames!==result.requestedFrames))throw new Error('Observer or pending frame not released');
    return result;
  })()`;
  const actions = [['eval', code]];
  if (!control && ['missing-io','observe-throws'].includes(kind)) actions.push(['shot', join(here,'evidence',`${label}.png`),'.andes-relay',1]);
  const path = join(here,'evidence',`${label}-actions.json`);
  writeFileSync(path, JSON.stringify(actions,null,2));
  const result = spawnSync(process.execPath, [driver, 'http://127.0.0.1:3054/web/tests/visuals/anatomy/preview-static-es.html', '--actions',path,'--width','390','--height','844'], {encoding:'utf8',timeout:20000});
  const output=(result.stdout??'')+(result.stderr??'');
  writeFileSync(join(here,'evidence',`${label}.log`),output);
  if(result.status!==0 || !output.includes('console: clean'))throw new Error(output);
  const row=JSON.parse(output.split('\n').find(line=>line.startsWith('eval: ')).slice(6));
  rows.push(row);console.log(JSON.stringify(row));
}
try {
  exercise('missing-io','es',true);
  for(const locale of ['es','pt-BR'])for(const kind of ['missing-io','missing-media','media-throws','listener-throws','constructor-throws','observe-throws','abort-in-observe','healthy'])exercise(kind,locale);
  writeFileSync(join(here,'evidence','capabilities.json'),JSON.stringify({failingControl:'186fd4eb4688961de183af9283154b14da933ce9',cases:rows},null,2)+'\n');
  console.log('Capability regressions passed: known failure reproduced; 16 fixed cases passed');
} finally { rmSync(baselinePath,{force:true}); }
