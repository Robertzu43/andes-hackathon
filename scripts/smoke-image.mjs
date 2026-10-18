// Run from /app via Docker stdin; this harness is not shipped in the production image.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

const root='web/dist';
const index=readFileSync(`${root}/index.html`);
const assets=readdirSync(`${root}/assets`).filter(name=>/\.(js|css)$/.test(name));
for(const extension of ['.js','.css'])assert.ok(assets.some(name=>name.endsWith(extension)),`missing emitted ${extension}`);
const files=assets.map(name=>({path:`/assets/${name}`,body:readFileSync(`${root}/assets/${name}`)}));
const port=Number(process.env.PORT ?? 3107);
assert.ok(Number.isInteger(port)&&port>0&&port<=65535,'smoke requires an explicit valid port');
const origin=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['dist/server.js'],{
  // Deliberately ignore ambient provider/database configuration, including in native runs.
  env:{PATH:process.env.PATH,NODE_ENV:'production',DEMO_MODE:'true',ZAVU_LIVE_SEND:'false',
    HOST:'127.0.0.1',PORT:String(port),DATABASE_URL:'postgresql://synthetic_smoke@127.0.0.1:1/synthetic_smoke'},
  stdio:['ignore','inherit','inherit']
});
let exited;
const closed=new Promise(resolve=>{
  server.once('error',error=>{exited=error.message;resolve();});
  server.once('exit',(code,signal)=>{exited=`code=${code} signal=${signal}`;resolve();});
});
const timeout=AbortSignal.timeout(10000);
const get=path=>fetch(origin+path,{signal:timeout,redirect:'error'});
async function shell(response,path) {
  assert.equal(response.status,200,`${path} status`);
  assert.match(response.headers.get('content-type')??'',/^text\/html/,`${path} type`);
  assert.equal(response.headers.get('cache-control'),'no-store',`${path} cache`);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),index,`${path} shell`);
}
try {
  let response;
  while(!response) {
    assert.equal(exited,undefined,`server exited before readiness: ${exited}`);
    timeout.throwIfAborted();
    try { response=await get('/'); }
    catch(error) {
      if(timeout.aborted)throw error;
      await delay(100);
    }
  }
  await shell(response,'/');
  for(const {path,body} of files) {
    const asset=await get(path);
    assert.equal(asset.status,200,`asset ${path} status`);
    assert.match(asset.headers.get('content-type')??'',path.endsWith('.js')?/^text\/javascript/:/^text\/css/,`asset ${path} type`);
    assert.equal(asset.headers.get('cache-control'),'public, max-age=31536000, immutable',`asset ${path} cache`);
    assert.deepEqual(Buffer.from(await asset.arrayBuffer()),body,`asset ${path} contents`);
  }
  const deepLink='/trips/11111111-1111-4111-8111-111111111111';
  await shell(await get(deepLink),deepLink);
  for(const path of ['/v1/me','/v1/unknown']) {
    const api=await get(path);
    assert.equal(api.status,401,`${path} status`);
    assert.match(api.headers.get('content-type')??'',/^application\/json/,`${path} type`);
    assert.deepEqual(await api.json(),{code:'unauthorized'},`${path} auth`);
  }
  assert.equal(exited,undefined,`server exited during smoke: ${exited}`);
} catch(error) {
  if(timeout.aborted)throw new Error('Image smoke timed out',{cause:error});
  throw error;
} finally {
  server.kill('SIGTERM');
  const force=setTimeout(()=>server.kill('SIGKILL'),2000);
  await closed;
  clearTimeout(force);
}
console.log(`Image smoke passed: readable index, ${files.length} JS/CSS assets, deep link, API 401 JSON; server stopped`);
