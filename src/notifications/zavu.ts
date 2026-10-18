import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { problem, type Channel, type ChannelSupport } from '../contracts.js';
export interface QualifiedChannel extends ChannelSupport {
  evidence: string; text: string; templateId?: string; summaryVariable?: string; voiceLanguage?: 'es-ES' | 'pt-BR';
}
export interface Qualification {
  live: boolean; accountId: string; senderId: string; evidence: string; entries: QualifiedChannel[];
  dailyLimit: number; channelDailyLimit: number; minuteLimit: number; emergencyReserve: number;
  /** Optional: only these E.164 destinations may be sent to; any other is refused before the provider is called. */
  allowedDestinations?: string[];
}
export interface SendInput { attemptId: string; to: string; channel: Channel; country: string; locale: string; summary: string }
export interface Payload { to: string; channel: Channel; messageType: 'text' | 'template'; text?: string;
  content?: { templateId: string; templateVariables: Record<string, string> }; voiceLanguage?: string;
  fallbackEnabled: false; idempotencyKey: string; metadata: { attemptId: string } }
export type Outcome = { state: 'accepted'; messageId: string; providerMessageId?: string; status: string }
  | { state: 'rejected'; code: string; retryable?: boolean } | { state: 'unknown' };
export type ReadOutcome = Outcome | { state: 'missing' };
export interface Provider { qualification: Qualification; payload(input: SendInput): Payload;
  send(payload: Payload, signal?: AbortSignal): Promise<Outcome>; read(messageId: string, signal?: AbortSignal, expected?: { channel: Channel; destinationHash: string }): Promise<ReadOutcome> }
export interface CallbackConfig { projectId: string; senderId: string; secret: string }
export interface CallbackEvent { id: string; type: string; timestamp: number; senderId: string; projectId: string;
  data: { messageId: string; to: string; channel: Channel; status: string; errorCode?: string } }
const channels = ['sms', 'whatsapp', 'voice'];
function bounded(value: unknown, max = 256): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max; }
export function loadQualification(env: NodeJS.ProcessEnv): Qualification | null {
  const live = env.ZAVU_LIVE_SEND === 'true';
  if (!live && !env.ZAVU_QUALIFICATION_JSON) return null;
  try {
    const q = JSON.parse(env.ZAVU_QUALIFICATION_JSON ?? '{}') as Qualification;
    if (!bounded(q.accountId) || !bounded(q.senderId) || !bounded(q.evidence, 2000) || q.evidence.startsWith('syntheticfixture:') || !Array.isArray(q.entries) || !q.entries.length || q.entries.length > 100) throw Error();
    for (const key of ['dailyLimit', 'channelDailyLimit', 'minuteLimit', 'emergencyReserve'] as const) {
      if (!Number.isSafeInteger(q[key]) || q[key] < (key === 'emergencyReserve' ? 0 : 1)) throw Error();
    }
    if (q.emergencyReserve >= Math.min(q.dailyLimit, q.channelDailyLimit, q.minuteLimit)) throw Error();
    if (q.allowedDestinations !== undefined && (!Array.isArray(q.allowedDestinations) || q.allowedDestinations.length > 10 || q.allowedDestinations.some(to => typeof to !== 'string' || !/^\+[1-9]\d{6,14}$/.test(to)))) throw Error();
    const seen = new Set<string>();
    for (const entry of q.entries) {
      const key = `${entry.country}:${entry.locale}:${entry.channel}`;
      if (!channels.includes(entry.channel) || !/^[A-Z]{2}$/.test(entry.country) || !bounded(entry.locale, 64) || new Intl.Locale(entry.locale).toString() !== entry.locale || !bounded(entry.evidence, 2000) || entry.evidence.startsWith('syntheticfixture:') || !bounded(entry.text, 1000) || seen.has(key)) throw Error();
      seen.add(key);
      if (entry.channel === 'voice' && !['es-ES', 'pt-BR'].includes(entry.voiceLanguage ?? '')) throw Error();
      if (entry.channel === 'whatsapp' && (!bounded(entry.templateId) || !bounded(entry.summaryVariable, 64) || !/^(?:[1-9]\d*|[a-zA-Z][a-zA-Z0-9_]*)$/.test(entry.summaryVariable!))) throw Error();
    }
    return { ...q, live };
  } catch { throw new Error('Complete evidenced Zavu qualification required'); }
}
export function createZavuProvider(qualification: Qualification, apiKey: string, http: typeof fetch = fetch): Provider {
  if (!apiKey) throw new Error('Provider credentials required');
  const headers = { Authorization: `Bearer ${apiKey}`, 'Zavu-Sender': qualification.senderId, 'Content-Type': 'application/json' };
  function accepted(body: unknown, expected?: Payload): Outcome {
    const m = (body as { message?: Record<string, unknown> })?.message;
    if (!m || !bounded(m.id) || !bounded(m.status, 80) || m.direction !== 'outbound' || !channels.includes(String(m.channel)) || !bounded(m.to, 20) || (expected && (m.channel !== expected.channel || m.to !== expected.to))) return { state: 'unknown' };
    return { state: 'accepted', messageId: m.id, status: m.status, ...(bounded(m.providerMessageId) ? { providerMessageId: m.providerMessageId } : {}) };
  }
  async function request(path: string, init: RequestInit) {
    const timeout = AbortSignal.timeout(10000);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return http(`https://api.zavu.dev/v1/messages${path}`, { ...init, headers, signal, redirect: 'error' });
  }
  return {
    qualification,
    payload(input) {
      const entry = qualification.entries.find(e => e.channel === input.channel && e.country === input.country && e.locale === input.locale);
      if (!entry || !/^\+[1-9]\d{6,14}$/.test(input.to)) throw new Error('Unqualified destination');
      const base = { to: input.to, channel: input.channel, fallbackEnabled: false as const,
        idempotencyKey: `andes:${input.attemptId}:${input.channel}`, metadata: { attemptId: input.attemptId } };
      if (input.channel === 'whatsapp') {
        if (!entry.templateId || !entry.summaryVariable) throw new Error('Approved WhatsApp template required');
        return { ...base, messageType: 'template', content: { templateId: entry.templateId, templateVariables: { [entry.summaryVariable]: input.summary } } };
      }
      if (input.channel === 'voice' && !entry.voiceLanguage) throw new Error('Qualified voice language required');
      return { ...base, messageType: 'text', text: `${entry.text} ${input.summary}`, ...(input.channel === 'voice' ? { voiceLanguage: entry.voiceLanguage } : {}) };
    },
    async send(payload, signal) {
      if (!qualification.live) return { state: 'rejected', code: 'live_send_disabled' };
      try {
        const response = await request('', { method: 'POST', body: JSON.stringify(payload), signal });
        const body = await response.json().catch(() => null);
        if (response.status === 202 || response.status === 409) return accepted(body, payload);
        const code = (body as { code?: unknown; error?: { code?: unknown } })?.code ?? (body as { error?: { code?: unknown } })?.error?.code;
        // Definitive not-sent replies. Rate limits and auth/payment problems are transient or operator-fixable.
        if ([400, 401, 402, 403, 404, 429].includes(response.status) && bounded(code, 80) && /^[A-Za-z0-9_]+$/.test(code)) return { state: 'rejected', code, retryable: [401, 402, 403, 429].includes(response.status) };
        return { state: 'unknown' };
      } catch { return { state: 'unknown' }; }
    },
    async read(messageId, signal, expected) {
      try {
        const response = await request(`/${encodeURIComponent(messageId)}`, { method: 'GET', signal });
        if (response.status === 404) { await response.body?.cancel(); return { state: 'missing' }; }
        const body = await response.json().catch(() => null);
        if (response.status !== 200) return { state: 'unknown' };
        const result = accepted(body);
        const message = (body as { message?: { channel?: string; to?: string } })?.message;
        if (expected && (message?.channel !== expected.channel || typeof message.to !== 'string' || createHash('sha256').update(message.to).digest('hex') !== expected.destinationHash)) return { state: 'unknown' };
        return result.state === 'accepted' && result.messageId === messageId ? result : { state: 'unknown' };
      } catch { return { state: 'unknown' }; }
    }
  };
}
export function verifyCallback(raw: Buffer, signature: string | undefined, config: CallbackConfig, now: Date): CallbackEvent {
  const fail = () => problem(401, 'invalid_callback');
  if (!signature || signature.length > 1024 || raw.length > 128 * 1024) fail();
  const components = new Map<string, string>();
  for (const part of signature!.split(',')) {
    const [key, value, extra] = part.trim().split('=');
    if (key === 't' || key === 'v2') {
      if (extra !== undefined || value === undefined || components.has(key)) fail();
      components.set(key, value!);
    }
  }
  const stamp = components.get('t') ?? ''; const digest = components.get('v2') ?? '';
  if (!/^(0|[1-9]\d{0,12})$/.test(stamp) || !/^[a-f0-9]{64}$/.test(digest)) fail();
  const age = now.getTime() / 1000 - Number(stamp);
  if (age > 300 || age < -60) fail();
  const expected = createHmac('sha256', config.secret).update(`${stamp}.`).update(raw).digest();
  if (!timingSafeEqual(expected, Buffer.from(digest, 'hex'))) fail();
  let event: CallbackEvent;
  try { event = JSON.parse(raw.toString('utf8')); } catch { return fail(); }
  if (!event! || !bounded(event.id) || !bounded(event.type, 100) || !Number.isSafeInteger(event.timestamp) || event.projectId !== config.projectId || event.senderId !== config.senderId || !event.data || !bounded(event.data.messageId) || !/^\+[1-9]\d{6,14}$/.test(event.data.to) || !channels.includes(event.data.channel) || !bounded(event.data.status, 80) || (event.data.errorCode !== undefined && (!bounded(event.data.errorCode, 80) || !/^[A-Za-z0-9_]+$/.test(event.data.errorCode)))) fail();
  return event!;
}
