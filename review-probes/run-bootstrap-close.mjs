// Standalone synthetic diagnostic; never imports application .env or a shared DB.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {existsSync} from 'node:fs';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const [candidate,fixtureRoot,output,mode='delay']=process.argv.slice(2);
assert.ok([candidate,fixtureRoot,output].every(value=>value&&isAbsolute(value)),'Use absolute candidate, fixture and new output directories');
assert.ok(['plain','trace','delay','suite'].includes(mode));
assert.ok(!existsSync(output),'Output directory must be new');
assert.equal(process.env.APP_INTEGRATION_ADMIN_URL,undefined,'This probe always creates its own cluster');
assert.ok(process.env.APP_INTEGRATION_PG_BIN&&process.env.APP_INTEGRATION_PG_PORT,'Select an explicit PostgreSQL binary directory and unused private port');
const {disposableDatabase,testEnvironment}=await import(pathToFileURL(join(fixtureRoot,'scripts/app-integration/runtime.mjs')));
await mkdir(output,{recursive:true});
const runtime=await disposableDatabase();
const {default:pg}=await import(pathToFileURL(join(candidate,'node_modules/pg/lib/index.js')));
const admin=new pg.Client({connectionString:runtime.url});
try {
 await admin.connect();
 const data=(await admin.query('SHOW data_directory')).rows[0].data_directory;
 const postmaster=(await readFile(join(data,'postmaster.pid'),'utf8')).trim().split('\n');
 await writeFile(join(output,'owned.json'),JSON.stringify({node:process.version,postgresVersion:runtime.postgresVersion,clusterDirectory:runtime.directory,dataDirectory:data,pid:Number(postmaster[0]),port:Number(postmaster[3])},null,2)+'\n');
 const tests=mode==='suite'?(await readdir(join(candidate,'tests'))).filter(name=>name.endsWith('.test.mjs')).map(name=>'tests/'+name):['tests/database-config.test.mjs'];
 const preload=fileURLToPath(new URL('./bootstrap-client-close.mjs',import.meta.url));
 const args=[...(mode==='plain'||mode==='suite'?[]:['--import',preload]),'--test','--test-reporter=tap',...tests];
 const child=spawn(process.execPath,args,{cwd:candidate,env:testEnvironment({TEST_DATABASE_URL:runtime.url,ANDES_BOOTSTRAP_CLOSE_PROBE:'1',ANDES_CANDIDATE_DIR:candidate,ANDES_CLOSE_TRACE:join(output,'trace.jsonl'),ANDES_CLOSE_DELAY:mode==='delay'?'1':'0'}),stdio:['ignore','pipe','pipe']});
 let raw='';for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{raw+=chunk;process.stdout.write(chunk);});
 const timer=setTimeout(()=>child.kill('SIGKILL'),60000);
 const [code,signal]=await once(child,'close');clearTimeout(timer);
 await writeFile(join(output,'output.tap'),raw);await writeFile(join(output,'result.json'),JSON.stringify({mode,code,signal})+'\n');
 const leftover=(await admin.query("SELECT datname FROM pg_database WHERE datname LIKE 'bootstrap_%'")).rows;
 assert.equal(leftover.length,0,'Bootstrap test left a database in this private cluster');
 process.exitCode=code??1;
}finally{await admin.end();await runtime.cleanup();}
