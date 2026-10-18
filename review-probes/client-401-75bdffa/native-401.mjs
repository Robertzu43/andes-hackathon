import {browser} from './contact-cdp.mjs';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const origin=process.argv[2];assert.match(origin??'',/^http:\/\/127\.0\.0\.1:\d+$/);
const out=new URL('.',import.meta.url).pathname,results=[],b=await browser(out);
async function fill(text){await b.evaluate(`(()=>{const e=document.querySelector('.andes-contact-report input');e.focus();e.select()})()`);await b.send('Input.insertText',{text});}
try{
 await b.viewport(390,844);
 for(const operation of ['read','write']){
  await b.goto(origin+'/tests/contacts/fixture.html?screen=trip');await b.wait(`document.querySelector('[data-action="report"]')?.disabled===false&&document.body.innerText.includes('-23.55000')`);
  await b.key('Enter','[data-action="acknowledge"]');await b.wait(`document.querySelectorAll('.andes-contact-receipts .andes-update').length===1`);
  await fill('SYNTHETIC private draft');
  await b.evaluate(`window.__CONTACT_FIXTURE__.mode='unauthorized'`);
  if(operation==='read')await b.click('[aria-labelledby="location-title"] button');else await b.key('Enter','[data-action="report"]');
  await b.wait(`!!document.querySelector('main a[href="/session"]')`);
  const closed=await b.evaluate(`({gateway:window.__CONTACT_GATEWAY__.getSnapshot().state,privateVisible:document.body.innerText.includes('-23.55000')||document.body.innerText.includes('SYNTHETIC private draft'),receipts:document.querySelectorAll('.andes-contact-receipts .andes-update').length,gate:!!document.querySelector('main a[href="/session"]')})`);
  assert.deepEqual(closed,{gateway:'signed-out',privateVisible:false,receipts:0,gate:true});
  await b.capture('client-75-'+operation+'-401-closed');
  // Native activation reaches the existing shared access page and its actual gateway action.
  await b.key('Enter','main a[href="/session"]');await b.wait(`location.pathname==='/session'&&!!document.querySelector('[data-action="session-primary"]')`);
  await b.evaluate(`window.__CONTACT_FIXTURE__.mode='normal'`);
  await b.key('Enter','[data-action="session-primary"]');await b.wait(`window.__CONTACT_GATEWAY__.getSnapshot().state==='authenticated'`);
  await b.evaluate('history.back()');await b.wait(`document.querySelector('[data-action="report"]')?.disabled===false&&document.body.innerText.includes('-23.55000')`);
  assert.equal(await b.evaluate(`document.querySelector('.andes-contact-report input').value`),'');
  assert.equal(await b.evaluate(`document.querySelectorAll('.andes-contact-receipts .andes-update').length`),0);
  results.push({operation,closed,explicitAccessAction:'native Enter on existing session-primary',recovered:true,draftCleared:true,receiptsCleared:true});
  await b.capture('client-75-'+operation+'-recovered');
 }
 assert.deepEqual(b.runtime,[]);
} catch(error){await b.capture('client-75-native-failure');await writeFile(out+'native-401-error.json',JSON.stringify({error:String(error),body:await b.evaluate('document.body.innerText')},null,2));throw error;}
finally{await writeFile(out+'native-401-results.json',JSON.stringify({api:'75bdffa42d858c82a8dcb0af11bc78803e3d9a09',feature:'1fd365ee7805cd83b2b1a1706973788dea6f805e',foundation:'3283fe675ebeee04bb2be8a62f42ab5c475b4b0e',results,runtime:b.runtime,scope:'Owned native browser inputs on immutable existing UI with synthetic fixture HTTP and identity; no provider/backend/deployment'},null,2));await b.close();}
