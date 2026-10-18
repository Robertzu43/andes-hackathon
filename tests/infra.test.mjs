import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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

test('app-integration CI job runs the isolated harness, the browser seam and the receipt oracle tests',()=>{
  const job=text('.github/workflows/ci.yml').split(/^  (?=\S)/m).find(part=>part.startsWith('app-integration:'));
  assert.ok(job,'app-integration job');
  const steps=job.split('\n').map(line=>line.trim());
  for(const step of ['- run: npm ci','- run: node scripts/app-integration/run.mjs','- run: node scripts/app-integration/check-browser-seam.mjs','- run: node --test evidence/app-acceptance/oracle.test.mjs'])assert.ok(steps.includes(step),step);
  assert.ok(steps.includes('fetch-depth: 0'),'The source gate needs the pinned backend commit');
});

test('demo deploy: consumers only with live sends, their queue actions, optional demo secrets and the demo environment',()=>{
  const deploy=text('infra/demo/deploy.sh').replace(/\s*\\\n\s*/g,' ');
  // With ZAVU_LIVE_SEND=false startWorker refuses the consumers; ungated, `wait -n; exit 1` would restart the whole task, API included.
  assert.ok(deploy.includes('"command":["bash","-c","node dist/worker.js control & if [ \\"\\$ZAVU_LIVE_SEND\\" = true ]; then node dist/worker.js emergency & node dist/worker.js ordinary & fi; node dist/server.js & wait -n; exit 1"]'));
  for(const role of ['emergency','ordinary'])assert.equal(deploy.split(`node dist/worker.js ${role}`).length,2,`${role} starts only inside the gate`);
  assert.ok(deploy.includes('aws ecs update-express-gateway-service --service-arn "$arn" --primary-container'));
  assert.ok(deploy.includes('LIVE="${ZAVU_LIVE_SEND:-false}"')&&deploy.includes('{"name":"ZAVU_LIVE_SEND","value":"$LIVE"}'));
  const task=deploy.split('\n').filter(line=>line.includes('put-role-policy --role-name "$N-task"')).join('\n');
  for(const action of ['sqs:SendMessage','sqs:ReceiveMessage','sqs:DeleteMessage','sqs:ChangeMessageVisibility'])assert.ok(task.includes(`\\"${action}\\"`),action);
  assert.equal(task.split('\\"$(queue_arn emergency)\\",\\"$(queue_arn ordinary)\\"').length,3,'both task policies cover both queues');
  const secrets=deploy.match(/^SECRETS="([^"]+)"$/m)[1].split(' ').map(pair=>pair.split(':')[1]).sort();
  assert.deepEqual(secrets,['DEMO_LIVE_PHONE','DEMO_PHONE_PEPPER','TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','TWILIO_FROM','ZAVU_API_KEY','ZAVU_CALLBACK_SECRET','ZAVU_PROJECT_ID','ZAVU_QUALIFICATION_JSON','ZAVU_SENDER_ID']);
  // Profile and account are the only required shell values. Each name above is stored and injected only when set.
  assert.deepEqual([...deploy.matchAll(/\$\{([A-Z0-9_]+):\?/g)].map(match=>match[1]),['AWS_PROFILE','ANDES_AWS_ACCOUNT']);
  assert.match(deploy,/secret_arns\(\) \{ for pair in \$SECRETS; do var="\$\{pair#\*:\}"; \[ -n "\$\{!var:-\}" \] \|\| continue;/);
  assert.match(deploy,/service_secrets\(\) \{ \{ printf '\{"name":"PGPASSWORD","valueFrom":"%s"\},' "\$\(secret_arn "\$N\/app-db"\)"; for pair in \$SECRETS; do var="\$\{pair#\*:\}"; \[ -n "\$\{!var:-\}" \] \|\| continue;/);
  assert.match(deploy,/if \[ "\$n" -gt 0 \]; then\s+aws iam put-role-policy --role-name "\$N-exec" --policy-name demo-secrets --policy-document "[^\n]*secretsmanager:GetSecretValue[^\n]*\[\$\(secret_arns\)\]/);
  assert.ok(deploy.includes('"secrets":[$(service_secrets)]'));
  assert.match(deploy,/for pair in app-db:PGPASSWORD \$SECRETS; do aws secretsmanager delete-secret/);
  for(const name of ['DEMO_MODE','TRUST_PROXY_HOPS','DEMO_ALLOWED_COUNTRIES','DEMO_OTP_PER_NUMBER_HOURLY','DEMO_OTP_PER_IP_HOURLY','DEMO_SMS_DAILY_CAP','DEMO_ALERTS_PER_NUMBER_DAILY','SILENCE_MS','ASK_GRACE_MS','ARRIVAL_GRACE_MS','CHECK_SWEEP_MS','EMERGENCY_NUMBERS'])assert.ok(deploy.includes(`{"name":"${name}"`),name);
  assert.ok(deploy.includes('{"name":"TRUST_PROXY_HOPS","value":"1"}'));
  // Migrations run in bootstrap, which must come before lock: afterwards the laptop cannot reach RDS.
  assert.ok(deploy.includes('prepare|secrets|image|database|bootstrap|lock|service|url|teardown'));
});

const optionalSecrets=['ZAVU_API_KEY','ZAVU_CALLBACK_SECRET','ZAVU_QUALIFICATION_JSON','DEMO_PHONE_PEPPER','ZAVU_PROJECT_ID','ZAVU_SENDER_ID','DEMO_LIVE_PHONE','TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','TWILIO_FROM'];

test('demo deploy: with no Zavu or pepper secrets the task still starts, and a set secret is the only one injected',()=>{
  const dir=mkdtempSync(join(tmpdir(),'andes-deploy-'));
  const log=join(dir,'aws.log');
  const aws=join(dir,'aws');
  writeFileSync(aws,`#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$AWS_STUB_LOG"
case "$*" in
  *'sts get-caller-identity'*) echo 123456789012 ;;
  *list-services*) echo None ;;
  *describe-secret*'--query ARN'*) echo 'arn:aws:secretsmanager:us-east-1:123456789012:secret:stub-AbCdEf' ;;
  *describe-secret*) exit 1 ;;
  *create-express-gateway-service*) echo 'arn:aws:ecs:stub:service/andes-demo' ;;
  *put-role-policy*|*create-secret*|*put-secret-value*) ;;
  *) echo stub ;;
esac
`);
  chmodSync(aws,0o755);
  const serviceJson='/tmp/andes-demo-service.json';
  function run(step,extra={}){
    writeFileSync(log,'');
    const env={...process.env,PATH:`${dir}:/usr/bin:/bin`,AWS_PROFILE:'stub',ANDES_AWS_ACCOUNT:'123456789012',AWS_REGION:'us-east-1',AWS_STUB_LOG:log,...extra};
    for(const name of optionalSecrets)if(!(name in extra))delete env[name];
    if(!('ZAVU_LIVE_SEND' in extra))delete env.ZAVU_LIVE_SEND;
    const result=spawnSync('infra/demo/deploy.sh',[step],{env,encoding:'utf8',timeout:15000});
    assert.equal(result.status,0,result.stderr||result.stdout);
    return {stdout:result.stdout,calls:readFileSync(log,'utf8').split('\n').filter(Boolean)};
  }
  function secretNames(){return JSON.parse(readFileSync(serviceJson,'utf8')).primaryContainer.secrets.map(item=>item.name);}
  try{
    const bare=run('secrets');
    assert.equal(bare.stdout.trim(),'stored 0 secrets');
    assert.ok(!bare.calls.some(call=>/secretsmanager|iam put-role-policy/.test(call)),bare.calls.join('\n'));
    const off=run('service');
    assert.deepEqual(secretNames(),['PGPASSWORD']);
    assert.equal(JSON.parse(readFileSync(serviceJson,'utf8')).primaryContainer.environment.find(item=>item.name==='ZAVU_LIVE_SEND').value,'false');
    assert.ok(off.calls.some(call=>call.includes('create-express-gateway-service')));
    assert.ok(!off.calls.some(call=>/zavu-|demo-phone-pepper|create-secret|put-secret-value|demo-secrets/.test(call)),off.calls.join('\n'));
    // Live without its secrets would crash-loop the task (API included): refused before anything is rolled out.
    writeFileSync(log,'');
    const refused=spawnSync('infra/demo/deploy.sh',['service'],{env:{PATH:`${dir}:/usr/bin:/bin`,AWS_PROFILE:'stub',ANDES_AWS_ACCOUNT:'123456789012',AWS_REGION:'us-east-1',AWS_STUB_LOG:log,ZAVU_LIVE_SEND:'true'},encoding:'utf8',timeout:15000});
    assert.equal(refused.status,1);assert.match(refused.stderr,/ZAVU_LIVE_SEND=true needs ZAVU_API_KEY/);
    assert.ok(!readFileSync(log,'utf8').includes('express-gateway-service'));
    const live={ZAVU_LIVE_SEND:'true',ZAVU_API_KEY:'k',ZAVU_QUALIFICATION_JSON:'{}',ZAVU_PROJECT_ID:'p',ZAVU_SENDER_ID:'s',ZAVU_CALLBACK_SECRET:'c',DEMO_LIVE_PHONE:'+15555550101'};
    run('service',live);
    assert.equal(JSON.parse(readFileSync(serviceJson,'utf8')).primaryContainer.environment.find(item=>item.name==='ZAVU_LIVE_SEND').value,'true');
    assert.deepEqual(secretNames(),['PGPASSWORD','ZAVU_API_KEY','ZAVU_CALLBACK_SECRET','ZAVU_QUALIFICATION_JSON','ZAVU_PROJECT_ID','ZAVU_SENDER_ID','DEMO_LIVE_PHONE']);
    const partial=run('secrets',{ZAVU_API_KEY:'synthetic-not-a-key',DEMO_PHONE_PEPPER:'synthetic-pepper'});
    assert.equal(partial.stdout.trim(),'stored 2 secrets');
    assert.ok(partial.calls.some(call=>call.includes('create-secret')&&call.includes('andes-demo/zavu-api-key')));
    assert.ok(partial.calls.some(call=>call.includes('create-secret')&&call.includes('andes-demo/demo-phone-pepper')));
    assert.ok(partial.calls.some(call=>call.includes('demo-secrets')));
    assert.ok(!partial.calls.some(call=>/zavu-callback-secret|zavu-qualification|zavu-project-id|zavu-sender-id/.test(call)),partial.calls.join('\n'));
    run('service',{ZAVU_API_KEY:'synthetic-not-a-key',DEMO_PHONE_PEPPER:'synthetic-pepper'});
    assert.deepEqual(secretNames(),['PGPASSWORD','ZAVU_API_KEY','DEMO_PHONE_PEPPER']);
  }finally{
    rmSync(dir,{recursive:true,force:true});
    rmSync(serviceJson,{force:true});
  }
});
