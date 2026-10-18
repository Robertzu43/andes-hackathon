import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const sid = 'AC' + '0'.repeat(32);
const call = 'CA' + 'a'.repeat(32);
const env = {TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: 'syntheticfixture-token', TWILIO_FROM: '+15555550100'};
const voice = {to: '+15555550101', channel: 'voice', messageType: 'text', text: 'Tándem: ALERTA <robo> & "ayuda"', voiceLanguage: 'es-ES', fallbackEnabled: false, idempotencyKey: 'andes:a:voice', metadata: {attemptId: 'a'}};
function base(live = true) {
  const seen = [];
  return {seen, provider: {qualification: {live}, payload: input => ({...input, from: 'base'}),
    send: async payload => { seen.push(['send', payload.channel]); return {state: 'accepted', messageId: 'msg_zavu', status: 'queued'}; },
    read: async id => { seen.push(['read', id]); return {state: 'missing'}; }}};
}

test('voice attempts become a Twilio call with an escaped neural-voice script; other channels stay on Zavu', async () => {
  const {withTwilioVoice} = await import('../dist/notifications/twilio.js');
  const b = base(); const requests = [];
  const p = withTwilioVoice(b.provider, env, async (url, init) => { requests.push({url, init}); return new Response(JSON.stringify({sid: call, status: 'queued', to: voice.to}), {status: 201}); });
  assert.deepEqual(await p.send(voice), {state: 'accepted', messageId: call, status: 'queued'});
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, `https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`);
  assert.equal(requests[0].init.headers.Authorization, `Basic ${Buffer.from(`${sid}:syntheticfixture-token`).toString('base64')}`);
  const form = requests[0].init.body;
  assert.equal(form.get('To'), voice.to); assert.equal(form.get('From'), env.TWILIO_FROM);
  const twiml = form.get('Twiml');
  assert.match(twiml, /^<Response><Say voice="Polly\.Lupe-Neural" language="es-US">Tándem: ALERTA &#60;robo&#62; &#38; &#34;ayuda&#34;<\/Say><Pause length="1"\/><Say /);
  assert.doesNotMatch(twiml, /<robo>/);
  assert.deepEqual(await p.send({...voice, channel: 'sms'}), {state: 'accepted', messageId: 'msg_zavu', status: 'queued'});
  assert.deepEqual(b.seen, [['send', 'sms']]); assert.equal(requests.length, 1);
  assert.equal(p.payload({x: 1}).from, 'base');
});

test('Twilio outcomes: sends-off, definitive 4xx, ambiguous 5xx/timeout and a mismatched destination never count as placed', async () => {
  const {withTwilioVoice} = await import('../dist/notifications/twilio.js');
  let calls = 0;
  const off = withTwilioVoice(base(false).provider, env, async () => { calls++; return new Response('{}', {status: 201}); });
  assert.deepEqual(await off.send(voice), {state: 'rejected', code: 'live_send_disabled'}); assert.equal(calls, 0);
  const reply = (status, body) => withTwilioVoice(base().provider, env, async () => new Response(JSON.stringify(body), {status}));
  assert.deepEqual(await reply(400, {code: 21219}).send(voice), {state: 'rejected', code: 'twilio_21219', retryable: false});
  assert.deepEqual(await reply(429, {code: 20429}).send(voice), {state: 'rejected', code: 'twilio_20429', retryable: true});
  assert.deepEqual(await reply(500, {code: 20500}).send(voice), {state: 'unknown'});
  assert.deepEqual(await reply(201, {sid: call, status: 'queued', to: '+15555550199'}).send(voice), {state: 'unknown'});
  assert.deepEqual(await withTwilioVoice(base().provider, env, async () => { throw new Error('timeout'); }).send(voice), {state: 'unknown'});
});

test('call reads check the SID and destination hash; non-call IDs read from Zavu', async () => {
  const {withTwilioVoice} = await import('../dist/notifications/twilio.js');
  const b = base(); const urls = [];
  const p = withTwilioVoice(b.provider, env, async url => { urls.push(url); return new Response(JSON.stringify({sid: call, status: 'completed', to: voice.to}), {status: 200}); });
  const destinationHash = createHash('sha256').update(voice.to).digest('hex');
  assert.deepEqual(await p.read(call, undefined, {channel: 'voice', destinationHash}), {state: 'accepted', messageId: call, status: 'completed'});
  assert.equal(urls[0], `https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls/${call}.json`);
  assert.deepEqual(await p.read(call, undefined, {channel: 'voice', destinationHash: 'f'.repeat(64)}), {state: 'unknown'});
  assert.deepEqual(await p.read(call, undefined, {channel: 'sms', destinationHash}), {state: 'unknown'});
  assert.deepEqual(await p.read('msg_zavu'), {state: 'missing'}); assert.deepEqual(b.seen, [['read', 'msg_zavu']]);
});

test('Twilio is optional but never half-configured', async () => {
  const {withTwilioVoice} = await import('../dist/notifications/twilio.js');
  const b = base();
  assert.equal(withTwilioVoice(b.provider, {}), b.provider);
  for (const partial of [{TWILIO_ACCOUNT_SID: sid}, {...env, TWILIO_FROM: '3015550100'}, {...env, TWILIO_ACCOUNT_SID: 'ACnope'}, {...env, TWILIO_AUTH_TOKEN: ''}])
    assert.throws(() => withTwilioVoice(b.provider, partial), /Complete Twilio voice configuration required/);
});
