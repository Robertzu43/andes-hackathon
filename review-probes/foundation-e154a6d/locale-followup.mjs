import {browser} from '../foundation-6f8dc52/cdp.mjs';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const origin=process.argv[2],out=new URL('..',import.meta.url).pathname;
const b=await browser(out),results=[];
try{
 for(const [width,height] of [[360,800],[1440,900]]){
  await b.viewport(width,height);
  for(const path of ['/trips/invalid','/contact/invitations/invalid']){
   await b.goto(origin+path);
   for(const locale of ['pt-BR','es']){
    await b.key(locale==='pt-BR'?'End':'Home','select');await b.wait(`document.documentElement.lang===${JSON.stringify(locale)}`);
    const v=await b.evaluate(`(()=>{const r=document.querySelector('.andes-header-top>a').getBoundingClientRect();return{title:document.title,h1:document.querySelector('h1').textContent,locale:document.documentElement.lang,brand:{width:r.width,height:r.height},overflow:document.documentElement.scrollWidth>innerWidth+1}})()`);
    assert.equal(v.title,v.h1+' | ANDES');assert.equal(v.locale,locale);assert.ok(v.brand.width>=44&&v.brand.height>=44);assert.equal(v.overflow,false);
    results.push({width,path,...v,pass:true});
    if(width===360&&locale==='pt-BR'&&path==='/trips/invalid')await b.capture('foundation-e154-360-pt-invalid');
   }
  }
 }
 assert.deepEqual(b.runtime,[]);
}finally{await writeFile(out+'foundation-locale-followup.json',JSON.stringify({candidate:'e154a6d7fc987c656395503a1ef794a0e3de64fd',results,runtime:b.runtime},null,2));await b.close();}
