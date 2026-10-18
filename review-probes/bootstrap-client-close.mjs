import assert from 'node:assert/strict';
import {isAbsolute,join} from 'node:path';
import {pathToFileURL} from 'node:url';
assert.equal(process.env.ANDES_BOOTSTRAP_CLOSE_PROBE,'1','Explicit synthetic close probe required');
assert.ok(isAbsolute(process.env.ANDES_CANDIDATE_DIR ?? ''),'Absolute disposable candidate directory required');
const {default:pg}=await import(pathToFileURL(join(process.env.ANDES_CANDIDATE_DIR,'node_modules/pg/lib/index.js')));
import {appendFileSync} from 'node:fs';
const logfile=process.env.ANDES_CLOSE_TRACE;
function log(value){appendFileSync(logfile,JSON.stringify({time:process.hrtime.bigint().toString(),...value})+'\n');}
const poolEnd=pg.Pool.prototype.end, query=pg.Pool.prototype.query, emit=pg.Pool.prototype.emit;
pg.Pool.prototype.end=function(...args){
 const clients=[...this._clients];
 const details=()=>clients.map(c=>({pid:c.processID,user:c.user,database:c.database,socketDestroyed:c.connection.stream.destroyed,ended:c._ended}));
 log({event:'pool-end-start',clients:details()});
 const result=poolEnd.apply(this,args);
 if(result?.then)result.then(()=>log({event:'pool-end-resolved',clients:details()}));
 return result;
};
pg.Pool.prototype.query=function(...args){
 const sql=typeof args[0]==='string'?args[0]:args[0]?.text??'';
 if(/^DROP DATABASE/.test(sql))log({event:'drop-database-start',poolUser:this.options.user??'admin',database:sql.match(/bootstrap_[a-f0-9]+/)?.[0]});
 return query.apply(this,args);
};
pg.Pool.prototype.emit=function(event,...args){
 if(event==='connect'){
  const client=args[0];
  client.once('end',()=>log({event:'client-ended',pid:client.processID,user:client.user,database:client.database}));
  if(process.env.ANDES_CLOSE_DELAY==='1'&&client.database.startsWith('bootstrap_')){
   const connectionEnd=client.connection.end.bind(client.connection);
   let delayed=false;
   client.connection.end=()=>{if(delayed)return;delayed=true;log({event:'delay-client-close',pid:client.processID});setTimeout(connectionEnd,100);};
  }
 }
 if(event==='error')log({event:'pool-error',code:args[0]?.code,message:args[0]?.message,pid:args[1]?.processID});
 return emit.call(this,event,...args);
};
process.on('uncaughtExceptionMonitor',error=>log({event:'uncaught',code:error.code,message:error.message}));
