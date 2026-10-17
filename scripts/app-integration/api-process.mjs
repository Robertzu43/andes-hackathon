// Test-only listener using the backend's existing signed-key/clock seams.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {importJWK} from 'jose';
import {createApp} from '../../dist/api/app.js';
import {createContext} from '../../dist/db.js';
import {runDatabaseUrl} from './runtime.mjs';

assert.equal(process.env.ANDES_APP_INTEGRATION, 'synthetic-only');
runDatabaseUrl(process.env.APP_INTEGRATION_DATABASE_URL);
const key = await importJWK(JSON.parse(process.env.APP_INTEGRATION_PUBLIC_JWK), 'RS256');
const ctx = createContext(process.env.APP_INTEGRATION_DATABASE_URL,
  () => new Date(readFileSync(process.env.APP_INTEGRATION_CLOCK, 'utf8')));
const app = createApp({ctx, auth: {issuer: 'https://andes-integration.invalid', audience: 'andes-q46', keyResolver: async () => key},
  channelSupport: ['sms', 'whatsapp', 'voice'].map(channel => ({channel, country: 'BR', locale: 'pt-BR'}))});
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await app.close();
  if (process.connected) process.disconnect();
}
process.once('SIGTERM', () => void close());
process.once('SIGINT', () => void close());
process.once('disconnect', () => void close());
await app.listen({port: 0, host: '127.0.0.1'});
process.send({port: app.server.address().port, pid: process.pid});
