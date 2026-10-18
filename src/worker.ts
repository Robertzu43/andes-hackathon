import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createContext, databaseConfig, type Context } from './db.js';
import type { Channel } from './contracts.js';
import { consume, recoverWork, reconcileOnce, relayOnce, type DemoDispatch, type Transport, type WorkClass } from './notifications/dispatch.js';
import { createSqsTransport } from './notifications/sqs.js';
import { createZavuProvider, loadQualification, type Provider } from './notifications/zavu.js';
import { loadCallbackConfig } from './notifications/callback.js';
import { checkConfig, checkOnce, type CheckConfig } from './checks/sweep.js';
import { DEMO_PREFIX, demoLimits, purgeDemoWorlds } from './demo-phone.js';
export function configuredProvider(env: NodeJS.ProcessEnv, http: typeof fetch = fetch): Provider | null {
  const qualification = loadQualification(env);
  if (!qualification) return null;
  const callback = loadCallbackConfig(env);
  if (!env.ZAVU_API_KEY || !callback || callback.projectId !== qualification.accountId || callback.senderId !== qualification.senderId) throw new Error('Matching Zavu API and callback configuration required');
  if (env.DEMO_MODE === 'true') {
    // Every configured demo alert declares itself; the WhatsApp template itself is qualified separately.
    if (qualification.entries.some(entry => !entry.text.normalize('NFC').startsWith(DEMO_PREFIX))) throw new Error(`DEMO_MODE alert texts must start with «${DEMO_PREFIX}»`);
    if (qualification.live && !qualification.demoLimits) throw new Error('DEMO_MODE live sends require demoLimits');
    if (qualification.live) demoLimits(env);
  }
  return createZavuProvider(qualification, env.ZAVU_API_KEY, http);
}
/** Built once at worker start; production workers retain their static destination policy. */
export function demoDispatch(env: NodeJS.ProcessEnv): DemoDispatch | undefined {
  return env.DEMO_MODE === 'true' ? {enabled: true, alertsPerNumberDaily: demoLimits(env).alertsPerNumberDaily} : undefined;
}
async function loop(operation: () => Promise<unknown>, interval: number, signal: AbortSignal) {
  while (!signal.aborted) {
    try { await operation(); } catch { process.stderr.write('Worker operation failed\n'); }
    await delay(interval, undefined, { signal }).catch(() => {});
  }
}
export async function control(ctx: Context, transport: Transport, provider: Provider | null, signal: AbortSignal, checks: CheckConfig | null = null, demo?: DemoDispatch) {
  const support = provider?.qualification.live ? provider.qualification.entries : [];
  const reconciliations = provider ? (['sms', 'whatsapp', 'voice'] as Channel[]).map(channel => loop(() => reconcileOnce(ctx, provider, signal, channel), 1000, signal)) : [];
  await Promise.all([
    loop(() => relayOnce(ctx, transport, 'control', signal), 100, signal),
    loop(() => recoverWork(ctx), 1000, signal), ...reconciliations,
    ...(checks ? [loop(() => checkOnce(ctx, support, checks), checks.sweepMs, signal)] : []),
    ...(demo?.enabled === true ? [loop(() => purgeDemoWorlds(ctx), 600000, signal)] : [])
  ]);
}
export async function startWorker(role: string, env = process.env): Promise<void> {
  if (!['control', 'emergency', 'ordinary'].includes(role)) throw new Error('Worker role must be control, emergency or ordinary');
  const checks = role === 'control' ? checkConfig(env) : null;
  if (!env.AWS_REGION || !env.SQS_EMERGENCY_URL || !env.SQS_ORDINARY_URL) throw new Error('Database, AWS region and SQS queue URLs required');
  const provider = configuredProvider(env);
  const demo = demoDispatch(env);
  if (role !== 'control' && !provider?.qualification.live) throw new Error('Delivery disabled: complete evidenced live configuration required');
  const transport = createSqsTransport(env.AWS_REGION, { emergency: env.SQS_EMERGENCY_URL, ordinary: env.SQS_ORDINARY_URL });
  const ctx = createContext(databaseConfig(env), undefined, 2);
  const abort = new AbortController();
  const shutdown = () => abort.abort();
  process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
  try {
    if (role === 'control') await control(ctx, transport, provider, abort.signal, checks, demo);
    else await consume(ctx, transport, provider!, role as WorkClass, { sms: 2, whatsapp: 2, voice: 2 }, abort.signal, demo);
  } finally {
    process.removeListener('SIGTERM', shutdown); process.removeListener('SIGINT', shutdown);
    transport.close(); await ctx.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startWorker(process.argv[2] ?? '').catch(() => { process.stderr.write('Worker stopped with error\n'); process.exitCode = 1; });
}
