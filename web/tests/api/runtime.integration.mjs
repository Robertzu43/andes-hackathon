import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import test from 'node:test';
import {MemorySession,createApiClient,createDemoSessionGateway,bindJourneySession} from '../../src/lib/api/index.ts';

const RESOURCES='c2501a40253b50b1406371f8fd7ebeaf309ec00c';
const repo=fileURLToPath(new URL('../../../',import.meta.url));

test('current backend and phone-free catalogs work through real signed HTTP/PostgreSQL',async t=>{
  assert.ok(Number(process.versions.node.split('.')[0])>=24,'Use Node24–26');
  assert.ok(!process.env.APP_INTEGRATION_ADMIN_URL,'This test requires its own disposable cluster, not a shared admin URL');
  const dependencies=process.env.ANDES_BACKEND_NODE_MODULES;
  const compiler=process.env.ANDES_TYPESCRIPT_TSC;
  assert.ok(dependencies&&compiler,'Explicit existing backend dependencies/compiler required; no implicit install');
  const archive=mkdtempSync(join(tmpdir(),'andes-api-runtime-'));
  const blob=(sha,path)=>execFileSync('git',['show',`${sha}:${path}`],{cwd:repo});
  const socketClosures=[];
  const observe=context=>{
    for(const pool of [context.pool,context.telemetryPool])pool.on('connect',client=>{
      socketClosures.push(new Promise(resolve=>client.connection.stream.once('close',resolve)));
    });
    return context;
  };
  let resources,app,ctx;
  try{
    assert.ok(readFileSync(join(dirname(dependencies),'package-lock.json')).equals(readFileSync(join(repo,'package-lock.json'))),
      'Existing backend dependency lock must match the current source');
    const files=execFileSync('git',['ls-files','-z','--','src','db','public','package.json','package-lock.json','tsconfig.json'],
      {cwd:repo,encoding:'utf8'}).split('\0').filter(Boolean);
    for(const path of files){assert.ok(!path.split('/').includes('..'));const target=join(archive,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,readFileSync(join(repo,path)));}
    symlinkSync(dependencies,join(archive,'node_modules'),'dir');
    const helper=join(archive,'scripts/app-integration/runtime.mjs');mkdirSync(dirname(helper),{recursive:true});
    writeFileSync(helper,blob(RESOURCES,'scripts/app-integration/runtime.mjs'));
    execFileSync(process.execPath,[compiler,'-p',join(archive,'tsconfig.json')],{cwd:archive,stdio:'pipe'});
    const {disposableDatabase}=await import(pathToFileURL(helper));
    resources=await disposableDatabase();
    const {createContext,migrate}=await import(pathToFileURL(join(archive,'dist/db.js')));
    const {demoIssuer}=await import(pathToFileURL(join(archive,'dist/demo.js')));
    const {createApp}=await import(pathToFileURL(join(archive,'dist/api/app.js')));
    const {generateKeyPair,SignJWT}=await import(pathToFileURL(createRequire(join(archive,'package.json')).resolve('jose')));
    const serverReadStart=new Date();
    ctx=observe(createContext(resources.url,()=>serverReadStart));await migrate(ctx.pool);
    const issuer=await demoIssuer({ZAVU_LIVE_SEND:'false'});
    let denyDemoTokens=false;
    app=createApp({ctx,auth:{...issuer.auth,keyResolver:async(...args)=>{
      if(denyDemoTokens)throw Error('Synthetic verifier rejection');
      return issuer.auth.keyResolver(...args);
    }},demo:issuer,automaticChecks:true});
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
      // Sessions no longer seed a truck or a family grant (the guided journey creates both); this test seeds them directly.
      const truck=await api.createTruck({label:'Synthetic truck'},{idempotencyKey:'real-truck'});
      const familyGrant=(await ctx.pool.query(`INSERT INTO contact_grants(id,driver_id,contact_id,phone,map_requested,incident_requested,map_accepted,incident_accepted,accepted_at,role)
        VALUES(gen_random_uuid(),$1,$2,'+15555550102',true,true,true,true,$3,'family') RETURNING id`,[world.driver.id,world.family.id,serverReadStart])).rows[0].id;
      const fields={truckId:truck.id,origin:'Synthetic origin',destination:'Synthetic destination',
        country:'BR',locale:'pt-BR',timeZone:'America/Sao_Paulo',expectedArrivalAt:arrival};
      const draft=await api.createDraft({text:'Synthetic persisted draft',fields},{idempotencyKey:'real-draft'});
      assert.equal(draft.fields.expectedArrivalAt,arrival);
      await api.confirmTrip(draft.id,{confirmed:true,contactGrantIds:[familyGrant,world.colleague.grantId]},
        {idempotencyKey:'real-confirm'});
      assert.equal((await api.getTripStatus(draft.id)).trip.expectedArrivalAt,arrival);
      assert.equal((await api.commandTrip(draft.id,'pause',{idempotencyKey:'real-pause'})).automaticEscalation,false);
      assert.equal((await api.commandTrip(draft.id,'resume',{idempotencyKey:'real-resume'})).automaticEscalation,true);
      assert.equal((await api.commandTrip(draft.id,'checkin_ok',{idempotencyKey:'real-checkin'})).automaticEscalation,true);
      for(const method of ['getProfile','listTrucks','listContacts','listTrips','getBootstrap']){
        const response=await api[method]();
        assert.equal(response.readAt,serverReadStart.toISOString());
        assert.ok(!JSON.stringify(response).includes('"phone":'));
      }
      assert.deepEqual((await api.listContacts()).contacts.map(row=>row.role).sort(),['colleague','family']);
      assert.equal((await api.listTrips()).active[0].expectedArrivalAt,arrival);
      const input={state:'stopped',reason:'permission_denied'},options={idempotencyKey:'real-sharing-intent'};
      await assert.rejects(api.setSharing(draft.id,input,options),e=>e.kind==='network'&&e.outcome==='unknown');
      assert.equal(sharing.length,1);
      assert.equal((await api.setSharing(draft.id,input,options)).sharing,'stopped');
      assert.equal((await api.listTrips()).active[0].sharingStoppedAt,serverReadStart.toISOString());
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
      install('driver');
      assert.equal((await api.commandTrip(draft.id,'arrived',{idempotencyKey:'real-arrival'})).automaticEscalation,false);
      const after=await api.getTripStatus(draft.id);
      assert.equal(after.trip.status,'arrived');assert.equal(after.incident.status,'active');assert.equal('location' in after,false);
      await api.revokeTripContact(draft.id,familyGrant,{idempotencyKey:'real-revoke'});
      install('family');await assert.rejects(api.getTripStatus(draft.id),e=>e.status===403&&e.kind==='forbidden');
      session.clear();
    });

    await t.test('separate non-demo and demo issuer tokens cannot cross-validate in either direction',async()=>{
      const {publicKey,privateKey}=await generateKeyPair('RS256');
      const realIssuer='https://identity.example.invalid',audience='andes-client-test';
      const realCtx=observe(createContext(resources.url,()=>serverReadStart));
      const realApp=createApp({ctx:realCtx,auth:{issuer:realIssuer,audience,keyResolver:async()=>publicKey}});
      try{
        const realOrigin=await realApp.listen({port:0,host:'127.0.0.1'});
        const session=new MemorySession();const demoApi=createApiClient({baseUrl:origin,session});
        const realApi=createApiClient({baseUrl:realOrigin,session});
        const world=await demoApi.createDemoSession({demo:true});
        const claims=JSON.parse(Buffer.from(world.driver.token.split('.')[1],'base64url').toString('utf8'));
        session.setCredentials({issuer:claims.iss,subject:claims.sub,accessToken:world.driver.token,expiresAt:claims.exp*1000});
        assert.equal((await demoApi.getIdentity()).id,world.driver.id);
        await assert.rejects(realApi.getIdentity(),error=>error.status===401);
        assert.equal(session.snapshot().status,'anonymous');
        const expires=Math.floor(Date.now()/1000)+120;
        const realToken=await new SignJWT({}).setProtectedHeader({alg:'RS256'}).setIssuer(realIssuer)
          .setAudience(audience).setSubject('synthetic-real-identity').setIssuedAt().setExpirationTime(expires).sign(privateKey);
        session.setCredentials({issuer:realIssuer,subject:'synthetic-real-identity',accessToken:realToken,expiresAt:expires*1000});
        assert.equal(typeof (await realApi.getIdentity()).id,'string');
        await assert.rejects(demoApi.getIdentity(),error=>error.status===401);
        assert.equal(session.snapshot().status,'anonymous');
      }finally{await realApp.close();}
    });

    await t.test('an actual server401 clears a verified demo session, gateway and bound context',async()=>{
      const session=new MemorySession();const api=createApiClient({baseUrl:origin,session});
      const gateway=createDemoSessionGateway({session,api,persona:'driver'});
      let actor=null;const binding=bindJourneySession(session,api,id=>{actor=id;});
      try{
        await gateway.begin();assert.equal(gateway.getSnapshot().state,'authenticated');
        await binding.activate();assert.notEqual(actor,null);
        denyDemoTokens=true;
        await assert.rejects(api.getIdentity(),error=>error.status===401&&error.kind==='unauthenticated');
        assert.equal(session.snapshot().status,'anonymous');assert.equal(actor,null);
        assert.notEqual(gateway.getSnapshot().state,'authenticated');
      }finally{denyDemoTokens=false;binding.dispose();gateway.dispose();}
    });
  }finally{
    try{
      if(app)await app.close();else await ctx?.close();
      // pg-pool bookkeeping can finish before socket end. Observe protocol close
      // before the disposable helper drops the database, rather than sleeping.
      await Promise.all(socketClosures);
    }finally{try{await resources?.cleanup();}finally{rmSync(archive,{recursive:true,force:true});}}
  }
});
