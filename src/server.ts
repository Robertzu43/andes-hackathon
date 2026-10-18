import { fileURLToPath } from 'node:url';
import { configuredProvider } from './worker.js';
import { loadCallbackConfig } from './notifications/callback.js';
import { createContext, databaseConfig } from './db.js';
import { createApp } from './api/app.js';
import { demoIssuer } from './demo.js';
import { checkConfig } from './checks/sweep.js';
const { OIDC_ISSUER, OIDC_AUDIENCE, OIDC_JWKS_URL } = process.env;
// Unset means 0. Anything else must be the digit 0, 1, 2 or 3; blank and whitespace fail startup. HOST defaults to 0.0.0.0. A deploy behind one proxy sets TRUST_PROXY_HOPS=1. Never `true`.
const rawHops = process.env.TRUST_PROXY_HOPS;
if (rawHops !== undefined && !/^[0-3]$/.test(rawHops)) throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 3');
const trustProxyHops = Number(rawHops ?? 0);
const demo = process.env.DEMO_MODE === 'true' ? await demoIssuer(process.env) : undefined;
if (!demo && (!OIDC_ISSUER || !OIDC_AUDIENCE || !OIDC_JWKS_URL)) throw new Error('Trusted OIDC configuration required');
const provider = configuredProvider(process.env);
const callbackConfig = loadCallbackConfig(process.env);
const ctx = createContext(databaseConfig());
const app = createApp({ ctx, channelSupport: provider?.qualification.live ? provider.qualification.entries : [], callbackConfig, auth: demo?.auth ?? { issuer: OIDC_ISSUER!, audience: OIDC_AUDIENCE!, jwksUrl: OIDC_JWKS_URL! }, demo,
  automaticChecks: checkConfig(process.env) !== null, // same timings as the control worker
  webRoot: fileURLToPath(new URL('../web/dist', import.meta.url)), trustProxyHops }); // build web/ first; a missing build fails here
let closing = false;
async function shutdown() { if (closing) return; closing = true; await app.close(); }
process.once('SIGTERM', () => void shutdown()); process.once('SIGINT', () => void shutdown());
// HOST=127.0.0.1 behind a local tunnel, so nobody on the LAN reaches the API directly and forges X-Forwarded-For.
try { await app.listen({ port: Number(process.env.PORT ?? 3000), host: process.env.HOST ?? '0.0.0.0' }); }
catch { await app.close(); process.stderr.write('API startup failed\n'); process.exitCode = 1; }
