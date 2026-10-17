import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { qualification } from './helpers/dispatch.mjs';
async function api() {
  const m = await import('../dist/notifications/zavu.js').catch(() => ({}));
  assert.equal(typeof m.createZavuProvider, 'function', 'verified provider boundary must exist'); return m;
}
const input = {attemptId:'attempt-fixture',to:'+15555550101',channel:'sms',country:'BR',locale:'pt-BR',summary:'SYNTHETIC incident; ubicación no disponible'};
test('Zavu sends exact explicit channels without fallback and accepts 202/replay 409', async () => {
  const {createZavuProvider} = await api(); const bodies=[];
  const p = createZavuProvider(qualification,'fixture-key',async (url,init) => {
    assert.equal(url,'https://api.zavu.dev/v1/messages'); assert.equal(init.method,'POST');
    assert.equal(init.headers['Zavu-Sender'],'snd_fixture'); bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({message:{id:'original',channel:JSON.parse(init.body).channel,to:input.to,status:'queued',direction:'outbound'}}),{status:bodies.length===2?409:202});
  });
  for (const channel of ['sms','whatsapp','voice']) {
    const payload=p.payload({...input,channel}); assert.equal(payload.fallbackEnabled,false);
    assert.equal((await p.send(payload)).state,'accepted');
  }
  assert.equal(bodies[0].idempotencyKey,'andes:attempt-fixture:sms');
  assert.equal(bodies[1].messageType,'template'); assert.deepEqual(bodies[1].content,{templateId:'tpl_fixture_approved',templateVariables:{'1':input.summary}});
  assert.equal(bodies[2].voiceLanguage,'pt-BR'); assert.equal(bodies[2].messageType,'text');
});
test('ambiguous HTTP never retries; definitive nested limits are rejected; reads use GET only', async () => {
  const {createZavuProvider} = await api();
  for (const [status,body,want] of [[500,{},'unknown'],[202,{},'unknown'],[409,{},'unknown'],[429,{error:{code:'rate_limit_exceeded'}},'rejected'],[402,{code:'insufficient_balance'},'rejected']]) {
    let calls=0; const p=createZavuProvider(qualification,'fixture',async () => {calls++;return new Response(JSON.stringify(body),{status});});
    assert.equal((await p.send(p.payload(input))).state,want); assert.equal(calls,1);
  }
  let calls=0; const p=createZavuProvider(qualification,'fixture',async (_url,init) => {calls++;assert.equal(init.method,'GET');return new Response('{}',{status:404});});
  assert.deepEqual(await p.read('msg_fixture'),{state:'missing'}); assert.equal(calls,1);
  const timeout=createZavuProvider(qualification,'fixture',async()=>{throw new Error('acceptance then timeout');});
  assert.equal((await timeout.send(timeout.payload(input))).state,'unknown');
});
test('v2 signature authenticates exact bytes, signed project/sender and strict time window', async () => {
  const {verifyCallback} = await api();
  const body=Buffer.from('{"id":"evt_fixture_1","type":"message.delivered","timestamp":1792238400000,"senderId":"snd_fixture","projectId":"prj_fixture","data":{"messageId":"msg_fixture_1","to":"+15555550101","channel":"sms","status":"delivered"}}');
  const config={projectId:'prj_fixture',senderId:'snd_fixture',secret:'fixture-secret-not-a-credential'};
  const signature='t=1792238400,v2=889cbe898f6bbdfaf9c52aa12cefa08a51ca401f6e7c241f2ce7892c54ed294b';
  assert.equal(verifyCallback(body,signature,config,new Date(1792238400000)).id,'evt_fixture_1');
  for (const [bytes,header,time] of [[Buffer.concat([body,Buffer.from(' ')]),signature,1792238400000],[body,signature,1792238701000],[body,signature,1792238339000],[body,signature+',t=1792238400',1792238400000],[body,'t=1792238400,v1=abc',1792238400000]]) assert.throws(()=>verifyCallback(bytes,header,config,new Date(time)));
  const foreign=Buffer.from(body.toString().replace('prj_fixture','prj_foreign'));
  const digest=createHmac('sha256',config.secret).update('1792238400.').update(foreign).digest('hex');
  assert.throws(()=>verifyCallback(foreign,`t=1792238400,v2=${digest}`,config,new Date(1792238400000)));
});
test('provider configuration fails closed unless explicit live qualification is complete', async () => {
  const {loadQualification}=await api(); assert.equal(loadQualification({}),null);
  assert.throws(()=>loadQualification({ZAVU_LIVE_SEND:'true',ZAVU_QUALIFICATION_JSON:'{}'}));
  assert.throws(()=>loadQualification({ZAVU_LIVE_SEND:'true',ZAVU_QUALIFICATION_JSON:JSON.stringify({...qualification,entries:[{channel:'voice',country:'BR',locale:'pt-BR'}]})}));
});
test('SQS adapter sends only IDs/version, rejects secret-bearing envelopes, and defers saturated messages', async () => {
  const {createSqsTransport,parseEnvelope}=await import('../dist/notifications/sqs.js');
  const commands=[];const client={async send(command){commands.push(command);return command.constructor.name==='ReceiveMessageCommand'?{Messages:[{Body:'{"jobId":"AAAAAAAA-AAAA-4AAA-AAAA-AAAAAAAAAAAA","version":1,"class":"emergency"}',ReceiptHandle:'valid'},{Body:'{"phone":"+15555550101"}',ReceiptHandle:'invalid'}]}:{};},destroy(){}};
  const transport=createSqsTransport('us-east-1',{emergency:'https://sqs.fixture/emergency',ordinary:'https://sqs.fixture/ordinary'},client);
  const body={jobId:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',version:1,class:'emergency'};
  await transport.publish(body);assert.deepEqual(JSON.parse(commands[0].input.MessageBody),body);
  assert.throws(()=>parseEnvelope(JSON.stringify({...body,phone:'+15555550101'})));
  const messages=await transport.receive('emergency',new AbortController().signal);assert.deepEqual(messages,[{body,receipt:'valid'}]);
  assert.equal(commands[2].constructor.name,'DeleteMessageCommand');assert.equal(commands[2].input.ReceiptHandle,'invalid');
  await transport.defer('emergency','valid');assert.equal(commands.at(-1).input.VisibilityTimeout,30);
  transport.close();
});
