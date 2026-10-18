import assert from 'node:assert/strict';
import test from 'node:test';
import { createApiClient, MemorySession } from '../../src/lib/api/index.ts';
const phone = '+51999999001';
function setup(t, fetch, authenticated = true) {
  const session = new MemorySession();
  if (authenticated) session.setCredentials({ issuer: 'test', subject: 'family', accessToken: 'synthetic-token', expiresAt: Date.now() + 60000 });
  t.after(() => session.clear());
  return { session, api: createApiClient({ baseUrl: 'https://api.example.invalid', session, fetch }) };
}
// Catches missing bearer, accidental write-key coupling, wrong HTTP status or endpoint/body.
test('otp_is_authenticated_keyless_202_200', async t => {
  const calls = [];
  const { api } = setup(t, async (url, init) => {
    calls.push({ path: url.pathname, init });
    return url.pathname.endsWith('/start') ? Response.json({ expiresAt: '2026-10-18T12:10:00.000Z', phone }, { status: 202 })
      : Response.json({ verified: true, phone });
  });
  assert.deepEqual(await api.startDemoPhone({ phone }), { expiresAt: '2026-10-18T12:10:00.000Z' });
  assert.deepEqual(await api.verifyDemoPhone({ phone, code: '123456' }), { verified: true });
  assert.deepEqual(calls.map(c => c.path), ['/v1/demo/phone/start', '/v1/demo/phone/verify']);
  for (const { init } of calls) {
    assert.equal(init.method, 'POST'); assert.equal(init.headers.Authorization, 'Bearer synthetic-token');
    assert.equal(init.headers['Idempotency-Key'], undefined); assert.equal(init.credentials, 'omit');
    assert.equal(init.cache, 'no-store'); assert.equal(init.referrerPolicy, 'no-referrer');
  }
  assert.deepEqual(JSON.parse(calls[0].init.body), { phone });
  assert.deepEqual(JSON.parse(calls[1].init.body), { phone, code: '123456' });
  let dispatched = 0;
  const anonymous = setup(t, async () => { dispatched++; throw new Error('must not dispatch'); }, false).api;
  await assert.rejects(anonymous.startDemoPhone({ phone }), { kind: 'unauthenticated', outcome: 'not_sent' });
  await assert.rejects(anonymous.verifyDemoPhone({ phone, code: '123456' }), { kind: 'unauthenticated' });
  assert.equal(dispatched, 0);
  await assert.rejects(api.createTruck({ label: 'truck' }), { kind: 'invalid_input' });
});
for (const [method, status, code] of [
  ['startDemoPhone',400,'invalid_phone'], ['startDemoPhone',403,'country_not_allowed'],
  ['startDemoPhone',429,'rate_limited'], ['startDemoPhone',429,'demo_budget_exhausted'], ['startDemoPhone',503,'demo_sms_disabled'],
  ['verifyDemoPhone',400,'invalid_code'], ['verifyDemoPhone',410,'code_expired'], ['verifyDemoPhone',429,'too_many_attempts'],
  ['startDemoPhone',400,'invalid_request'], ['verifyDemoPhone',400,'invalid_request'],
]) test(`OTP preserves safe ${method} ${status} ${code} without retry`, async t => {
  let calls = 0;
  const { api } = setup(t, async () => { calls++; return Response.json({ code, phone, message: phone, body: { phone } }, { status }); });
  await assert.rejects(api[method]({ phone, code: '123456' }), e => {
    assert.equal(e.code, code); assert.equal(e.status, status);
    assert.equal(JSON.stringify(e).includes(phone), false); assert.equal(e.message.includes(phone), false); return true;
  });
  assert.equal(calls, 1);
});
for (const [method,status,body] of [
  ['startDemoPhone',200,{expiresAt:'2026-10-18T12:10:00Z'}], ['startDemoPhone',202,{expiresAt:'2026-02-30T12:10:00Z'}],
  ['startDemoPhone',202,{}], ['verifyDemoPhone',202,{verified:true}], ['verifyDemoPhone',200,{verified:false}],
]) test(`OTP rejects malformed success ${method} ${status} ${JSON.stringify(body)}`, async t => {
  const { api } = setup(t, async () => Response.json(body, {status}));
  await assert.rejects(api[method]({phone,code:'123456'}), {kind:'invalid_response'});
});
test('OTP loses session authority on late response and redacts transport failures', async t => {
  let finish; const {api,session} = setup(t, () => new Promise(resolve => { finish=resolve; }));
  const pending=api.startDemoPhone({phone}); session.clear(); finish(Response.json({expiresAt:'2026-10-18T12:10:00Z'},{status:202}));
  await assert.rejects(pending,{kind:'session_changed'});
  let calls=0; const broken=setup(t,async()=>{calls++;throw new Error(phone);}).api;
  await assert.rejects(broken.verifyDemoPhone({phone,code:'123456'}),e=>e.kind==='network'&&!JSON.stringify(e).includes(phone));
  assert.equal(calls,1);
});
test('OTP unknown refusal code stays fixed and a valid ordinary write retains its key',async t=>{
  let response=Response.json({code:phone,message:phone},{status:400});let headers;
  const {api}=setup(t,async(_url,init)=>{headers=init.headers;return response;});
  await assert.rejects(api.startDemoPhone({phone}),e=>e.code==='invalid_input'&&!JSON.stringify(e).includes(phone));
  response=Response.json({id:'11111111-1111-4111-8111-111111111111'});
  await api.createTruck({label:'synthetic'},{idempotencyKey:'one-intent'});
  assert.equal(headers['Idempotency-Key'],'one-intent');assert.equal(headers.Authorization,'Bearer synthetic-token');
});
