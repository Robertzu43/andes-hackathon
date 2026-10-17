import { configuredProvider } from './worker.js';
import { loadCallbackConfig } from './notifications/callback.js';
import { createContext } from './db.js';
import { createApp } from './api/app.js';
const { DATABASE_URL, OIDC_ISSUER, OIDC_AUDIENCE, OIDC_JWKS_URL } = process.env;
if (!DATABASE_URL || !OIDC_ISSUER || !OIDC_AUDIENCE || !OIDC_JWKS_URL) throw new Error('DATABASE_URL and trusted OIDC configuration required');
const provider = configuredProvider(process.env);
const callbackConfig = loadCallbackConfig(process.env);
const ctx = createContext(DATABASE_URL);
const app = createApp({ ctx, channelSupport: provider?.qualification.entries ?? [], callbackConfig, auth: { issuer: OIDC_ISSUER, audience: OIDC_AUDIENCE, jwksUrl: OIDC_JWKS_URL } });
let closing = false;
async function shutdown() { if (closing) return; closing = true; await app.close(); }
process.once('SIGTERM', () => void shutdown()); process.once('SIGINT', () => void shutdown());
try { await app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' }); }
catch { await app.close(); process.stderr.write('API startup failed\n'); process.exitCode = 1; }
