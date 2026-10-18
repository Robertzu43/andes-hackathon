import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import test from 'node:test';
import {MemorySession,createApiClient,createDemoSessionGateway} from '../../src/lib/api/index.ts';

const BACKEND='4c138ca1d00742400a850cd72b0888cc59260a36';
const READS='3ea6e1b06e6dc3d3d01360f28ae9c61751657830';
const RESOURCES='c2501a40253b50b1406371f8fd7ebeaf309ec00c';
const repo=fileURLToPath(new URL('../../../',import.meta.url));

test('PR74 plus published PR65 reads work through real signed HTTP/PostgreSQL',async t=>{
  assert.ok(Number(process.versions.node.split('.')[0])>=24,'Use Node24–26');
  assert.ok(!process.env.APP_INTEGRATION_ADMIN_URL,'This test requires its own disposable cluster, not a shared admin URL');
  const dependencies=process.env.ANDES_BACKEND_NODE_MODULES;
  const compiler=process.env.ANDES_TYPESCRIPT_TSC;
  assert.ok(dependencies&&compiler,'Explicit existing backend dependencies/compiler required; no implicit install');
  const archive=mkdtempSync(join(tmpdir(),'andes-api-runtime-'));
  const blob=(sha,path)=>execFileSync('git',['show',`${sha}:${path}`],{cwd:repo});
  let resources,app,ctx;
  try{
    assert.ok(readFileSync(join(dirname(dependencies),'package-lock.json')).equals(blob(BACKEND,'package-lock.json')),
      'Existing backend dependency lock must match the frozen source');
    const files=execFileSync('git',['ls-tree','-r','--name-only',BACKEND,'src','db','package.json','package-lock.json','tsconfig.json'],
      {cwd:repo,encoding:'utf8'}).trim().split('\n');
    for(const path of files){assert.ok(!path.split('/').includes('..'));const target=join(archive,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,blob(BACKEND,path));}
    // Explicit test-only mount of the separately published read contract, not a backend merge.
    const readSource=join(archive,'src/client-read/routes.ts');mkdirSync(dirname(readSource),{recursive:true});
    writeFileSync(readSource,blob(READS,'src/client-read/routes.ts'));
    symlinkSync(dependencies,join(archive,'node_modules'),'dir');
    const helper=join(archive,'scripts/app-integration/runtime.mjs');mkdirSync(dirname(helper),{recursive:true});
    writeFileSync(helper,blob(RESOURCES,'scripts/app-integration/runtime.mjs'));
    execFileSync(process.execPath,[compiler,'-p',join(archive,'tsconfig.json')],{cwd:archive,stdio:'pipe'});
    const {disposableDatabase}=await import(pathToFileURL(helper));
    resources=await disposableDatabase();
    const {createContext,migrate}=await import(pathToFileURL(join(archive,'dist/db.js')));
    const {demoIssuer}=await import(pathToFileURL(join(archive,'dist/demo.js')));
    const {createApp}=await import(pathToFileURL(join(archive,'dist/api/app.js')));
    const {clientReadRoutes}=await import(pathToFileURL(join(archive,'dist/client-read/routes.js')));
    const serverReadStart=new Date();
    ctx=createContext(resources.url,()=>serverReadStart);await migrate(ctx.pool);
    const issuer=await demoIssuer({ZAVU_LIVE_SEND:'false'});
    app=createApp({ctx,auth:issuer.auth,demo:issuer});
    clientReadRoutes(app,ctx);
    const origin=await app.listen({port:0,host:'127.0.0.1'});

    for(const persona of ['driver','family','colleague']){
      await t.test(`real demo ${persona} gateway verifies its token at me`,async()=>{
        const session=new MemorySession();const events=[];
        const api=createApiClient({baseUrl:origin,session,fetch:async(input,init)=>{
          const response=await fetch(input,init);events.push({path:input.pathname,status:response.status});
          if(input.pathname==='/v1/demo/session')assert.equal(init.headers.Authorization,undefined);
          return response;
        }});
        const gateway=createDemoSessionGateway({session,api,persona});
        try{
          await gateway.begin();assert.equal(gateway.getSnapshot().state,'authenticated');
          assert.equal(gateway.getSnapshot().mode,'demo');
          assert.equal(session.snapshot().subject.endsWith(':'+persona),true);
          assert.deepEqual(events,[{path:'/v1/demo/session',status:200},{path:'/v1/me',status:200}]);
          gateway.end();assert.equal(session.snapshot().status,'anonymous');
        }finally{gateway.dispose();}
      });
    }

    await t.test('real world preserves arrival, unknown sharing and consent-scoped status after SOS/arrival',async()=>{
      const session=new MemorySession();const sharing=[];let loseSharing=true;
      const api=createApiClient({baseUrl:origin,session,fetch:async(input,init)=>{
        const response=await fetch(input,init);
        if(input.pathname.endsWith('/sharing')){
          sharing.push({key:init.headers['Idempotency-Key'],body:init.body,status:response.status});
          if(loseSharing){loseSharing=false;await response.text();throw Error('Synthetic loss after real committed response');}
        }
        return response;
      }});
      const world=await api.createDemoSession({demo:true});
      const install=(persona)=>{
        // Test-only metadata decode, not authentication; subsequent real API verifies JWT.
        const claims=JSON.parse(Buffer.from(world[persona].token.split('.')[1],'base64url').toString('utf8'));
        session.setCredentials({issuer:claims.iss,subject:claims.sub,accessToken:world[persona].token,expiresAt:claims.exp*1000});
      };
      install('driver');assert.equal((await api.getIdentity()).id,world.driver.id);
      const arrival=new Date(serverReadStart.getTime()+3_600_000).toISOString();
      const fields={truckId:world.driver.truckId,origin:'Synthetic origin',destination:'Synthetic destination',
        country:'BR',locale:'pt-BR',timeZone:'America/Sao_Paulo',expectedArrivalAt:arrival};
      const draft=await api.createDraft({text:'Synthetic persisted draft',fields},{idempotencyKey:'real-draft'});
      assert.equal(draft.fields.expectedArrivalAt,arrival);
      await api.confirmTrip(draft.id,{confirmed:true,contactGrantIds:[world.family.grantId,world.colleague.grantId]},
        {idempotencyKey:'real-confirm'});
      assert.equal((await api.getTripStatus(draft.id)).trip.expectedArrivalAt,arrival);
      for(const method of ['getProfile','listTrucks','listContacts','listTrips','getBootstrap']){
        assert.equal((await api[method]()).readAt,serverReadStart.toISOString());
      }
      const input={state:'stopped',reason:'permission_denied'},options={idempotencyKey:'real-sharing-intent'};
      await assert.rejects(api.setSharing(draft.id,input,options),e=>e.kind==='network'&&e.outcome==='unknown');
      assert.equal(sharing.length,1);
      assert.equal((await api.setSharing(draft.id,input,options)).sharing,'stopped');
      assert.deepEqual(sharing[0],sharing[1]);
      const count=await ctx.pool.query("SELECT count(*)::int AS count FROM trip_events WHERE trip_id=$1 AND kind='sharing_stopped:permission_denied'",[draft.id]);
      assert.equal(count.rows[0].count,1);
      await assert.rejects(api.setSharing(draft.id,{state:'resumed',reason:'user'},options),e=>e.status===409&&e.outcome==='rejected');
      const capturedAt=new Date(serverReadStart.getTime()-300_000).toISOString();
      await api.uploadLocations(draft.id,[{capturedAt,latitude:-12.1,longitude:-77.1,accuracy:75}],{idempotencyKey:'real-location'});
      const sos=await api.reportSos(draft.id,{idempotencyKey:'real-sos'});
      const before=await api.getTripStatus(draft.id);
      assert.equal(before.incident.id,sos.id);assert.equal(before.location.freshness,'stale');
      assert.equal(before.location.capturedAt,capturedAt);assert.ok(before.location.ageMs>=300_000);
      assert.equal('readAt' in before,false);assert.equal(before.deliveries.some(d=>d.channel==='group'&&d.status==='unavailable'),true);
      install('family');assert.equal((await api.getTripStatus(draft.id)).incident.id,sos.id);
      install('driver');await api.commandTrip(draft.id,'arrived',{idempotencyKey:'real-arrival'});
      const after=await api.getTripStatus(draft.id);
      assert.equal(after.trip.status,'arrived');assert.equal(after.incident.status,'active');assert.equal('location' in after,false);
      await api.revokeTripContact(draft.id,world.family.grantId,{idempotencyKey:'real-revoke'});
      install('family');await assert.rejects(api.getTripStatus(draft.id),e=>e.status===403&&e.kind==='forbidden');
      session.clear();
    });
  }finally{
    try{if(app)await app.close();else await ctx?.close();}finally{try{await resources?.cleanup();}finally{rmSync(archive,{recursive:true,force:true});}}
  }
});
