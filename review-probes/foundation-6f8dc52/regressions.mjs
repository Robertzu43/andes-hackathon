// Read-only independent foundation checks. Use an owned production-preview origin.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,isAbsolute} from 'node:path';
import {browser} from './cdp.mjs';
const [origin,source]=process.argv.slice(2);
assert.match(origin??'',/^http:\/\/127\.0\.0\.1:\d+$/);
assert.ok(source&&isAbsolute(source),'Supply the exact frozen source checkout path');
const head=execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim();
execFileSync('git',['diff','--quiet','HEAD','--','web'],{cwd:source});
const output=await mkdtemp(join(tmpdir(),'andes-q52-foundation-probes-')),b=await browser(output),results=[];
async function check(id,expected,run){let actual,passed=false;try{actual=await run();assert.deepEqual(actual,expected);passed=true;}catch(error){if(actual===undefined)actual={error:error.name};}results.push({id,expected,actual,passed});}
async function page(path){await b.goto(origin+path);await b.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');}
async function identity(){return b.evaluate('({title:document.title,heading:document.querySelector("h1").textContent})');}
async function api(path){const response=await fetch(origin+path);const text=await response.text();return{status:response.status,json:response.headers.get('content-type')?.includes('application/json')??false,unconfigured:text.includes('api_unconfigured')};}
try{
  await b.viewport(390,844);await page('/session');await b.evaluate("localStorage.setItem('andes.locale','es')");await page('/session');
  await check('unconfigured session is truthful and disabled',true,()=>b.evaluate("document.querySelector('[data-action=session-primary]').disabled && document.body.innerText.includes('aún no está disponible')"));
  await check('valid trip ID retains active-trip title',true,async()=>{await page('/trips/11111111-1111-4111-8111-111111111111');const v=await identity();return v.title===v.heading+' | ANDES'&&v.heading==='Viaje en curso';});
  await check('unknown path title matches not-found heading',true,async()=>{await page('/missing-foundation-probe');const v=await identity();return v.title===v.heading+' | ANDES'&&v.heading==='No encontramos esta página';});
  await check('invalid trip identifier title matches not-found heading',true,async()=>{await page('/trips/invalid');const v=await identity();return v.title===v.heading+' | ANDES';});
  await check('invalid invitation identifier title matches not-found heading',true,async()=>{await page('/contact/invitations/invalid');const v=await identity();return v.title===v.heading+' | ANDES';});
  await check('brand home hit target reaches approved44px minimum',true,()=>b.evaluate("(()=>{const r=document.querySelector('.andes-header-top>a').getBoundingClientRect();return r.width>=44&&r.height>=44;})()"));
  await check('navigation positive targets reach44px minimum',true,()=>b.evaluate("[...document.querySelectorAll('.andes-nav a')].every(e=>e.getBoundingClientRect().height>=44)"));
  await check('API root without target returns JSON503',{status:503,json:true,unconfigured:true},()=>api('/v1'));
  await check('API root query without target returns JSON503',{status:503,json:true,unconfigured:true},()=>api('/v1?foundationProbe=1'));
  await check('registered API-path query positive returns JSON503',{status:503,json:true,unconfigured:true},()=>api('/v1/me?foundationProbe=1'));
  await check('production mount hook is absent',true,()=>b.evaluate('typeof window.__ANDES_TEST_MOUNT__ === "undefined"'));
  await check('production fixture entry does not expose fixture controls',true,async()=>{await page('/tests/fixtures/session.html');return b.evaluate('!document.querySelector("#fixture-session-state")');});
  await check('generic noindex metadata retains privacy',true,()=>b.evaluate("document.querySelector('meta[name=robots]').content.includes('noindex')&&!document.title.includes('11111111')"));
  await b.capture('final-regression-surface');
}finally{await b.close();}
const result={head,origin,kind:'independent local browser/HTTP controls; no authenticated backend/device/provider claims',output,results,passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length};
await writeFile(join(output,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));process.exitCode=result.failed?1:0;
