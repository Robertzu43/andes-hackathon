import { configuredProvider } from './worker.js';
import { loadCallbackConfig } from './notifications/callback.js';
import { createContext, databaseConfig } from './db.js';
import { createApp } from './api/app.js';
import { demoIssuer } from './demo.js';
const { OIDC_ISSUER, OIDC_AUDIENCE, OIDC_JWKS_URL } = process.env;
const demo = process.env.DEMO_MODE === 'true' ? await demoIssuer(process.env) : undefined;
if (!demo && (!OIDC_ISSUER || !OIDC_AUDIENCE || !OIDC_JWKS_URL)) throw new Error('Trusted OIDC configuration required');
const provider = configuredProvider(process.env);
const callbackConfig = loadCallbackConfig(process.env);
const ctx = createContext(databaseConfig());
const app = createApp({ ctx, channelSupport: provider?.qualification.live ? provider.qualification.entries : [], callbackConfig, auth: demo?.auth ?? { issuer: OIDC_ISSUER!, audience: OIDC_AUDIENCE!, jwksUrl: OIDC_JWKS_URL! }, demo });
let closing = false;
async function shutdown() { if (closing) return; closing = true; await app.close(); }
process.once('SIGTERM', () => void shutdown()); process.once('SIGINT', () => void shutdown());
try { await app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' }); }
catch { await app.close(); process.stderr.write('API startup failed\n'); process.exitCode = 1; }
