import { createHash } from 'node:crypto';
import type { Outcome, Provider, ReadOutcome } from './zavu.js';
// Neural (AI) text-to-speech voices per qualified voice language. ponytail: fixed map, make it configurable if judges want another voice.
const voices: Record<string, { voice: string; language: string }> = {
  'es-ES': { voice: 'Polly.Lupe-Neural', language: 'es-US' },
  'pt-BR': { voice: 'Polly.Camila-Neural', language: 'pt-BR' }
};
const xml = (text: string) => text.replace(/[<>&'"]/g, c => `&#${c.charCodeAt(0)};`);
/** The SOS call script: the alert twice, so a contact who picks up mid-sentence still hears all of it. */
export function callTwiml(text: string, voiceLanguage: string): string {
  const { voice, language } = voices[voiceLanguage] ?? voices['es-ES']!;
  const say = `<Say voice="${voice}" language="${language}">${xml(text)}</Say>`;
  return `<Response>${say}<Pause length="1"/>${say}</Response>`;
}
/**
 * Zavu's account has no voice number, so voice attempts go out as Twilio calls; every other channel stays on Zavu.
 * Authorization, allowlist and budgets already ran in dispatch before send(), exactly as for Zavu.
 */
export function withTwilioVoice(base: Provider, env: NodeJS.ProcessEnv, http: typeof fetch = fetch): Provider {
  const values = [env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, env.TWILIO_FROM];
  if (values.every(value => !value)) return base;
  const [sid, token, from] = values;
  if (!/^AC[0-9a-f]{32}$/.test(sid ?? '') || !token || !/^\+[1-9]\d{6,14}$/.test(from ?? '')) throw new Error('Complete Twilio voice configuration required');
  const headers = { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}` };
  const calls = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls`;
  const isCall = (id: string) => /^CA[0-9a-f]{32}$/.test(id);
  return {
    qualification: base.qualification,
    payload: input => base.payload(input),
    async send(payload, signal): Promise<Outcome> {
      if (payload.channel !== 'voice') return base.send(payload, signal);
      if (!base.qualification.live) return { state: 'rejected', code: 'live_send_disabled' };
      try {
        const timeout = AbortSignal.timeout(10000);
        const body = new URLSearchParams({ To: payload.to, From: from!, Twiml: callTwiml(payload.text ?? '', payload.voiceLanguage ?? 'es-ES') });
        const response = await http(`${calls}.json`, { method: 'POST', headers, body, signal: signal ? AbortSignal.any([signal, timeout]) : timeout, redirect: 'error' });
        const json = await response.json().catch(() => null) as { sid?: unknown; status?: unknown; to?: unknown; code?: unknown } | null;
        if (response.status === 201 && typeof json?.sid === 'string' && isCall(json.sid) && json.to === payload.to) return { state: 'accepted', messageId: json.sid, status: String(json.status ?? 'queued') };
        // Twilio has no idempotency key: only a definitive 4xx means no call was placed; anything else is never retried.
        if (response.status >= 400 && response.status < 500 && Number.isSafeInteger(json?.code)) return { state: 'rejected', code: `twilio_${json!.code}`, retryable: [401, 429].includes(response.status) };
        return { state: 'unknown' };
      } catch { return { state: 'unknown' }; }
    },
    async read(messageId, signal, expected): Promise<ReadOutcome> {
      if (!isCall(messageId)) return base.read(messageId, signal, expected);
      try {
        const timeout = AbortSignal.timeout(10000);
        const response = await http(`${calls}/${messageId}.json`, { method: 'GET', headers, signal: signal ? AbortSignal.any([signal, timeout]) : timeout, redirect: 'error' });
        if (response.status === 404) { await response.body?.cancel(); return { state: 'missing' }; }
        const json = await response.json().catch(() => null) as { sid?: unknown; status?: unknown; to?: unknown } | null;
        if (response.status !== 200 || json?.sid !== messageId || typeof json.to !== 'string') return { state: 'unknown' };
        if (expected && (expected.channel !== 'voice' || createHash('sha256').update(json.to).digest('hex') !== expected.destinationHash)) return { state: 'unknown' };
        return { state: 'accepted', messageId, status: String(json.status ?? 'queued') };
      } catch { return { state: 'unknown' }; }
    }
  };
}
