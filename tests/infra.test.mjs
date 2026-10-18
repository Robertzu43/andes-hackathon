import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
const t=JSON.parse(readFileSync('infra/template.json','utf8'));
const r=t.Resources;
const text=path=>readFileSync(path,'utf8');
const properties=name=>r[name].Properties;
const env=role=>Object.fromEntries(properties(role+'Task').ContainerDefinitions[0].Environment.map(e=>[e.Name,e.Value]));

test('public TLS entry, private task/database boundaries and retained encrypted state',()=>{
  assert.equal(properties('Alb').Scheme,'internet-facing');
  assert.equal(properties('HttpsListener').Protocol,'HTTPS');assert.equal(properties('HttpsListener').Port,443);
  assert.equal(properties('HttpRedirect').DefaultActions[0].RedirectConfig.Protocol,'HTTPS');
  assert.deepEqual(properties('ApiFromAlb').SourceSecurityGroupId,{Ref:'AlbSecurityGroup'});
  for(const name of ['ApiSecurityGroup','WorkerSecurityGroup','DatabaseSecurityGroup'])assert.deepEqual(properties(name).SecurityGroupIngress,[]);
  assert.equal(properties('Database').PubliclyAccessible,false);assert.equal(properties('Database').MultiAZ,true);
  assert.equal(properties('Database').StorageEncrypted,true);assert.equal(properties('Database').DeletionProtection,true);
  assert.equal(properties('DbParameters').Parameters['rds.force_ssl'],'1');
  for(const name of ['Database','ReservedAudio','EmergencyQueue','OrdinaryQueue','EmergencyDLQ','OrdinaryDLQ','AppSecret']){
    assert.equal(r[name].DeletionPolicy,'Retain');assert.equal(r[name].UpdateReplacePolicy,'Retain');
  }
  assert.ok(Object.values(properties('ReservedAudio').PublicAccessBlockConfiguration).every(Boolean));
  assert.deepEqual(properties('ReservedAudio').LifecycleConfiguration.Rules,[{Id:'abort-incomplete',Status:'Enabled',AbortIncompleteMultipartUpload:{DaysAfterInitiation:1}}]);
  for(const cls of ['Emergency','Ordinary']) {
    assert.equal(properties(cls+'Queue').VisibilityTimeout,30);assert.equal(properties(cls+'Queue').RedrivePolicy.maxReceiveCount,5);
    assert.ok(properties(cls+'DLQ').MessageRetentionPeriod>properties(cls+'Queue').MessageRetentionPeriod);
    assert.equal(properties(cls+'DLQ').RedriveAllowPolicy.redrivePermission,'byQueue');
    assert.equal(properties(cls+'Queue').SqsManagedSseEnabled,true);
  }
});

test('task IAM isolates each queue; execution secrets and administrator never become task access',()=>{
  assert.equal(properties('ApiRole').Policies,undefined);assert.equal(properties('BootstrapRole').Policies,undefined);
  for(const [role,actions] of [['Control',['sqs:SendMessage']],['Emergency',['sqs:ReceiveMessage','sqs:DeleteMessage','sqs:ChangeMessageVisibility']],['Ordinary',['sqs:ReceiveMessage','sqs:DeleteMessage','sqs:ChangeMessageVisibility']]]) {
    const statement=properties(role+'Role').Policies[0].PolicyDocument.Statement;
    assert.equal(statement.length,1);assert.deepEqual(statement[0].Action,actions);
    assert.deepEqual(statement[0].Resource,role==='Control'?[{'Fn::GetAtt':['EmergencyQueue','Arn']},{'Fn::GetAtt':['OrdinaryQueue','Arn']}]:{'Fn::GetAtt':[role+'Queue','Arn']});
  }
  const runtime=JSON.stringify(properties('RuntimeExecutionRole'));
  assert.ok(!runtime.includes('MasterUserSecret'));assert.ok(!runtime.includes('sqs:'));assert.ok(!runtime.includes('s3:'));
  assert.match(JSON.stringify(properties('BootstrapExecutionRole')),/MasterUserSecret.SecretArn/);
  for(const role of ['Api','Control','Emergency','Ordinary']) {
    assert.ok(!JSON.stringify(properties(role+'Task')).includes('MasterUserSecret'));
    assert.ok(!Object.keys(env(role)).some(k=>/PASSWORD|API_KEY|CALLBACK_SECRET|DATABASE_URL/.test(k)));
    assert.equal(env(role).PGSSLROOTCERT,'/app/infra/rds-global-bundle.pem');
  }
});

test('exact process wiring, bootstrap/live gates and conservative rolling capacity',()=>{
  assert.equal(t.Parameters.ServicesEnabled.Default,'false');assert.equal(t.Parameters.LiveSendEnabled.Default,'false');
  assert.ok(t.Rules.LiveRequiresProvider);
  assert.equal(Object.values(r).filter(v=>v.Type==='AWS::ApplicationAutoScaling::ScalableTarget').length,0);
  let budget=0;
  for(const role of ['Api','Control','Emergency','Ordinary']) {
    const p=properties(role+'Service');
    assert.deepEqual(p.DesiredCount,{'Fn::If':[role==='Emergency'||role==='Ordinary'?'DeliveryActive':'ServicesActive',2,0]});
    assert.equal(p.NetworkConfiguration.AwsvpcConfiguration.AssignPublicIp,'DISABLED');
    assert.equal(p.DeploymentConfiguration.MaximumPercent,200);assert.equal(p.DeploymentConfiguration.MinimumHealthyPercent,100);
    budget+=4*(role==='Api'?10:2);
    const container=properties(role+'Task').ContainerDefinitions[0];
    assert.deepEqual(container.Command,role==='Api'?['node','dist/server.js']:['node','dist/worker.js',role.toLowerCase()]);
    assert.deepEqual(container.Image,{Ref:'ImageUri'});assert.deepEqual(env(role).ZAVU_LIVE_SEND,{Ref:'LiveSendEnabled'});
  }
  assert.equal(budget,64);assert.equal(budget+2+14,80);assert.equal(properties('DbParameters').Parameters.max_connections,'100');
  assert.deepEqual(properties('BootstrapTask').ContainerDefinitions[0].Command,['node','scripts/bootstrap.mjs']);
  assert.deepEqual(env('Api').OIDC_JWKS_URL,{Ref:'OidcJwksUrl'});
  for(const role of ['Control','Emergency','Ordinary'])assert.deepEqual(env(role).SQS_EMERGENCY_URL,{Ref:'EmergencyQueue'});
  assert.deepEqual(properties('ApiService').LoadBalancers[0].ContainerPort,3000);
  assert.ok(r.ApiService.DependsOn.includes('HttpsListener'));
});

test('backend CI job runs each check as its own exact step, gated only by install and typecheck',()=>{
  // Substring checks passed when the backend typecheck step was deleted, because other steps contain that text.
  const job=text('.github/workflows/ci.yml').split(/^  (?=\S)/m).find(part=>part.startsWith('backend:'));
  assert.ok(job,'backend job');
  const steps=job.split('\n').map(line=>line.trim()).filter(line=>line.startsWith('- '));
  for(const command of ['npm ci','npm run typecheck','npm test','npm run demo','npm run test:tooling','pip install cfn-lint==1.57.2','cfn-lint infra/template.json','docker build --platform linux/amd64 -t andes-backend:ci .'])
    assert.ok(steps.includes(`- run: ${command}`),command);
  // Web or client checks belong in the web job: here a failure would skip the backend tests.
  const gate=steps.slice(0,steps.indexOf('- run: npm test'));
  assert.ok(gate.every(step=>/^- uses: actions\/(checkout|setup-node)@/.test(step)||['- run: npm ci','- run: npm run typecheck'].includes(step)),gate.join('\n'));
});

test('image contains migration SQL/CA and CI runs real PostgreSQL tests without live credentials',()=>{
  const docker=text('Dockerfile');
  assert.match(docker,/FROM node:24-bookworm-slim/g);assert.match(docker,/COPY db \.\/db/);
  assert.match(docker,/scripts\/bootstrap\.mjs/);assert.match(docker,/COPY infra\/rds-global-bundle\.pem/);assert.match(docker,/USER node/);assert.match(docker,/COPY public \.\/public/);
  assert.match(text('.dockerignore'),/!infra\/rds-global-bundle\.pem/);
  assert.match(docker,/COPY web \.\//);assert.match(docker,/RUN npm run build/);assert.match(docker,/COPY --from=web \/app\/web\/dist \.\/web\/dist/);
  // Host node_modules (macOS binaries) must never overwrite the image's own install.
  assert.match(text('.dockerignore'),/^\*\*\/node_modules$/m);assert.match(text('.dockerignore'),/^\*\*\/dist$/m);
  const ci=text('.github/workflows/ci.yml');
  assert.match(ci,/postgres:18-bookworm/);assert.match(ci,/ZAVU_LIVE_SEND: "false"/);assert.ok(!ci.includes('aws-actions/configure-aws-credentials'));
  assert.match(text('compose.yaml'),/127\.0\.0\.1:5432:5432/);
});

test('app-integration CI job runs the isolated harness and the receipt oracle tests',()=>{
  const job=text('.github/workflows/ci.yml').split(/^  (?=\S)/m).find(part=>part.startsWith('app-integration:'));
  assert.ok(job,'app-integration job');
  const steps=job.split('\n').map(line=>line.trim());
  for(const step of ['- run: npm ci','- run: node scripts/app-integration/run.mjs','- run: node --test evidence/app-acceptance/oracle.test.mjs'])assert.ok(steps.includes(step),step);
  assert.ok(steps.includes('fetch-depth: 0'),'The source gate needs the pinned backend commit');
});

// Exercise the smoke oracle over real HTTP, without needing Docker or a web dependency install.
async function smokeFixture(t, fault = '') {
  const root=mkdtempSync(join(tmpdir(),'andes-image-smoke-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  mkdirSync(join(root,'web/dist/assets'),{recursive:true});mkdirSync(join(root,'dist'));
  writeFileSync(join(root,'web/dist/index.html'),'<!doctype html><title>SYNTHETIC shell</title>');
  writeFileSync(join(root,'web/dist/assets/app-SYNTH.js'),'export const synthetic = true;');
  writeFileSync(join(root,'web/dist/assets/app-SYNTH.css'),'body { color: black; }');
  if(fault==='missing-index')rmSync(join(root,'web/dist/index.html'));
  writeFileSync(join(root,'dist/server.js'),`
    const http = require('node:http');
    const {readFileSync, writeFileSync} = require('node:fs');
    writeFileSync('server.pid', String(process.pid));
    const fault = ${JSON.stringify(fault)};
    if (fault === 'exit') process.exit(7);
    http.createServer((request, response) => {
      if (fault === 'timeout') return;
      const path = request.url;
      if (path.startsWith('/v1') && fault !== 'api-html') {
        response.writeHead(401, {'Content-Type':'application/json'});
        response.end('{"code":"unauthorized"}');return;
      }
      if (path.startsWith('/assets/')) {
        response.writeHead(200, {'Content-Type':path.endsWith('.js')?'text/javascript':'text/css',
          'Cache-Control':'public, max-age=31536000, immutable'});
        response.end(readFileSync(fault === 'asset-html' ? 'web/dist/index.html' : 'web/dist'+path));return;
      }
      response.writeHead(200, {'Content-Type':'text/html', 'Cache-Control':'no-store'});
      response.end(readFileSync('web/dist/index.html'));
    }).listen(Number(process.env.PORT), process.env.HOST);
  `);
  const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
  const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
  const run=spawnSync(process.execPath,[resolve('scripts/smoke-image.mjs')],{
    cwd:root,encoding:'utf8',timeout:20000,env:{PATH:process.env.PATH,PORT:String(port)}
  });
  assert.equal(run.error,undefined,run.error?.message);assert.equal(run.signal,null,run.stderr);
  if(existsSync(join(root,'server.pid'))) {
    const pid=Number(readFileSync(join(root,'server.pid'),'utf8'));
    assert.throws(()=>process.kill(pid,0),{code:'ESRCH'},'smoke must reap its server on success and failure');
  }
  return run;
}

test('image smoke accepts readable shell/assets, deep links and JSON API auth, then stops the server',async t=>{
  const run=await smokeFixture(t);
  assert.equal(run.status,0,run.stderr);assert.match(run.stdout,/Image smoke passed/);
});

test('image smoke rejects missing artifacts and incorrect HTTP responses with a nonzero exit',async t=>{
  for(const [fault,reason] of [['missing-index',/index\.html/],['asset-html',/asset .* contents/],
    ['api-html',/\/v1\/me status/],['exit',/server exited/]])await t.test(fault,async t=>{
    const run=await smokeFixture(t,fault);
    assert.equal(run.status,1,run.stderr);assert.doesNotMatch(run.stdout,/Image smoke passed/);
    assert.match(run.stderr,reason);
  });
});

test('image smoke times out an unresponsive server and reaps it',async t=>{
  const run=await smokeFixture(t,'timeout');
  assert.equal(run.status,1,run.stderr);assert.match(run.stderr,/timed out/i);
});
