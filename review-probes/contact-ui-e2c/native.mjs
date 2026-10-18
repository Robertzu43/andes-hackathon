import {browser} from './cdp.mjs';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const out=new URL('.',import.meta.url).pathname;
const p=await browser(out);const results=[];
const base=process.argv[2]??'http://127.0.0.1:56370';if(!['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname))throw Error('Loopback fixture only');
async function open(screen,locale='es',scenario='normal',extra=''){
 await p.goto(`${base}/tests/contacts/fixture.html?screen=${screen}&locale=${locale}&scenario=${scenario}${extra}`);
 if(screen==='trip')await p.wait(`!!document.querySelector('[data-action="acknowledge"]') && ${extra?'true':`document.body.innerText.includes('-23.55000')`}`);
 else await p.wait(`!!document.querySelector('[data-action="invite-open"]')`);
}
const posts=()=>p.evaluate(`window.__CONTACT_FIXTURE__.calls.filter(c=>c.method==='POST')`);
async function fill(selector,text){await p.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.focus();e.select()})()`);await p.send('Input.insertText',{text});}
async function textButton(text){const selector=await p.evaluate(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!e)throw Error('Missing button');e.dataset.q52='native';return '[data-q52="native"]';})()`);await p.click(selector);await p.evaluate(`document.querySelector('[data-q52]')?.removeAttribute('data-q52')`);}
async function check(name,fn){try{await fn();results.push({name,pass:true});console.log('PASS '+name);}catch(e){results.push({name,pass:false,error:String(e)});await p.capture('FAIL-'+name.replaceAll(/[^a-z0-9]/gi,'-'));await writeFile(out+'failure-dom-'+results.length+'.json',JSON.stringify(await p.evaluate(`({body:document.body.innerText,gateway:window.__CONTACT_GATEWAY__?.getSnapshot(),calls:window.__CONTACT_FIXTURE__?.calls})`),null,2));}}
try{
 await p.viewport(360,800);
 for(const locale of ['es','pt-BR'])await check(locale+' native invitation input, validation, explicit scope and one POST',async()=>{
  await open('contacts',locale);await p.key('Enter','[data-action="invite-open"]');await p.wait(`!!document.querySelector('#invite-contact-id')`);
  assert.equal(await p.evaluate('document.activeElement.id'),'invite-contact-id');
  await p.key('Enter','form button[type="submit"]');assert.equal((await posts()).length,0);
  await fill('#invite-contact-id','00000000-0000-4000-8000-000000000006');await fill('input[type="tel"]','+5511000000001');
  await p.key(' ','input[type="checkbox"]');await p.key('Enter','form button[type="submit"]');
  await p.wait(`!!document.querySelector('[data-contact-state="recorded"]')`);const calls=await posts();assert.equal(calls.length,1);
  assert.deepEqual(JSON.parse(calls[0].body),{contactId:'00000000-0000-4000-8000-000000000006',phone:'+5511000000001',map:true,incident:false});
  await p.capture(locale+'-native-invite-receipt');
 });
 await check('native Unicode action boundary and acknowledgement remain separate',async()=>{
  await open('trip');await p.wait(`document.querySelector('[data-action="report"]').disabled===false`);
  await fill('.andes-contact-report input','x'.repeat(301));await p.key('Enter','[data-action="report"]');assert.equal((await posts()).length,0);
  await fill('.andes-contact-report input','😀'.repeat(300));await p.key('Enter','[data-action="report"]');
  await p.wait(`document.querySelectorAll('.andes-contact-receipts .andes-update').length===1`);assert.equal((await posts()).length,1);
  await p.key('Enter','[data-action="acknowledge"]');await p.wait(`document.querySelectorAll('.andes-contact-receipts .andes-update').length===2`);
  const calls=await posts();assert.equal(calls.length,2);assert.ok(calls[0].path.endsWith('/actions'));assert.ok(calls[1].path.endsWith('/acknowledgements'));
  assert.notEqual(calls[0].key,calls[1].key);assert.equal(calls.some(c=>c.path.endsWith('/resolve')),false);
 });
 await check('native 401 refresh clears protected facts, receipts and same-actor draft',async()=>{
  await open('trip');await p.wait(`document.querySelector('[data-action="report"]').disabled===false`);await fill('.andes-contact-report input','SYNTHETIC private draft');
  await p.evaluate(`window.__CONTACT_FIXTURE__.mode='unauthorized'`);await p.click('[aria-labelledby="location-title"] button');
  await p.wait(`!!document.querySelector('main a[href="/session"]')`);assert.equal(await p.evaluate(`document.body.innerText.includes('-23.55000')||document.body.innerText.includes('SYNTHETIC private draft')`),false);
  await p.evaluate(`(async()=>{window.__CONTACT_FIXTURE__.mode='normal';await window.__CONTACT_GATEWAY__.begin()})()`);
  await p.wait(`document.querySelector('.andes-contact-report input')?.disabled===false`);assert.equal(await p.evaluate(`document.querySelector('.andes-contact-report input').value`),'');
 });
 await check('native unknown revoke retry preserves key and cannot restore location or response',async()=>{
  await open('trip','es','unknown-revoke');await textButton('Dejar de compartir este viaje');await textButton('Sí, revocar permiso');
  await p.wait(`!!document.querySelector('[data-contact-state="uncertain"]')`);await p.key('Enter','[data-action="retry-same"]');
  await p.wait(`window.__CONTACT_FIXTURE__.calls.filter(c=>c.path.endsWith('/revoke')).length===2`);
  await p.wait(`document.querySelector('[data-action="retry-same"]')?.disabled===false`);
  const calls=(await posts()).filter(c=>c.path.endsWith('/revoke'));assert.equal(calls[0].key,calls[1].key);
  assert.equal(await p.evaluate(`document.body.innerText.includes('-23.55000')`),false);assert.equal(await p.evaluate(`document.querySelector('[data-action="report"]').disabled`),true);
  assert.ok(await p.evaluate(`!!document.querySelector('[data-contact-state="uncertain"]')`));await p.capture('native-unknown-revoke-after409');
 });
 await check('missing incident reference blocks native response without invented discovery',async()=>{
  await open('trip','pt-BR','normal','&references=missing');await p.click('[data-action="acknowledge"]');assert.equal((await posts()).length,0);
  assert.equal(await p.evaluate(`window.__CONTACT_FIXTURE__.calls.some(c=>c.path.includes('/incidents/'))`),false);
 });
 await check('map denial leaves separately readable incident and response available',async()=>{
  await open('trip');await p.wait(`document.querySelector('[data-action="report"]').disabled===false`);
  await p.evaluate('window.__CONTACT_FIXTURE__.revoked=true');await p.click('[aria-labelledby="location-title"] button');
  await p.wait(`document.querySelector('[aria-labelledby="location-title"]').innerText.includes('No podemos mostrar esta ubicación')`);await p.click('[aria-labelledby="incident-title"] button');await p.wait(`document.querySelector('[data-action="acknowledge"]').disabled===false`);
  await p.key('Enter','[data-action="acknowledge"]');await p.wait(`!!document.querySelector('[data-contact-state="recorded"]')`);assert.equal((await posts()).length,1);
 });
 assert.deepEqual(p.runtime,[]);
}finally{await writeFile(out+'native-results.json',JSON.stringify({candidate:'e2c1e677cf3ec3fa9c7f91529b082ab5b8ff91e6',input:'native CDP key/mouse/text; synthetic HTTP/identity only',results,runtime:p.runtime},null,2));await p.close();}

if(results.some(r=>!r.pass))process.exitCode=1;
