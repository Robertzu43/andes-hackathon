import assert from 'node:assert/strict';
import {createServer,createConnection} from 'node:net';
import {existsSync} from 'node:fs';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
const [fixtureRoot,output]=process.argv.slice(2);
assert.ok(isAbsolute(fixtureRoot??'')&&isAbsolute(output??''),'Absolute fixture directory and new output file required');
assert.ok(!existsSync(output),'Output file must be new');
assert.equal(process.env.APP_INTEGRATION_ADMIN_URL,undefined,'Owned cluster only');
const {startBrowserFixture}=await import(pathToFileURL(join(fixtureRoot,'scripts/app-integration/browser-fixture.mjs')));
const sentinel=createServer(socket=>socket.end('unrelated-owned-control'));
const sentinelDirectory=await mkdtemp(join(tmpdir(),'andes-q60-unrelated-control-'));
let fixture,receipt;
const timer=setTimeout(()=>{console.error('bounded cleanup review exceeded deadline');process.exit(1);},45000);
async function accepting(port){return new Promise((resolve,reject)=>{const socket=createConnection({host:'127.0.0.1',port});socket.setTimeout(1000);socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',error=>error.code==='ECONNREFUSED'?resolve(false):reject(error));socket.once('timeout',()=>{socket.destroy();reject(Error('socket probe timed out'));});});}
try {
 await new Promise(resolve=>sentinel.listen(0,'127.0.0.1',resolve));
 const sentinelPort=sentinel.address().port;
 fixture=await startBrowserFixture(process.env.APP_INTEGRATION_WEB_ROOT);
 assert.equal((await fetch(fixture.origin+'/v1/me')).status,401);
 const dataDirectory=(await fixture.pool.query('SHOW data_directory')).rows[0].data_directory;
 const database=(await fixture.pool.query('SELECT current_database() AS name')).rows[0].name;
 const postmaster=(await readFile(join(dataDirectory,'postmaster.pid'),'utf8')).trim().split('\n');
 const postgresPid=Number(postmaster[0]),postgresPort=Number(postmaster[3]);
 const processChain=spawnSync('ps',['-o','pid=,ppid=,pgid=,command=','-p',String(postgresPid)],{encoding:'utf8'}).stdout.trim();
 const clusterDirectory=dataDirectory.slice(0,dataDirectory.lastIndexOf('/'));
 const directory=fixture.directory,webPort=Number(new URL(fixture.origin).port);
 receipt={source:'06885f4736d730f567309c22e7163c9b92f2a195',runtime:process.version,postgresPid,postgresPort,dataDirectory,clusterDirectory,directory,database,webPort,processChain};
 assert.equal(await accepting(postgresPort),true);
 await fixture.close();await fixture.close();
 let postgresGone=false;try{process.kill(postgresPid,0);}catch(error){assert.equal(error.code,'ESRCH');postgresGone=true;}
 receipt.after={postgresGone,postgresPortClosed:!(await accepting(postgresPort)),webPortClosed:!(await accepting(webPort)),dataRemoved:!existsSync(dataDirectory),clusterRemoved:!existsSync(clusterDirectory),extractionRemoved:!existsSync(directory),sentinelStillAccepts:await accepting(sentinelPort),sentinelDirectoryPreserved:existsSync(sentinelDirectory)};
 assert.ok(Object.values(receipt.after).every(Boolean));
 await writeFile(output,JSON.stringify(receipt,null,2)+'\n');
 console.log(JSON.stringify(receipt));
}finally{
 clearTimeout(timer);await fixture?.close();await new Promise(resolve=>sentinel.close(resolve));await rm(sentinelDirectory,{recursive:true,force:true});
}
