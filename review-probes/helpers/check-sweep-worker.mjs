import {resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';

// Ephemeral synthetic test worker; it has no queue transport or provider.
const root=pathToFileURL(resolve(process.env.Q48_REVIEW_CANDIDATE)+sep);
const {createContext}=await import(new URL('dist/db.js',root));
const {checkOnce}=await import(new URL('dist/checks/sweep.js',root));
const ctx=createContext(process.env.Q48_REVIEW_DATABASE,()=>new Date(process.env.Q48_REVIEW_CLOCK));
const support=['sms','whatsapp','voice'].map(channel=>({channel,country:'BR',locale:'pt-BR'}));
const config={silenceMs:120000,askGraceMs:60000,arrivalGraceMs:120000,sweepMs:5000};
process.on('message',async message=>{
  try {
    if(message==='sweep') { await checkOnce(ctx,support,config); process.send({phase:'committed'}); }
    else if(message==='close') { await ctx.close(); process.disconnect(); }
  } catch { process.send({phase:'failed'}); process.exitCode=1; }
});
process.send({phase:'ready'});
